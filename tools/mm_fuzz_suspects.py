#!/usr/bin/env python3
"""Rank fuzz incidents that look like collision defects (not the marble driven off a real edge).

  python3 tools/mm_fuzz_suspects.py [artifacts/fuzz] [--top 12]

strict death suspect: the marble left the floor while the picture shows floor at (about) the same height
within 8 px straight ahead of where it stood. Stalls are listed separately (need eyes on the picture).
"""
import json, glob, sys, collections
d = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 'artifacts/fuzz'
top = int(sys.argv[sys.argv.index('--top') + 1]) if '--top' in sys.argv else 12
recs = []
for f in glob.glob(f'{d}/*.jsonl'):
    for l in open(f):
        if l.startswith('{'):
            recs.append(json.loads(l))
for st in sorted({r['stage'] for r in recs}):
    rs = [r for r in recs if r['stage'] == st]
    dies = [r for r in rs if r.get('ev') == 'die' and r.get('ahead')]
    strict = [r for r in dies if any(a['z'] is not None and a['d'] <= 8 and abs(a['z'] - r['from']['z']) <= 8 for a in r['ahead'])]
    stalls = [r for r in rs if r.get('ev') == 'stall']
    print(f"\n=== STAGE {st}: deaths {len(dies)} (strict suspects {len(strict)}), stalls {len(stalls)}")
    def cluster(items, key, show):
        c = collections.Counter(); ex = {}
        for r in items:
            k = key(r); c[k] += 1; ex.setdefault(k, r)
        for k, n in c.most_common(top):
            print(f"  {n:3d}x  {show(ex[k])}")
    print(" suspect deaths (px where it left the floor, height, heading, what is drawn 4/8/12/18 px ahead, physics reason):")
    cluster(strict, lambda r: (r['from']['sx'] // 12, r['from']['sy'] // 12),
            lambda r: f"px({r['from']['sx']},{r['from']['sy']}) z{r['from']['z']:.0f} hd{r['route']['heading']:4d}  ahead={[a['z'] for a in r['ahead']]}  {r['why'][:80]}")
    print(" stalls (px, height, what blocked):")
    cluster(stalls, lambda r: (r['sx'] // 12, r['sy'] // 12),
            lambda r: f"px({r['sx']},{r['sy']}) z{r['z']:.0f} hd{r['route']['heading']:4d}  {r.get('blocks') or 'no block reason (probably a cliff face / step)'}")
