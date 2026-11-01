#!/usr/bin/env python3
"""Build guarded UPDATE statements for repaired theory pages.

Usage: python3 -I build_sql.py <final-dir> <scores.json|-> <out-dir>

<final-dir>: one <key>.json per page ({"key","base_md5","content"} or the
  before/ shape with "md5"). Only pages whose content differs from before/ are
  emitted.
<scores.json>: optional eval-runs output; its qualityScore per key is stored.

Each statement updates ONE row, only if its content still has the md5 recorded
when the page was exported (so a concurrent change is never overwritten), and
RETURNs the key so a no-op is visible. Pages are marked manual-approved with
flagged_reasons cleared, matching the 2026-11-01 #803 repairs.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BEFORE = os.path.join(HERE, '..', 'before')
TAG = '$theorypage$'


def main():
    final_dir, scores_path, out_dir = sys.argv[1:4]
    scores = {}
    if scores_path != '-':
        for v in json.load(open(scores_path))['verdicts']:
            if v.get('qualityScore') is not None:
                scores[v['key']] = v['qualityScore']
    os.makedirs(out_dir, exist_ok=True)
    keys = []
    for f in sorted(os.listdir(final_dir)):
        if not f.endswith('.json'):
            continue
        key = f[:-5]
        page = json.load(open(os.path.join(final_dir, f)))
        before = json.load(open(os.path.join(BEFORE, f)))
        if page['content'] == before['content']:
            continue
        body = json.dumps(page['content'], ensure_ascii=False)
        if TAG in body:
            sys.exit(f'{key}: content contains the dollar-quote tag')
        score = scores.get(key)
        score_sql = f", quality_score = {score}" if score is not None else ''
        sql = (
            f"UPDATE theory_topics SET content_json = {TAG}{body}{TAG}::jsonb, "
            f"review_status = 'manual-approved', flagged_reasons = NULL{score_sql}, updated_at = now() "
            f"WHERE id = '{before['id']}' AND grammar_point_key = '{key}' "
            f"AND md5(content_json::text) = '{before['md5']}' RETURNING grammar_point_key;\n"
        )
        open(os.path.join(out_dir, key + '.sql'), 'w').write(sql)
        keys.append(key)
    with open(os.path.join(out_dir, 'ALL.sql'), 'w') as out:
        out.write('BEGIN;\n')
        for k in keys:
            out.write(open(os.path.join(out_dir, k + '.sql')).read())
        out.write('COMMIT;\n')
    print(f'{len(keys)} statements -> {out_dir}')


if __name__ == '__main__':
    main()
