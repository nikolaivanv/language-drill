import { describe, it, expect } from 'vitest';
import { NoToolCallError } from '@language-drill/ai';
import { CefrLevel, Language } from '@language-drill/shared';

import {
  idsFileCandidates,
  parseIdsFile,
  parseRevalidateArgs,
  verdictErrorRecord,
  verdictRecord,
} from './revalidate-cloze-pool';

// ---------------------------------------------------------------------------
// parseRevalidateArgs
// ---------------------------------------------------------------------------

describe('parseRevalidateArgs', () => {
  it('defaults to dry-run with no filters', () => {
    const args = parseRevalidateArgs([]);
    expect(args.apply).toBe(false);
    expect(args.language).toBeNull();
    expect(args.cefrLevel).toBeNull();
    expect(args.limit).toBeNull();
    expect(args.concurrency).toBeGreaterThan(0);
    expect(args.maxCostUsd).toBeGreaterThan(0);
  });

  it('parses --apply, --language, --cefr, --limit, --concurrency, --max-cost-usd', () => {
    const args = parseRevalidateArgs([
      '--apply',
      '--language',
      'tr',
      '--cefr',
      'a1',
      '--limit',
      '50',
      '--concurrency',
      '8',
      '--max-cost-usd',
      '12.5',
    ]);
    expect(args.apply).toBe(true);
    expect(args.language).toBe(Language.TR);
    expect(args.cefrLevel).toBe(CefrLevel.A1);
    expect(args.limit).toBe(50);
    expect(args.concurrency).toBe(8);
    expect(args.maxCostUsd).toBe(12.5);
  });

  it('accepts --lang and --level as aliases', () => {
    const args = parseRevalidateArgs(['--lang', 'ES', '--level', 'B1']);
    expect(args.language).toBe(Language.ES);
    expect(args.cefrLevel).toBe(CefrLevel.B1);
  });

  it('rejects unknown languages', () => {
    expect(() => parseRevalidateArgs(['--language', 'FR'])).toThrow();
  });

  it('rejects unknown CEFR levels', () => {
    expect(() => parseRevalidateArgs(['--cefr', 'D3'])).toThrow();
  });

  it('rejects unrecognized flags', () => {
    expect(() => parseRevalidateArgs(['--bogus'])).toThrow(
      /Unrecognized argument/,
    );
  });

  it('rejects --limit values that are not positive integers', () => {
    expect(() => parseRevalidateArgs(['--limit', '0'])).toThrow();
    expect(() => parseRevalidateArgs(['--limit', '-5'])).toThrow();
    expect(() => parseRevalidateArgs(['--limit', 'abc'])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Narrowing flags (--grammar-point / --ids-file / --deterministic-only).
// A full pass is ~13k rows; these exist so a targeted worklist does not have to
// pay for the whole pool.
// ---------------------------------------------------------------------------

describe('parseRevalidateArgs — narrowing flags', () => {
  it('defaults to no point filter, no ids file, and the LLM pass', () => {
    const args = parseRevalidateArgs([]);
    expect(args.grammarPoints).toEqual([]);
    expect(args.idsFile).toBeNull();
    expect(args.deterministicOnly).toBe(false);
  });

  it('accumulates repeated --grammar-point into a worklist', () => {
    const args = parseRevalidateArgs([
      '--grammar-point',
      'tr-a1-vowel-harmony',
      '--grammar-point',
      'tr-a1-plural-suffix',
    ]);
    expect(args.grammarPoints).toEqual([
      'tr-a1-vowel-harmony',
      'tr-a1-plural-suffix',
    ]);
  });

  it('rejects a grammar point that does not resolve in the curriculum', () => {
    // An unvalidated key silently selects zero rows, which reads as
    // "nothing to do" rather than "you typo'd".
    expect(() =>
      parseRevalidateArgs(['--grammar-point', 'tr-a1-does-not-exist']),
    ).toThrow(/unknown grammar point/);
  });

  it('parses --ids-file and --deterministic-only', () => {
    const args = parseRevalidateArgs([
      '--ids-file',
      './worklist.txt',
      '--deterministic-only',
    ]);
    expect(args.idsFile).toBe('./worklist.txt');
    expect(args.deterministicOnly).toBe(true);
  });
});

describe('parseIdsFile', () => {
  it('reads one id per line, ignoring blanks and # comments', () => {
    const ids = parseIdsFile(
      [
        '# context-carrying ES rows, 2026-08-13',
        '9ffc33c1-0000-4000-8000-000000000001',
        '',
        '  9ffc33c1-0000-4000-8000-000000000002  ',
      ].join('\n'),
    );
    expect(ids).toEqual([
      '9ffc33c1-0000-4000-8000-000000000001',
      '9ffc33c1-0000-4000-8000-000000000002',
    ]);
  });

  it('dedupes repeated ids so a row is never validated twice', () => {
    const ids = parseIdsFile(
      '9ffc33c1-0000-4000-8000-000000000001\n9ffc33c1-0000-4000-8000-000000000001',
    );
    expect(ids).toHaveLength(1);
  });

  it('throws on a line that is not a UUID rather than silently selecting nothing', () => {
    expect(() => parseIdsFile('not-a-uuid')).toThrow(/not a UUID/);
  });

  it('throws when the file yields no ids', () => {
    expect(() => parseIdsFile('# only a comment\n')).toThrow(/no ids/);
  });
});

describe('idsFileCandidates', () => {
  const CWD = '/repo/packages/db';
  const ROOT = '/repo';

  it('tries a relative path against the package cwd first, then the repo root', () => {
    // `pnpm --filter @language-drill/db` runs the script from packages/db, so a
    // repo-relative path a human copied out of the docs would otherwise ENOENT.
    expect(idsFileCandidates('docs/analysis/worklist.txt', CWD, ROOT)).toEqual([
      '/repo/packages/db/docs/analysis/worklist.txt',
      '/repo/docs/analysis/worklist.txt',
    ]);
  });

  it('leaves an absolute path exactly as given', () => {
    expect(idsFileCandidates('/tmp/worklist.txt', CWD, ROOT)).toEqual([
      '/tmp/worklist.txt',
    ]);
  });

  it('does not repeat a candidate when cwd is the repo root', () => {
    expect(idsFileCandidates('worklist.txt', ROOT, ROOT)).toEqual([
      '/repo/worklist.txt',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Validator model A/B flags (--validator-model / --validator-effort / --verdicts-out)
// ---------------------------------------------------------------------------

describe('parseRevalidateArgs — validator model A/B', () => {
  it('defaults to the production validator with no verdict dump', () => {
    const args = parseRevalidateArgs([]);
    expect(args.validatorModel).toBeNull();
    expect(args.validatorEffort).toBeNull();
    expect(args.verdictsOut).toBeNull();
  });

  it('parses --validator-model, --validator-effort and --verdicts-out on a dry run', () => {
    const args = parseRevalidateArgs([
      '--validator-model', 'claude-sonnet-5-5',
      '--validator-effort', 'low',
      '--verdicts-out', '/tmp/v.jsonl',
    ]);
    expect(args.validatorModel).toBe('claude-sonnet-5-5');
    expect(args.validatorEffort).toBe('low');
    expect(args.verdictsOut).toBe('/tmp/v.jsonl');
  });

  it('refuses a non-production validator together with --apply', () => {
    expect(() => parseRevalidateArgs(['--apply', '--validator-model', 'claude-sonnet-5-5'])).toThrow(/dry-run only/);
    expect(() => parseRevalidateArgs(['--validator-effort', 'low', '--apply'])).toThrow(/dry-run only/);
  });

  it('rejects an unknown model, a bad effort, and the flags under --deterministic-only', () => {
    expect(() => parseRevalidateArgs(['--validator-model', 'claude-mystery-9'])).toThrow(/No model capabilities/);
    expect(() => parseRevalidateArgs(['--validator-effort', 'huge'])).toThrow(/validator-effort/);
    expect(() => parseRevalidateArgs(['--deterministic-only', '--verdicts-out', 'x'])).toThrow(/deterministic-only/);
  });

  it('allows --verdicts-out with the production validator and --apply', () => {
    const args = parseRevalidateArgs(['--apply', '--verdicts-out', 'v.jsonl']);
    expect(args.apply).toBe(true);
    expect(args.verdictsOut).toBe('v.jsonl');
  });
});

describe('verdictRecord / verdictErrorRecord', () => {
  const row = { id: 'ex1', language: 'es', difficulty: 'B1', grammarPointKey: 'es-b1-x', reviewStatus: 'auto-approved' };
  const result = {
    qualityScore: 0.9,
    ambiguous: true,
    contextSpoilsAnswer: false,
    levelMatch: true,
    grammarPointMatch: true,
    culturalIssues: [],
    flaggedReasons: ['two fillers fit'],
  } as unknown as Parameters<typeof verdictRecord>[2];

  it('records the routed status next to the stored one', () => {
    const v = verdictRecord(row, 'claude-sonnet-5-5', result);
    expect(v).toMatchObject({
      id: 'ex1',
      storedStatus: 'auto-approved',
      model: 'claude-sonnet-5-5',
      route: 'flagged',
      qualityScore: 0.9,
      ambiguous: true,
      flaggedReasons: ['two fillers fit'],
    });
  });

  it('labels a failed call by error kind', () => {
    const v = verdictErrorRecord(row, 'claude-sonnet-5-5', new NoToolCallError('no tool', 'end_turn'));
    expect(v).toMatchObject({ id: 'ex1', errorKind: 'no_tool_call:end_turn', error: 'no tool' });
  });
});

