"""Validate real relightable exports, including raw normal encoding and pose alignment."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'sprite-studio'/'vendor'))
from PIL import Image


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify(path, partial=False):
    source = path/'sprites.json'
    data = json.loads(source.read_text(encoding='utf-8'))
    assert data['normal_space'] == 'actor-blender-world'
    assert data['normal_encoding'] == 'RGB8-linear-signed'
    assert data['source_sha256'] == digest(Path(data['source_blend']))
    expected = sum(len(d['frames']) for c in data['clips'] for d in c['directions'])
    assert expected == 432
    expected_size = tuple(data['tile_size'])
    all_lengths, verified, skipped, top_normals = [], 0, 0, 0
    coverage_ratios=[]
    for clip in data['clips']:
        assert len(clip['directions']) == 16
        for direction in clip['directions']:
            for frame in direction['frames']:
                ap, np = path/frame['albedo'], path/frame['normal']
                if partial and (not ap.is_file() or not np.is_file()):
                    skipped += 1
                    continue
                with Image.open(ap) as ai, Image.open(np) as ni:
                    assert ai.size == ni.size == expected_size
                    assert ai.mode == ni.mode == 'RGBA'
                    a, n = ai.copy(), ni.copy()
                assert len(frame['pivot_pixels']) == 2
                assert all(math.isfinite(v) for v in frame['pivot_pixels'])
                nb, ab = n.getbbox(), a.getbbox()
                assert nb and ab
                # Ink may extend beyond the geometric surface, but camera/pose
                # mismatches would produce substantially displaced rectangles.
                assert max(abs(u-v) for u,v in zip(nb,ab)) <= 8, (ap.name,nb,ab)
                opaque=[p for p in n.get_flattened_data() if p[3]==255]
                assert len(opaque)>1000
                lengths=[math.sqrt(sum((v/255*2-1)**2 for v in p[:3])) for p in opaque]
                assert max(lengths)<1.018, ap.name
                median=statistics.median(lengths)
                assert 0.96<median<1.015, (ap.name,median)
                all_lengths.extend(lengths[::32])
                top_normals+=sum(p[2]>=250 and abs(p[0]-128)<=8 and abs(p[1]-128)<=8 for p in opaque)
                ac=sum(a.getchannel('A').get_flattened_data())
                nc=sum(n.getchannel('A').get_flattened_data())
                coverage_ratios.append(nc/ac)
                verified+=1
    assert verified>0
    assert top_normals>0, 'No raw near-up normal samples; check PNG transfer function.'
    if not partial:
        assert verified==expected
        assert (path/'READY').is_file()
        assert not list(path.rglob('*.part.png'))
    report={'schema':'walking-fortress-relight-verification-v1', 'manifest':str(source.resolve()),
            'source_sha256':data['source_sha256'],'expected_pairs':expected,'verified_pairs':verified,
            'skipped_pairs':skipped,'tile_size':list(expected_size),'opaque_normal_length_median':statistics.median(all_lengths),
            'opaque_normal_length_min':min(all_lengths),'opaque_normal_length_max':max(all_lengths),
            'raw_near_up_samples':top_normals,'normal_to_albedo_coverage_range':[min(coverage_ratios),max(coverage_ratios)],
            'source_unchanged':True,'encoding':'linear RGB signed; opaque vector lengths and near-up samples checked',
            'pose_alignment':'all body/normal alpha bounds differ no more than8 pixels'}
    (path/'validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('export',type=Path)
    parser.add_argument('--partial',action='store_true')
    args=parser.parse_args()
    print(json.dumps(verify(args.export,args.partial),indent=2))