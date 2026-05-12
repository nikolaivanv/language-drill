import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Task 43 — Cross-Lambda contract test for Req 2.6
// ---------------------------------------------------------------------------
//
// Req 2.6: "The persisted entry (`POST /read/entries`) SHALL continue to
// insert the saved words into `user_vocabulary`; future annotations of new
// passages SHALL observe those rows on the next call."
//
// This test locks the invariant by exercising BOTH code paths against a
// SHARED in-memory database mock:
//
//   1. `POST /read/entries` handler (the read-collect Hono route in
//      `routes/read.ts`) writes a `user_vocabulary` row inside its
//      transaction.
//   2. `buildCandidateList` (the annotate-stream pre-filter pipeline in
//      `annotate-stream/pipeline.ts`) reads from `user_vocabulary` via its
//      post-filter.
//
// If the column shapes of the writer and the reader ever drift, this test
// will fail loudly. The two code paths run in separate Lambdas in production,
// so without a contract test the only way to catch drift is in production.
//
// We deliberately chose the in-memory mock route (NOT the `INTEGRATION=1`
// real-Neon path) so CI runs this test on every push without external
// dependencies. The spec brief explicitly calls out "in-memory mocked DB
// shared between both code paths."
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared in-memory store
// ---------------------------------------------------------------------------
// Both `read.ts` and `pipeline.ts` import `db` from `../db`. The single mock
// below routes every operation issued by either code path against the same
// row arrays — that's what makes this a *cross-Lambda* contract test rather
// than two isolated unit tests.
// ---------------------------------------------------------------------------

type ReadEntryRow = {
  id: string;
  userId: string;
  language: string;
  title: string;
  source: string;
  text: string;
  flaggedWords: Record<string, unknown>;
  bank: string[];
  pastedAt: Date;
};

type UserVocabularyRow = {
  userId: string;
  language: string;
  word: string;
  lemma: string;
  source: string;
  sourceReadEntryId: string | null;
  pos: string | null;
  gloss: string | null;
  exampleSentence: string | null;
  frequencyRank: number | null;
  cefrBand: string | null;
};

type UserLanguageProfileRow = {
  userId: string;
  language: string;
  proficiencyLevel: string;
};

const { store } = vi.hoisted(() => ({
  store: {
    readEntries: [] as ReadEntryRow[],
    userVocabulary: [] as UserVocabularyRow[],
    userLanguageProfiles: [] as UserLanguageProfileRow[],
    // Counter so each insert into read_entries gets a deterministic id.
    nextEntryId: 1,
  },
}));

function resetStore(): void {
  store.readEntries = [];
  store.userVocabulary = [];
  store.userLanguageProfiles = [];
  store.nextEntryId = 1;
}

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before the SUT imports.
// ---------------------------------------------------------------------------
//
// We tag the `@language-drill/db` table objects with string identifiers so the
// `db` mock can dispatch on table identity without importing the real schema
// objects (which would in turn pull in a real DB driver). The strings match
// the table the original Drizzle objects represent.
// ---------------------------------------------------------------------------

vi.mock("@language-drill/db", () => ({
  // Each tag triples as the `from(...)` discriminator AND the
  // `insert(...)` discriminator. The column properties are placeholders
  // — the mock's `.where(...)` ignores them and filters by userId+language
  // at the row level (we only use one userId+language pair per test).
  readEntries: {
    __mock: "readEntries",
    id: "id",
    userId: "user_id",
    language: "language",
    title: "title",
    source: "source",
    text: "text",
    flaggedWords: "flagged_words",
    bank: "bank",
    pastedAt: "pasted_at",
  },
  userVocabulary: {
    __mock: "userVocabulary",
    userId: "user_id",
    language: "language",
    word: "word",
    lemma: "lemma",
  },
  userLanguageProfiles: {
    __mock: "userLanguageProfiles",
    userId: "user_id",
    language: "language",
    proficiencyLevel: "proficiency_level",
  },
  users: { __mock: "users", id: "id" },
}));

// `drizzle-orm` is a real dep but `and`/`eq`/`sql` only need to be callable.
// The mocked `.where(...)` ignores its argument shape entirely — see the
// note inside the `../db` mock factory below for why that's safe.
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  desc: (col: unknown) => col,
  sql: (...args: unknown[]) => args,
}));

