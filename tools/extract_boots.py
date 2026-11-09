"""Extract the ten distinct Nox_Sound boot contacts without installing audio tools.

Usage: python tools/extract_boots.py path/to/530589__nox_sound__footsteps_boots_gritty_ground_gravel.wav
The source is read only. PCM16 output preserves its gain; contact is the first
2 ms RMS block above 0.02 FS, rather than the later/louder gravel crackle.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import wave
import zlib

ROOT = Path(__file__).resolve().parents[1]


def read_pcm24(path):
    with wave.open(str(path), 'rb') as source:
        params = source.getparams()
        if params.nchannels != 1 or params.sampwidth != 3 or params.comptype != 'NONE':
            raise ValueError('Expected the original mono, uncompressed 24-bit PCM recording.')
        data = source.readframes(params.nframes)
    samples = [int.from_bytes(data[i:i + 3], 'little', signed=True) / 8388608
               for i in range(0, len(data), 3)]
    return samples, params.framerate


def split_contacts(samples, sample_rate):
    # The recording has digitally quiet gaps between separate performances.
    # Keep low-level gravel through the tail and split only at >= 200 ms silence.
    threshold = 1e-5
    quiet_gap = round(.2 * sample_rate)
    regions = []
    first = previous = None
    for index, value in enumerate(samples):
        if abs(value) <= threshold:
            continue
        if previous is None:
            first = index
        elif index - previous > quiet_gap:
            regions.append((first, previous))
            first = index
        previous = index
    if previous is not None:
        regions.append((first, previous))
    if len(regions) != 10:
        raise ValueError(f'Expected the observed ten isolated contacts, found {len(regions)}.')
    return regions


def rms(samples):
    return math.sqrt(sum(value * value for value in samples) / max(1, len(samples)))


def write_wave(path, samples, sample_rate):
    pcm = bytearray()
    for value in samples:
        pcm.extend(struct.pack('<h', max(-32768, min(32767, round(value * 32767)))))
    with wave.open(str(path), 'wb') as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(sample_rate)
        target.writeframes(pcm)


def waveform_png(path, excerpts, sample_rate):
    # Small standard-library-only waveform QA; one equally scaled panel per boot.
    width, panel = 1440, 100
    height = panel * len(excerpts)
    pixels = bytearray([245, 243, 236] * width * height)

    def dot(x, y, color):
        if 0 <= x < width and 0 <= y < height:
            pos = (y * width + x) * 3
            pixels[pos:pos + 3] = bytes(color)

    seconds = .74
    for row, item in enumerate(excerpts):
        center = row * panel + panel // 2
        for x in range(width):
            dot(x, center, (190, 190, 182))
        for mark in range(8):
            x = round(mark * .1 / seconds * (width - 1))
            for y in range(row * panel + 4, (row + 1) * panel - 4):
                dot(x, y, (226, 223, 214))
        step = seconds * sample_rate / width
        samples = item['waveform']
        for x in range(width):
            first, last = round(x * step), round((x + 1) * step)
            section = samples[first:last]
            if not section:
                continue
            lo, hi = min(section), max(section)
            y1 = center - round(hi / .65 * 43)
            y2 = center - round(lo / .65 * 43)
            for y in range(y1, y2 + 1):
                dot(x, y, (47, 70, 72))
        contact_x = round(item['contact'] / seconds * (width - 1))
        for y in range(row * panel + 4, (row + 1) * panel - 4):
            dot(contact_x, y, (200, 58, 42))
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))
    raw = b''.join(b'\x00' + pixels[y * width * 3:(y + 1) * width * 3]
                   for y in range(height))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' +
                     chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) +
                     chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/audio/boots')
    args = parser.parse_args()
    original_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    samples, sample_rate = read_pcm24(args.source)
    regions = split_contacts(samples, sample_rate)
    args.output.mkdir(parents=True, exist_ok=True)
    records = []
    excerpts = []
    for number, (first, last) in enumerate(regions, 1):
        start = max(0, first - round(.012 * sample_rate))
        end = min(len(samples), last + round(.010 * sample_rate) + 1)
        block = round(.002 * sample_rate)
        contact = next((index for index in range(start, min(end, start + round(.15 * sample_rate)), block)
                        if rms(samples[index:index + block]) > .02), None)
        if contact is None:
            raise ValueError(f'No clear primary impact in contact {number}.')
        excerpt = samples[start:end]
        fade_in = round(.002 * sample_rate)
        fade_out = round(.008 * sample_rate)
        for index in range(min(fade_in, len(excerpt))):
            excerpt[index] *= index / max(1, fade_in - 1)
        for index in range(min(fade_out, len(excerpt))):
            excerpt[-1 - index] *= index / max(1, fade_out - 1)
        filename = f'step-{number:02}.wav'
        write_wave(args.output / filename, excerpt, sample_rate)
        record = {
            'file': filename,
            'kind': 'walk' if number <= 5 else 'run',
            'contact': round((contact - start) / sample_rate, 6),
            'sourceStart': round(start / sample_rate, 6),
            'sourceEnd': round(end / sample_rate, 6),
            'sourceContact': round(contact / sample_rate, 6),
            'duration': round(len(excerpt) / sample_rate, 6),
            'peak': round(max(abs(value) for value in excerpt), 6),
            'rms': round(rms(excerpt), 6),
            'impactRms': round(rms(samples[contact:contact + round(.02 * sample_rate)]), 6)
        }
        records.append(record)
        excerpts.append({'contact': record['contact'], 'waveform': excerpt})
    manifest = {
        'source': {
            'file': args.source.name,
            'title': 'Footsteps Boots Gritty Ground Gravel',
            'author': 'Nox_Sound',
            'url': 'https://freesound.org/people/Nox_Sound/sounds/530589/',
            'license': 'CC0 1.0',
            'licenseUrl': 'https://creativecommons.org/publicdomain/zero/1.0/',
            'sha256': original_hash,
            'sampleRate': sample_rate,
            'channels': 1,
            'bitsPerSample': 24,
            'duration': round(len(samples) / sample_rate, 6)
        },
        'sampleRate': sample_rate,
        'channels': 1,
        'bitsPerSample': 16,
        'contactMethod': 'First 2 ms RMS window above 0.02 FS in the primary landing attack; not the later gravel peak.',
        'processing': 'Isolate at the silent source gaps, retain gravel tails, 12 ms lead, 10 ms trailing silence, 2 ms input and 8 ms output fades; original gain preserved.',
        'samples': records
    }
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    assert hashlib.sha256(args.source.read_bytes()).hexdigest() == original_hash, 'Source was modified.'
    checks = ROOT / 'checks'
    checks.mkdir(exist_ok=True)
    validation = {'sourceUnchanged': True, 'count': len(records), 'walk': 5, 'run': 5, 'samples': []}
    previous_end = 0
    for record in records:
        with wave.open(str(args.output / record['file']), 'rb') as target:
            assert target.getnchannels() == 1 and target.getsampwidth() == 2
            assert target.getframerate() == sample_rate
            data = struct.unpack('<' + 'h' * target.getnframes(), target.readframes(target.getnframes()))
            assert data[0] == data[-1] == 0
            assert max(abs(value) for value in data) < 32767
        assert record['sourceStart'] >= previous_end
        assert 0 <= record['contact'] < .05 < record['duration']
        previous_end = record['sourceEnd']
        validation['samples'].append({'file': record['file'], 'frames': len(data), 'contact': record['contact'], 'silentEdges': True, 'unclipped': True})
    (checks / 'boot-extraction.json').write_text(json.dumps(validation, indent=2) + '\n', encoding='utf-8')
    waveform_png(checks / 'boot-extraction.png', excerpts, sample_rate)
    print(json.dumps({'count': len(records), 'output': str(args.output), 'contacts': [record['contact'] for record in records]}, indent=2))


if __name__ == '__main__':
    main()