#!/usr/bin/env python3
"""Apply a theory-page patch file to the saved "before" pages.

Usage: python3 -I apply_patch.py <patch.json> [--out-dir DIR] [--base-dir DIR]
(--base-dir: apply on top of a previous round's pages instead of before/)

Patch file: a JSON list of page patches:
  {"key": "<grammar_point_key>",
   "edits": [
     {"op": "replace", "find": "<exact substring>", "replace": "<new text>",
      "finding": "<short ref to the audit finding>"},
     {"op": "set", "path": "/sections/2/body/3", "value": <json>, "finding": "..."},
     {"op": "insert", "path": "/sections/2/body/3", "value": <json>, "finding": "..."},
     {"op": "remove", "path": "/sections/2/body/3", "finding": "..."}
   ]}

- "replace" works on string leaves of content_json: `find` must occur in exactly
  ONE leaf, exactly once (a find spanning two rich-text nodes will not match —
  pick a find inside one node, or use "set" on the parent node).
- "set"/"insert"/"remove" use JSON-pointer paths into content_json (list indices
  are numbers). "insert" inserts before the index (or appends if index == len).
- Edits apply in order; paths refer to the state after earlier edits.

Writes <out-dir>/<key>.json (the full content_json after edits) and prints a
per-page summary. Exits 1 if any edit fails, without writing that page.
Also flags Cyrillic/Greek letters inside words (outside /.../ IPA) in the result.
"""
import json, re, sys, os, copy

HERE = os.path.dirname(os.path.abspath(__file__))
BEFORE = os.path.join(HERE, '..', 'before')

def leaves(o, path=()):
    if isinstance(o, dict):
        for k, v in o.items():
            yield from leaves(v, path + (k,))
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from leaves(v, path + (i,))
    elif isinstance(o, str):
        yield path, o

def get(o, path):
    for p in path:
        o = o[p]
    return o

def parse_ptr(ptr):
    parts = [p for p in ptr.split('/') if p != '']
    return [int(p) if p.isdigit() else p for p in parts]

def mixed_script(content):
    bad = []
    for path, s in leaves(content):
        for w in re.findall(r'\S+', s):
            if w.startswith('/') and w.rstrip('.,;:)').endswith('/'):
                continue
            if re.search(r'[Ѐ-ӿͰ-Ͽ]', w) and re.search(r'[A-Za-zÀ-ɏ]', w):
                bad.append((path, w))
    return bad

def apply(page_patch, base_dir=None):
    key = page_patch['key']
    src = json.load(open(os.path.join(base_dir or BEFORE, key + '.json')))
    if 'md5' not in src:  # a previous round's output: carry its base md5
        src['md5'] = src.get('base_md5')
    content = copy.deepcopy(src['content'])
    errors = []
    for i, e in enumerate(page_patch['edits']):
        op = e.get('op')
        try:
            if op == 'replace':
                hits = [(p, s) for p, s in leaves(content) if e['find'] in s]
                if len(hits) != 1 or hits[0][1].count(e['find']) != 1:
                    n = sum(s.count(e['find']) for _, s in hits)
                    raise ValueError(f"find matched {n} times (need exactly 1): {e['find']!r}")
                p, s = hits[0]
                parent = get(content, p[:-1])
                parent[p[-1]] = s.replace(e['find'], e['replace'])
            elif op in ('set', 'insert', 'remove'):
                path = parse_ptr(e['path'])
                parent = get(content, path[:-1])
                last = path[-1]
                if op == 'set':
                    if isinstance(parent, list) and not (0 <= last < len(parent)):
                        raise IndexError(f'index {last} out of range')
                    parent[last] = e['value']
                elif op == 'insert':
                    if not isinstance(parent, list) or not (0 <= last <= len(parent)):
                        raise IndexError(f'bad insert path {e["path"]}')
                    parent.insert(last, e['value'])
                else:
                    if isinstance(parent, list):
                        parent.pop(last)
                    else:
                        del parent[last]
            else:
                raise ValueError(f'unknown op {op!r}')
        except Exception as ex:  # noqa
            errors.append(f'edit {i} ({op}): {ex}')
    return src, content, errors

def main():
    args = sys.argv[1:]
    out_dir = os.path.join(HERE, '..', 'after')
    if '--out-dir' in args:
        j = args.index('--out-dir'); out_dir = args[j + 1]; del args[j:j + 2]
    base_dir = None
    if '--base-dir' in args:
        j = args.index('--base-dir'); base_dir = args[j + 1]; del args[j:j + 2]
    patches = json.load(open(args[0]))
    os.makedirs(out_dir, exist_ok=True)
    failed = 0
    for pp in patches:
        src, content, errors = apply(pp, base_dir)
        ms = mixed_script(content)
        if errors:
            failed += 1
            print(f"FAIL {pp['key']}:"); [print('   ', x) for x in errors]
            continue
        json.dump({'id': src['id'], 'key': src['key'], 'base_md5': src['md5'], 'content': content},
                  open(os.path.join(out_dir, pp['key'] + '.json'), 'w'), ensure_ascii=False, indent=1)
        warn = f'  WARNING mixed-script words remain: {[w for _, w in ms]}' if ms else ''
        print(f"ok   {pp['key']}: {len(pp['edits'])} edits{warn}")
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    main()