// ---------------------------------------------------------------------------
// `../db` mock — the centerpiece.
// ---------------------------------------------------------------------------
//
// Implements exactly the chain shapes that `read.ts` and `pipeline.ts` use:
//
//   read.ts (POST /read/entries):
//     db.transaction(async (tx) => {
//       tx.insert(readEntries).values({...}).returning({...})
//       tx.insert(userVocabulary).values([...]).onConflictDoUpdate({...})
//     })
//
//   read.ts (auth middleware fallback, only fires when c.set('userId',...)
//     hasn't pre-empted it):
//     db.insert(users).values({...}).onConflictDoNothing(...)
//
//   pipeline.ts (buildCandidateList):
//     db.select({...}).from(userLanguageProfiles).where(...).limit(1)
//     db.select({...}).from(userVocabulary).where(...)  (thenable + .catch)
//
// Filter handling: because every test below operates on a single
// (userId, language) pair, the `.where(...)` mock can safely ignore its
// arguments and let `.limit(1)` / `.then(...)` walk the entire backing
// array. This is a simplifying assumption — call it out if a future test
// ever needs multi-user / multi-language filtering.
// ---------------------------------------------------------------------------

vi.mock("../db", () => {
  type Tagged = { __mock?: string } | undefined;

  function makeInsertChain(table: Tagged) {
    return {
      values: (rowsOrRow: unknown) => {
        if (table?.__mock === "readEntries") {
          // POST /read/entries inserts a single object; expects `.returning(...)`.
          const row = rowsOrRow as Omit<ReadEntryRow, "id" | "pastedAt">;
          const id = `entry-${store.nextEntryId++}`;
          const pastedAt = new Date("2026-05-04T08:00:00.000Z");
          store.readEntries.push({ ...row, id, pastedAt });
          return {
            returning: () => Promise.resolve([{ id, pastedAt }]),
          };
        }
        if (table?.__mock === "userVocabulary") {
          // POST /read/entries inserts an array; expects `.onConflictDoUpdate(...)`.
          const rows = rowsOrRow as UserVocabularyRow[];
          for (const r of rows) {
            // Naive upsert on (userId, language, word) — the unique index in
            // production. No row in this test ever triggers a conflict, but
            // we honour the contract defensively in case a future test does.
            const existingIdx = store.userVocabulary.findIndex(
              (v) =>
                v.userId === r.userId &&
                v.language === r.language &&
                v.word === r.word,
            );
            if (existingIdx >= 0) {
              store.userVocabulary[existingIdx] = r;
            } else {
              store.userVocabulary.push(r);
            }
          }
          return {
            onConflictDoUpdate: () => Promise.resolve(),
          };
        }
        if (table?.__mock === "users") {
          // Auth middleware fallback — not exercised by these tests (we
          // pre-set `userId`), but supply a no-op terminator for safety.
          return {
            onConflictDoNothing: () => Promise.resolve(),
          };
        }
        throw new Error(
          `Unexpected table in insert: ${String(table?.__mock)}`,
        );
      },
    };
  }

  function makeSelectChain() {
    return {
      from(table: Tagged) {
        if (table?.__mock === "userLanguageProfiles") {
          // pipeline.ts: profile select → `.where(...).limit(1)` (awaited array).
          return {
            where: () => ({
              limit: (_n: number) =>
                Promise.resolve(
                  store.userLanguageProfiles.map((r) => ({
                    proficiencyLevel: r.proficiencyLevel,
                  })),
                ),
            }),
          };
        }
        if (table?.__mock === "userVocabulary") {
          // pipeline.ts: vocab select → `.where(...)` (thenable, no .limit()).
          // Must also be `.catch`-able because pipeline wraps the promise to
          // degrade on transient errors (see pipeline.ts:120).
          const projected = () =>
            store.userVocabulary.map((r) => ({
              word: r.word,
              lemma: r.lemma,
            }));
          return {
            where: () => ({
              catch(handler: (err: unknown) => unknown) {
                return Promise.resolve(projected()).catch(handler);
              },
              then(
                resolve: (v: unknown) => void,
                reject: (e: unknown) => void,
              ) {
                return Promise.resolve(projected()).then(resolve, reject);
              },
            }),
          };
        }
        throw new Error(
          `Unexpected table in select: ${String(table?.__mock)}`,
        );
      },
    };
  }

  // `db.transaction(fn)` calls `fn(tx)` with a tx that exposes the SAME
  // `insert` shape as the top-level db. We pass the same closure-bound
  // factory; the in-memory store has no rollback semantics (not needed —
  // these tests don't exercise failure paths).
  const dbMock = {
    select: () => makeSelectChain(),
    insert: (table: Tagged) => makeInsertChain(table),
    transaction: async (cb: (tx: unknown) => unknown) => {
      const tx = {
        insert: (table: Tagged) => makeInsertChain(table),
        // PUT /read/entries/:id/bank uses `tx.update(...)`. Not exercised
        // here, but stubbed for safety so an accidental call doesn't crash
        // mysteriously.
        update: () => ({
          set: () => ({ where: () => Promise.resolve() }),
        }),
      };
      return cb(tx);
    },
  };

  return { db: dbMock };
});

