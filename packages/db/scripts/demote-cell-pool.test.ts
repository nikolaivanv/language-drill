/**
 * Tests for the `pnpm demote:pool` CLI.
 *
 * `parseDemoteArgs` tests are pure planning tests — no DB. Mirrors the
 * `parseDedupeArgs` / `parseReviewArgs` test style.
 *
 * `selectRowsToDemote` tests (added alongside `--limit`, fix round 1) run
 * against a hand-rolled fake `Db` that mimics Drizzle's chained
 * select/from/where/orderBy/limit builder — no real Postgres connection,
 * following the fake-`Db` pattern used in `backfill-mastery.test.ts`. `main`
 * itself stays untested (unexported, constructs its own `Db` from
 * `DATABASE_URL`); the row-selection query it delegates to is what's
 * covered here.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { Db } from '../src/client';
import { exercises } from '../src/schema';
import {
  findUnmatchedIds,
  parseDemoteArgs,
  selectRowsToDemote,
  type SelectRowsArgs,
} from './demote-cell-pool';

describe('parseDemoteArgs', () => {
  const required = [
    '--language', 'TR', '--cefr', 'A1', '--type', 'cloze',
    '--grammar-point', 'tr-a1-numbers-ordinals', '--reason', 'quality',
  ];

  it('defaults to dry-run with all filters parsed', () => {
    const args = parseDemoteArgs(required);
    expect(args).toEqual({
      language: 'TR', cefr: 'A1', type: 'cloze',
      grammarPoint: 'tr-a1-numbers-ordinals',
      contentIlike: null, apply: false, reason: 'quality', limit: null, idsFile: null,
    });
  });

  it('parses --apply and --content-ilike', () => {
    const args = parseDemoteArgs([...required, '--content-ilike', 'üçüncü', '--apply']);
    expect(args.apply).toBe(true);
    expect(args.contentIlike).toBe('üçüncü');
  });

  it('throws when a required filter is missing', () => {
    expect(() => parseDemoteArgs(['--language', 'TR'])).toThrow(/required/i);
  });

  it('uppercases --language and --cefr but leaves --type as-given', () => {
    const args = parseDemoteArgs([
      '--language', 'tr', '--cefr', 'a1', '--type', 'cloze',
      '--grammar-point', 'tr-a1-numbers-ordinals', '--reason', 'quality',
    ]);
    expect(args.language).toBe('TR');
    expect(args.cefr).toBe('A1');
    expect(args.type).toBe('cloze');
  });

  it('requires --reason so demotion intent is never guessed later', () => {
    expect(() =>
      parseDemoteArgs(['--language', 'TR', '--cefr', 'A1', '--type', 'cloze', '--grammar-point', 'tr-a1-locative']),
    ).toThrow(/--reason/);
  });

  it('rejects a reason outside the vocabulary', () => {
    expect(() =>
      parseDemoteArgs([
        '--language', 'TR', '--cefr', 'A1', '--type', 'cloze',
        '--grammar-point', 'tr-a1-locative', '--reason', 'because-i-said-so',
      ]),
    ).toThrow(/--reason/);
  });

  it('accepts each documented reason', () => {
    for (const reason of ['quality', 'learner-flag', 'duplicate', 'pool-hygiene'] as const) {
      const args = parseDemoteArgs([
        '--language', 'TR', '--cefr', 'A1', '--type', 'cloze',
        '--grammar-point', 'tr-a1-locative', '--reason', reason,
      ]);
      expect(args.reason).toBe(reason);
    }
  });
});

describe('parseDemoteArgs — limit', () => {
  // `--reason` is required by the current CLI; include it in every fixture.
  const base = ['--language', 'ES', '--cefr', 'B1', '--type', 'cloze',
                '--grammar-point', 'es-b1-impersonal-plural',
                '--reason', 'pool-hygiene'];

  it('defaults limit to null', () => {
    expect(parseDemoteArgs(base).limit).toBeNull();
  });

  it('parses a numeric limit', () => {
    expect(parseDemoteArgs([...base, '--limit', '28']).limit).toBe(28);
  });

  it('rejects a non-numeric limit', () => {
    expect(() => parseDemoteArgs([...base, '--limit', 'many'])).toThrow(/--limit/);
  });

  it('rejects a negative limit', () => {
    expect(() => parseDemoteArgs([...base, '--limit', '-3'])).toThrow(/--limit/);
  });

  it('rejects --limit given as the final token with no value, rather than silently disabling the cap', () => {
    // `get()` returns null both when a flag is absent and when it's the last
    // token in argv. Without an explicit presence check, `--limit` at the end
    // of a command line would silently fall back to "no cap" and demote an
    // entire matching cell instead of the intended N-row slice.
    expect(() => parseDemoteArgs([...base, '--limit'])).toThrow(/--limit/);
  });
});

describe('parseDemoteArgs — ids-file', () => {
  const base = [
    '--language', 'DE', '--cefr', 'B1', '--type', 'cloze',
    '--grammar-point', 'de-b1-relative-pronouns', '--reason', 'pool-hygiene',
  ];

  it('defaults idsFile to null', () => {
    expect(parseDemoteArgs(base).idsFile).toBeNull();
  });

  it('parses --ids-file as a path, without reading it', () => {
    // Parsing stays pure so it is unit-testable with no filesystem: main()
    // resolves and reads the path.
    const args = parseDemoteArgs([...base, '--ids-file', 'docs/analysis/worklist.json.txt']);
    expect(args.idsFile).toBe('docs/analysis/worklist.json.txt');
  });

  it('rejects --ids-file given as the final token with no value', () => {
    // Same trap as --limit: a bare trailing flag must not silently resolve to
    // "no ids file" and demote the whole cell.
    expect(() => parseDemoteArgs([...base, '--ids-file'])).toThrow(/--ids-file/);
  });

  it('rejects --ids-file combined with --limit', () => {
    // The id list IS the cap. Combining them is ambiguous — which subset of
    // the named rows would the limit keep? — and silently demoting fewer rows
    // than the file names is the exact failure this flag exists to prevent.
    expect(() => parseDemoteArgs([...base, '--ids-file', 'w.txt', '--limit', '5'])).toThrow(
      /--ids-file.*--limit|--limit.*--ids-file/s,
    );
  });

  it('rejects --ids-file combined with --content-ilike', () => {
    // Both narrow the selection. An operator who passes both almost certainly
    // believes one of them is doing nothing.
    expect(() =>
      parseDemoteArgs([...base, '--ids-file', 'w.txt', '--content-ilike', 'deren']),
    ).toThrow(/--ids-file.*--content-ilike|--content-ilike.*--ids-file/s);
  });
});

describe('findUnmatchedIds', () => {
  it('returns the ids that no selected row carries', () => {
    const rows = [{ id: 'aaaaaaaa-0000-4000-8000-000000000001' }];
    expect(
      findUnmatchedIds(
        ['aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002'],
        rows,
      ),
    ).toEqual(['bbbbbbbb-0000-4000-8000-000000000002']);
  });

  it('is empty when every requested id was selected', () => {
    const rows = [
      { id: 'aaaaaaaa-0000-4000-8000-000000000001' },
      { id: 'bbbbbbbb-0000-4000-8000-000000000002' },
    ];
    expect(
      findUnmatchedIds(
        ['aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002'],
        rows,
      ),
    ).toEqual([]);
  });

  it('compares case-insensitively, so an uppercase worklist is not reported as missing', () => {
    // parseIdsFile lowercases what it reads, but ids coming back from Postgres
    // could differ in case; a false "missing" here would block a correct run.
    const rows = [{ id: 'AAAAAAAA-0000-4000-8000-000000000001' }];
    expect(findUnmatchedIds(['aaaaaaaa-0000-4000-8000-000000000001'], rows)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// selectRowsToDemote — against a fake Db (no real Postgres connection)
// ---------------------------------------------------------------------------

const FIXTURE_ROWS = [
  { id: 'ex-1', contentJson: { stem: 'Dicen que...' } },
  { id: 'ex-2', contentJson: { stem: 'Me robaron la cartera.' } },
];

const SELECT_ARGS: SelectRowsArgs = {
  language: 'ES',
  cefr: 'B1',
  type: 'cloze',
  grammarPoint: 'es-b1-impersonal-plural',
  contentIlike: null,
  limit: null,
  ids: null,
};

/** The cell filters `selectRowsToDemote` always applies, for the ids test below. */
const baseFilters = (a: SelectRowsArgs) => [
  eq(exercises.language, a.language),
  eq(exercises.difficulty, a.cefr),
  eq(exercises.type, a.type),
  eq(exercises.grammarPointKey, a.grammarPoint),
  inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
];

