#!/usr/bin/env python3
"""Emit one guarded UPDATE per repaired theory page.

Usage: python3 -I build_sql.py <repair-out-dir> [<repair-out-dir> ...] --sql-dir DIR

Each <repair-out-dir> is a repair-theory-scope.ts output (after/<key>.json +
repair-report.json). A later dir wins for a key present in several (retries).

Each statement updates ONE row, only while md5(content_json::text) still equals
the md5 exported before the audit (a concurrent change is never overwritten),
stores the final validator score, marks the page manual-approved with
flagged_reasons cleared (as the 2026-11-01 repairs did), and RETURNs the key so
a no-op is visible.
"""
import json, os, sys

TAG = '$scopefix$'


def main():
    args = sys.argv[1:]
    j = args.index('--sql-dir')
    sql_dir = args[j + 1]
    del args[j:j + 2]
    pages = {}
    for d in args:
        rep = json.load(open(os.path.join(d, 'repair-report.json')))
        for o in rep['outcomes']:
            if not o['ok']:
                continue
            after = json.load(open(os.path.join(d, 'after', o['key'] + '.json')))
            pages[o['key']] = (after, o['attempts'][-1]['validator']['score'])
    os.makedirs(sql_dir, exist_ok=True)
    for key, (after, score) in sorted(pages.items()):
        body = json.dumps(after['content'], ensure_ascii=False)
        if TAG in body:
            sys.exit(f'{key}: content contains the dollar-quote tag')
        sql = (
            f"UPDATE theory_topics SET content_json = {TAG}{body}{TAG}::jsonb, "
            f"review_status = 'manual-approved', flagged_reasons = NULL, quality_score = {score}, updated_at = now() "
            f"WHERE id = '{after['id']}' AND grammar_point_key = '{key}' "
            f"AND md5(content_json::text) = '{after['base_md5']}' RETURNING grammar_point_key"
        )
        open(os.path.join(sql_dir, key + '.sql'), 'w').write(sql)
    print(f'{len(pages)} statements -> {sql_dir}')


if __name__ == '__main__':
    main()