// ---------------------------------------------------------------------------
// Stub `@language-drill/ai` so we control which words look "rare" to
// `buildCandidateList`'s pre-filter. The post-filter (what Req 2.6 is about)
// only runs on survivors of the pre-filter, so the test word MUST be ranked
// rare enough to survive.
// ---------------------------------------------------------------------------

const { mockFreqLookup, mockIsStopword } = vi.hoisted(() => ({
  mockFreqLookup: vi.fn<(form: string) => unknown>(),
  mockIsStopword: vi.fn<(form: string) => boolean>(),
}));

vi.mock("@language-drill/ai", () => ({
  loadFrequency: () => ({
    lookup: (form: string) => mockFreqLookup(form),
    isStopword: (form: string) => mockIsStopword(form),
  }),
}));

// ---------------------------------------------------------------------------
// Imports of the SUT — must come AFTER the mock declarations above.
// ---------------------------------------------------------------------------

import { Language } from "@language-drill/shared";
import readRouter from "../routes/read";
import { buildCandidateList } from "./pipeline";

// ---------------------------------------------------------------------------
// Per-test reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStore();
  mockFreqLookup.mockReset();
  mockIsStopword.mockReset();
  // Defaults: nothing is a stopword, every word is unknown to the corpus
  // (pre-filter survivors get demoted but still pass through). Individual
  // tests override these as needed.
  mockFreqLookup.mockImplementation(() => null);
  mockIsStopword.mockImplementation(() => false);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// The contract test
// ---------------------------------------------------------------------------