/**
 * Mimics Drizzle's chained `select().from().where()` builder, which is
 * itself awaitable (`await` on the `.where()` result runs the unordered,
 * uncapped query) and also chainable via `.orderBy().limit()` for the
 * capped path. Records what `selectRowsToDemote` actually asked the db to
 * do, so the tests below assert on real call shape rather than trusting the
 * mock to already agree with the implementation.
 */
function makeFakeDb(rows: typeof FIXTURE_ROWS) {
  const calls = {
    whereCalls: 0,
    whereArg: undefined as unknown,
    orderByArg: undefined as unknown,
    limitArg: undefined as number | undefined,
  };

  const thenable = (value: unknown) => ({
    then(onfulfilled?: (v: unknown) => unknown, onrejected?: (e: unknown) => unknown) {
      return Promise.resolve(value).then(onfulfilled, onrejected);
    },
  });

  const db = {
    select: (_projection: unknown) => ({
      from: (_table: unknown) => ({
        where: (condition: unknown) => {
          calls.whereCalls += 1;
          calls.whereArg = condition;
          return {
            ...thenable(rows),
            orderBy: (ordering: unknown) => {
              calls.orderByArg = ordering;
              return {
                limit: (n: number) => {
                  calls.limitArg = n;
                  return Promise.resolve(rows);
                },
              };
            },
          };
        },
      }),
    }),
  } as unknown as Db;

  return { db, calls };
}

