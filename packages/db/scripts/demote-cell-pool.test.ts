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

import { asc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { Db } from '../src/client';
import { exercises } from '../src/schema';
import { parseDemoteArgs, selectRowsToDemote, type SelectRowsArgs } from './demote-cell-pool';

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
      contentIlike: null, apply: false, reason: 'quality', limit: null,
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
};

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
        where: (_condition: unknown) => {
          calls.whereCalls += 1;
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