describe("Cross-Lambda contract — Req 2.6 (saved words are not re-flagged)", () => {
  it("a word saved via POST /read/entries is dropped by buildCandidateList on a subsequent passage", async () => {
    const USER_ID = "user_contract";
    const LANGUAGE = Language.ES;

    // 1. Seed the user's proficiency so `buildCandidateList` uses a known
    //    topRank (B1 → 3000). Without this row, the pipeline falls back to
    //    DEFAULT_PROFICIENCY_LEVEL = B1 — so this seeding is technically
    //    optional, but explicit-is-better-than-implicit for a contract test.
    store.userLanguageProfiles.push({
      userId: USER_ID,
      language: LANGUAGE,
      proficiencyLevel: "B1",
    });

    // 2. Mark `aldea` as rank 9999 in the corpus — rare enough to survive
    //    B1's pre-filter (topRank = 3000). Everything else is unknown,
    //    which also survives but at a demoted rank.
    mockFreqLookup.mockImplementation((form) => {
      if (form === "aldea")
        return { lemma: "aldea", rank: 9999, cefr: "B2" };
      return null;
    });

    // 3. Mount the existing read router on a fresh Hono app. We don't
    //    re-implement the route; we use the real handler from
    //    `routes/read.ts` so column-shape drift in the INSERT statement
    //    would surface here.
    const app = new Hono();
    app.route("/", readRouter);

    // The auth middleware reads `sub` from the API Gateway JWT authorizer
    // claims. We synthesise that envelope via Hono's `app.request(..., env)`
    // third arg — the same pattern used by `routes/read.test.ts:198+`.
    const authEnv = {
      event: {
        requestContext: {
          authorizer: { jwt: { claims: { sub: USER_ID } } },
        },
      },
    };

    // 4. Save `aldea` via POST /read/entries.
    const saveRes = await app.request(
      "/read/entries",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: LANGUAGE,
          title: "first passage",
          source: "",
          text: "había una vez una aldea grande.",
          flagged: {
            aldea: {
              lemma: "aldea",
              pos: "noun",
              gloss: "a small village",
              example: "la aldea está cerca.",
              freq: 9999,
              cefr: "B2",
            },
          },
          bank: ["aldea"],
        }),
      },
      authEnv,
    );

    expect(saveRes.status).toBe(201);

    // 5. The write went through — the row now sits in `user_vocabulary`.
    //    This is the WRITER half of the contract. If the writer column
    //    names ever drift away from `word` / `lemma`, this assertion fires.
    expect(store.userVocabulary).toHaveLength(1);
    expect(store.userVocabulary[0]).toMatchObject({
      userId: USER_ID,
      language: LANGUAGE,
      word: "aldea",
      lemma: "aldea",
    });

    // 6. Now invoke `buildCandidateList` against a NEW passage that also
    //    contains `aldea`. The post-filter MUST observe the row written
    //    above and drop `aldea` from the candidate list.
    //
    //    The new passage uses a different surrounding sentence to make
    //    explicit that the test is not relying on text-level memoization
    //    — only on the column-level vocab contract.
    const { candidates } = await buildCandidateList({
      userId: USER_ID,
      language: LANGUAGE,
      text: "la aldea sigue allí, pero diferente.",
    });

    // 7. The contract assertion: `aldea` is NOT in the candidate list.
    //    This is the READER half of the contract. If the reader ever
    //    queries the wrong column (e.g. expects `surface_form` instead
    //    of `word`), the vocab set would be empty and `aldea` would
    //    erroneously survive the post-filter — failing this assertion.
    expect(
      candidates.find((c) => c.matchedForm === "aldea"),
    ).toBeUndefined();
  });

  it("post-filter also matches on the lemma column (defensive — Req 2.1)", async () => {
    // Inflected forms in the passage should be dropped if their lemma was
    // previously saved. This is not strictly Req 2.6 (which is the WRITE
    // side), but it locks the lemma half of the same column contract:
    // the writer's `lemma` column is the same one the reader joins on.
    const USER_ID = "user_contract_lemma";
    const LANGUAGE = Language.ES;

    store.userLanguageProfiles.push({
      userId: USER_ID,
      language: LANGUAGE,
      proficiencyLevel: "B1",
    });

    // Save lemma `aldea` via POST /read/entries (`aldea` is both word and
    // lemma in this case — we'll trigger the lemma-match path by querying
    // with `aldeas` later).
    const app = new Hono();
    app.route("/", readRouter);

    const authEnv = {
      event: {
        requestContext: {
          authorizer: { jwt: { claims: { sub: USER_ID } } },
        },
      },
    };

    const saveRes = await app.request(
      "/read/entries",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: LANGUAGE,
          title: "first",
          source: "",
          text: "una aldea silenciosa.",
          flagged: {
            aldea: {
              lemma: "aldea",
              pos: "noun",
              gloss: "village",
              example: "la aldea.",
              freq: 9999,
              cefr: "B2",
            },
          },
          bank: ["aldea"],
        }),
      },
      authEnv,
    );
    expect(saveRes.status).toBe(201);

    // Lookup `aldeas` (plural surface form) reports lemma `aldea` to the
    // pipeline. The post-filter should drop it because the lemma is in
    // user_vocabulary.
    mockFreqLookup.mockImplementation((form) => {
      if (form === "aldeas")
        return { lemma: "aldea", rank: 9999, cefr: "B2" };
      return null;
    });

    const { candidates } = await buildCandidateList({
      userId: USER_ID,
      language: LANGUAGE,
      text: "muchas aldeas pequeñas.",
    });

    expect(
      candidates.find((c) => c.matchedForm === "aldeas"),
    ).toBeUndefined();
  });
});
