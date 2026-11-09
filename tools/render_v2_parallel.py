"""Resume prepared v2 exports in independent Blender workers.

Each model needs an existing reference.json and sprites.json. Workers never
write the shared manifest or READY; this supervisor verifies and publishes them
only after every shard has exited successfully.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    for attempt in range(20):
        try:
            temporary.replace(path)
            break
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.05)


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def finalize(job, count, started):
    output = job['output']
    completed = {}
    frames = 0
    for index in range(count):
        directory = output/'shards'/str(count)/str(index)
        finish = read_json(directory/'complete.json')
        state = read_json(directory/'render_state.json')
        if finish['signature'] != job['signature'] or state['signature'] != job['signature'] or finish['smoke']:
            raise ValueError('Shard completion configuration does not match the full export.')
        completed.update(state['completed'])
        frames += finish['frames']
    manifest = job['manifest']
    expected = [frame[pass_name] for clip in manifest['clips'] for direction in clip['directions']
                for frame in direction['frames'] for pass_name in ('albedo', 'normal')]
    if frames != len(expected) // 2 or set(completed) != set(expected):
        raise ValueError('Completed shards do not cover the full sprite manifest.')
    for relative in expected:
        record = completed[relative]
        path = output/relative
        if not path.is_file() or path.stat().st_size != record['size'] or digest(path) != record['sha256']:
            raise ValueError('Missing or changed rendered frame: ' + relative)
    if digest(job['source']) != manifest['source_sha256'] or digest(output/'reference.json') != manifest['reference_manifest_sha256']:
        raise ValueError('Source model or reference changed during rendering.')
    elapsed = time.monotonic() - started
    manifest['render_summary'] = {'frames': frames, 'passes': 2, 'smoke': False, 'seconds': elapsed,
                                  'parallel_workers': count, 'verified_frame_hashes': len(expected)}
    write_json(output/'render_state.json', {'schema': 'walking-fortress-relight-state-v1',
                                           'signature': job['signature'], 'completed': completed})
    write_json(output/'sprites.json', manifest)
    write_json(output/'progress.json', {'completed_pairs': frames, 'total_pairs': frames,
                                       'elapsed_seconds': elapsed, 'smoke': False, 'parallel_workers': count})
    (output/'READY').write_text('Paired albedo and actor-space normal frames complete; all frame hashes verified.\n', encoding='utf-8')
    print('V2_PARALLEL_READY ' + str(output), flush=True)


def main(options):
    if options.workers_per_model < 2 or options.threads < 1:
        raise ValueError('Use at least two workers per model and at least one render thread.')
    jobs = []
    for source_name, output_name in options.job:
        source = Path(source_name).resolve()
        output = Path(output_name).resolve()
        manifest = read_json(output/'sprites.json')
        if Path(manifest['source_blend']).resolve() != source or manifest['tile_size'] != [256, 256]:
            raise ValueError('Prepared export does not match the model or tile size.')
        source_hash, reference_hash = digest(source), digest(output/'reference.json')
        if source_hash != manifest['source_sha256'] or reference_hash != manifest['reference_manifest_sha256']:
            raise ValueError('Prepared export hashes do not match the model and reference.')
        signature = hashlib.sha256((source_hash + reference_hash + '256normal-export-v1').encode()).hexdigest()
        (output/'READY').unlink(missing_ok=True)
        jobs.append({'source': source, 'output': output, 'manifest': manifest, 'signature': signature, 'workers': [], 'finished': False})
    started = time.monotonic()
    script = Path(__file__).with_name('export_v2_models.py')
    try:
        for job in jobs:
            for index in range(options.workers_per_model):
                directory = job['output']/'shards'/str(options.workers_per_model)/str(index)
                directory.mkdir(parents=True, exist_ok=True)
                for marker in ('complete.json', 'progress.json'):
                    (directory/marker).unlink(missing_ok=True)
                log = (directory/'render.log').open('w', encoding='utf-8')
                command = [str(options.blender.resolve()), '--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1',
                           '--threads', str(options.threads), str(job['source']), '--python', str(script), '--',
                           '--output', str(job['output']), '--shard-count', str(options.workers_per_model), '--shard-index', str(index)]
                try:
                    process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
                finally:
                    log.close()
                job['workers'].append(process)
                print(f'V2_PARALLEL_WORKER {job["source"].stem} shard={index} pid={process.pid}', flush=True)
        last_report = 0
        while not all(job['finished'] for job in jobs):
            for job in jobs:
                if job['finished']:
                    continue
                statuses = [worker.poll() for worker in job['workers']]
                for index, status in enumerate(statuses):
                    if status is not None and status != 0:
                        raise RuntimeError(f'{job["source"].stem} shard {index} failed with exit code {status}; see {job["output"] / "shards" / str(options.workers_per_model) / str(index) / "render.log"}')
                if all(status == 0 for status in statuses):
                    finalize(job, options.workers_per_model, started)
                    job['finished'] = True
                    continue
                progress = [read_json(path) for index in range(options.workers_per_model)
                            if (path := job['output']/'shards'/str(options.workers_per_model)/str(index)/'progress.json').is_file()]
                total = sum(len(direction['frames']) for clip in job['manifest']['clips'] for direction in clip['directions'])
                completed = sum(item['completed_pairs'] for item in progress)
                try:
                    write_json(job['output']/'progress.json', {'completed_pairs': completed, 'total_pairs': total,
                               'elapsed_seconds': time.monotonic() - started, 'smoke': False, 'parallel_workers': options.workers_per_model})
                except PermissionError:
                    # A progress reader must never interrupt frame rendering.
                    pass
                if time.monotonic() - last_report >= 20:
                    print(f'V2_PARALLEL_PROGRESS {job["source"].stem} {completed}/{total}', flush=True)
            if time.monotonic() - last_report >= 20:
                last_report = time.monotonic()
            time.sleep(2)
    finally:
        # These handles only refer to this supervisor's own workers.
        for job in jobs:
            for worker in job['workers']:
                if worker.poll() is None:
                    worker.terminate()
        for job in jobs:
            for worker in job['workers']:
                worker.wait()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--blender', type=Path, required=True)
    parser.add_argument('--job', action='append', nargs=2, metavar=('MODEL', 'OUTPUT'), required=True)
    parser.add_argument('--workers-per-model', type=int, default=2)
    parser.add_argument('--threads', type=int, default=2)
    main(parser.parse_args())