describe('selectRowsToDemote — capped selection', () => {
  it('with --limit, orders by created_at ascending and applies the parsed limit', async () => {
    const { db, calls } = makeFakeDb(FIXTURE_ROWS);

    await selectRowsToDemote(db, { ...SELECT_ARGS, limit: 28 });

    // Must be ascending created_at specifically — a bare LIMIT with no
    // ORDER BY (or the wrong column/direction) would not reliably keep the
    // oldest rows, which is the whole point of the cap.
    expect(calls.orderByArg).toEqual(asc(exercises.createdAt));
    expect(calls.limitArg).toBe(28);
  });

  it('without --limit, applies neither orderBy nor limit (unchanged from pre-flag behavior)', async () => {
    const { db, calls } = makeFakeDb(FIXTURE_ROWS);

    await selectRowsToDemote(db, { ...SELECT_ARGS, limit: null });

    expect(calls.orderByArg).toBeUndefined();
    expect(calls.limitArg).toBeUndefined();
  });

  it('runs the selection exactly once, and the returned rows are the same set both the dry-run report and the apply loop would consume', async () => {
    const { db, calls } = makeFakeDb(FIXTURE_ROWS);

    const rows = await selectRowsToDemote(db, { ...SELECT_ARGS, limit: 1 });

    // One query feeds both `main()`'s dry-run print (rows.length) and its
    // --apply update loop (for (const r of rows)). A future edit that forks
    // them — e.g. a separate COUNT for the dry-run message — would show up
    // here as a second `.where()` call.
    expect(calls.whereCalls).toBe(1);
    expect(rows).toEqual(FIXTURE_ROWS);
  });
});

describe('selectRowsToDemote — ids-file selection', () => {
  const IDS = ['aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002'];

  it('adds an id filter ON TOP of the cell filters, so an ids file cannot reach another cell', async () => {
    const { db, calls } = makeFakeDb(FIXTURE_ROWS);
    const args: SelectRowsArgs = { ...SELECT_ARGS, ids: IDS };

    await selectRowsToDemote(db, args);

    // Pins that the ids actually reach the query AND that the cell filters
    // survive alongside them. A regression that dropped either half would let
    // a worklist demote rows outside the cell the operator named.
    expect(calls.whereArg).toEqual(and(...baseFilters(args), inArray(exercises.id, [...IDS])));
  });

  it('applies neither orderBy nor limit — the id list is the selection, not a slice of it', async () => {
    const { db, calls } = makeFakeDb(FIXTURE_ROWS);

    await selectRowsToDemote(db, { ...SELECT_ARGS, ids: IDS });

    expect(calls.orderByArg).toBeUndefined();
    expect(calls.limitArg).toBeUndefined();
  });

  it('without ids, the where clause carries no id filter (unchanged from pre-flag behavior)', async () => {
    const { db, calls } = makeFakeDb(FIXTURE_ROWS);

    await selectRowsToDemote(db, SELECT_ARGS);

    expect(calls.whereArg).toEqual(and(...baseFilters(SELECT_ARGS)));
  });

  it('still combines the cell filters with --content-ilike when no ids are given', async () => {
    const { db, calls } = makeFakeDb(FIXTURE_ROWS);
    const args: SelectRowsArgs = { ...SELECT_ARGS, contentIlike: 'deren' };

    await selectRowsToDemote(db, args);

    expect(calls.whereArg).toEqual(
      and(
        ...baseFilters(args),
        sql`${exercises.contentJson}::text ILIKE ${'%deren%'}`,
      ),
    );
  });
});
