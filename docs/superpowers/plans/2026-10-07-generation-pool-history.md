# Generation Pool History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed each cloze / translation / sentence-construction cell's approved stems into the cached generation system prompt so new drafts stop reusing the pool's people, places, objects, scenes and templates — and add an `eval:gen --pool-history` arm that measures whether it works.

**Architecture:** The existing `priorPoolSurfaces` → `{{priorPoolSection}}` channel (already used by vocab_recall / free_writing / contextual_paraphrase) gains the three sentence types. `packages/db` fetches the stems and passes them in; `packages/ai` renders a new diversity-worded section for those types. eval:gen gets a `--pool-history` flag where both arms share prod's seeding and only the candidate sees the history, plus pure lexical-reuse metrics.

**Tech Stack:** TypeScript, Drizzle (Neon Postgres), Vitest, pnpm workspaces. Packages: `@language-drill/ai` (`packages/ai`), `@language-drill/db` (`packages/db`), `@language-drill/shared`.

**Spec:** `docs/superpowers/specs/2026-10-07-generation-pool-history-design.md`

## Global Constraints

- **Worktree:** all work happens in `/Users/seal/dev/language-drill/.claude/worktrees/generation-pool-history` on branch `feat/generation-pool-history`. Every file path below is relative to that root; use absolute paths prefixed with it for every Read/Edit/Write. Before every commit run `[ "$(git branch --show-current)" = feat/generation-pool-history ]`.
- **First-time setup in the worktree:** `pnpm install && pnpm build` before running any vitest (stale/missing `dist` fakes failures).
- `@language-drill/ai`'s `src/` must **not** import `@language-drill/db` (CI TS2307 build cycle). `packages/ai/scripts/*` may (they already do).
- History types are exactly: `cloze`, `translation`, `sentence_construction`.
- Stem mapping: cloze → `sentence`; translation → `sourceText`; sentence_construction → `prompt + " → " + modelAnswers[0]` (just `prompt` if no model answer).
- History rows: `review_status IN ('auto-approved','manual-approved')` only (flagged excluded); ordered by `id`; capped at **60**.
- vocab_recall, free_writing, contextual_paraphrase rendering must stay **byte-identical**.
- `GENERATION_PROMPT_VERSION` → `"generate@2026-10-07"`.
- Metric constants: hot token = in **≥15%** of the cell's pool stems **and ≥3** rows; content token = letter run of **≥4** chars, not a stopword, truncated to a **5**-char prefix.
- Decision rule: **ship-ready** iff candidate hot-reuse ≤ **0.7** × baseline **and** approval delta ≥ **−0.05**; `inconclusive` if the baseline has zero drafts or zero hot reuse; otherwise `inspect`.
- **Correction to the spec:** `--allow-prod` guards `LANGFUSE_ENV=prod`, not the database. `--pool-history` reads whatever `DATABASE_URL` points at, read-only, and prints that host at startup. No new DB-prod guard.
- Gate per package (full `pnpm test` gets OOM-killed on this machine): `pnpm --filter @language-drill/<pkg> lint`, `typecheck`, `test`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A cell with zero approved rows** — expected: the section is omitted and the system prompt is byte-identical to today's (no cache/cohort drift). Pinned in Task 1 (empty → no heading) and Task 2 (empty fetch → `[]`).
2. **Legacy or malformed `content_json`** (missing `sentence`, non-string `modelAnswers[0]`, wrong `type`) — expected: the row is skipped, never rendered as `- undefined` or `- null`. Pinned in Task 1 `historyStem` tests.
3. **Stems containing newlines or runs of whitespace** — expected: collapsed to one line so each bullet stays one bullet. Pinned in Task 1.
4. **A `--pool-history` run whose dataset includes a non-sentence cell** (vocab_recall, dictation) — expected: that cell is a per-cell error naming the restriction, not a silent run with no history. Pinned in Task 4.
5. **A baseline with no hot-token reuse** (pool <3 rows, or a diverse cell) — expected: verdict `inconclusive`, not `ship-ready` by `0 ≤ 0.7 × 0`. Pinned in Task 3.

---

### Task 1: `historyStem` + diversity-worded prior-pool section (packages/ai)

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts` (`renderPriorPoolSection` ~line 340; `GENERATION_PROMPT_VERSION` ~line 136; add `historyStem` after `normaliseSurface` ~line 975)
- Modify: `packages/ai/src/index.ts:199-210` (export `historyStem`)
- Test: `packages/ai/src/generation-prompts.test.ts`

**Interfaces:**
- Produces: `export function historyStem(content: unknown): string | null` — exported from `@language-drill/ai`. Used by Task 2 (`fetchPriorStems`) and Task 4 (draft stems).
- Produces: `export const HISTORY_STEM_TYPES: ReadonlySet<ExerciseType>` (cloze, translation, sentence_construction) — exported from `@language-drill/ai`. Used by Tasks 2 and 4.

- [ ] **Step 1: Write the failing tests**

In `packages/ai/src/generation-prompts.test.ts`, add `historyStem` and `HISTORY_STEM_TYPES` to the existing import from `./generation-prompts` (or `../src/index.js`, whichever the file already uses for `buildGenerationSystemPrompt`). Then:

(a) Replace the existing test `"uses sentence-surface wording for non-VOCAB_RECALL types"` (it uses CLOZE, which now gets new wording) with:

```ts
  it("keeps the sentence-surface dedup wording for CONTEXTUAL_PARAPHRASE (byte-identical)", async () => {
    const prompt = await buildGenerationSystemPrompt(
      {
        ...baseInputs,
        exerciseType: ExerciseType.CONTEXTUAL_PARAPHRASE,
        priorPoolSurfaces: ["yo hablo espanol."],
      },
      [],
    );
    expect(prompt).toContain(
      "## Already in the pool — do NOT propose any exercise whose surface matches these\n\n  - yo hablo espanol.\n\n",
    );
    expect(prompt).not.toContain("Already in this cell");
  });

  it.each([
    ExerciseType.CLOZE,
    ExerciseType.TRANSLATION,
    ExerciseType.SENTENCE_CONSTRUCTION,
  ])("renders the cell-history diversity section for %s", async (exerciseType) => {
    const prompt = await buildGenerationSystemPrompt(
      {
        ...baseInputs,
        exerciseType,
        priorPoolSurfaces: ["Mi hermana ___ en casa.", "El café ___ cerrado."],
      },
      [],
    );
    expect(prompt).toContain("## Already in this cell — write something different");
    expect(prompt).toContain("reusing the tested form is expected");
    expect(prompt).toContain(
      "Do not reuse their people, relationships, places, objects or situations",
    );
    expect(prompt).toContain("takes precedence over this list");
    expect(prompt).toContain("  - Mi hermana ___ en casa.\n  - El café ___ cerrado.\n\n");
    expect(prompt).not.toContain("do NOT propose any exercise whose surface matches");
  });

  it("HISTORY_STEM_TYPES is exactly cloze, translation and sentence_construction", () => {
    expect([...HISTORY_STEM_TYPES].sort()).toEqual(
      [ExerciseType.CLOZE, ExerciseType.SENTENCE_CONSTRUCTION, ExerciseType.TRANSLATION].sort(),
    );
  });
```

(b) Strengthen the two existing omission tests (`"omits the 'Already in the pool' section when priorPoolSurfaces is undefined"` / `"... is empty"`, which use cloze `baseInputs`) by adding to each:

```ts
    expect(prompt).not.toContain("Already in this cell");
```

(c) Add a new `describe` block at the end of the file:

```ts
describe("historyStem", () => {
  it("returns the cloze sentence", () => {
    expect(
      historyStem({ type: ExerciseType.CLOZE, instructions: "x", sentence: "Mi hermana ___ aquí.", correctAnswer: "está" }),
    ).toBe("Mi hermana ___ aquí.");
  });

  it("returns the translation source text", () => {
    expect(
      historyStem({ type: ExerciseType.TRANSLATION, instructions: "x", sourceText: "My sister is at home.", referenceTranslation: "Mi hermana está en casa." }),
    ).toBe("My sister is at home.");
  });

  it("joins the SC prompt with its first model answer", () => {
    expect(
      historyStem({ type: ExerciseType.SENTENCE_CONSTRUCTION, instructions: "x", promptMode: "situation", prompt: "Describe your favourite café.", modelAnswers: ["El café donde trabajo es pequeño.", "otra"] }),
    ).toBe("Describe your favourite café. → El café donde trabajo es pequeño.");
  });

  it("falls back to the SC prompt when there is no usable model answer", () => {
    expect(historyStem({ type: ExerciseType.SENTENCE_CONSTRUCTION, prompt: "Describe a café.", modelAnswers: [] })).toBe("Describe a café.");
    expect(historyStem({ type: ExerciseType.SENTENCE_CONSTRUCTION, prompt: "Describe a café.", modelAnswers: [42] })).toBe("Describe a café.");
  });

  it("collapses newlines and whitespace runs to single spaces", () => {
    expect(historyStem({ type: ExerciseType.CLOZE, sentence: "  Mi hermana\n___   aquí.\t" })).toBe("Mi hermana ___ aquí.");
  });

  it("returns null for malformed or out-of-scope content", () => {
    expect(historyStem(undefined)).toBeNull();
    expect(historyStem(null)).toBeNull();
    expect(historyStem("cloze")).toBeNull();
    expect(historyStem({ type: ExerciseType.CLOZE })).toBeNull();
    expect(historyStem({ type: ExerciseType.CLOZE, sentence: "   " })).toBeNull();
    expect(historyStem({ type: ExerciseType.SENTENCE_CONSTRUCTION, prompt: 7, modelAnswers: ["x"] })).toBeNull();
    expect(historyStem({ type: ExerciseType.VOCAB_RECALL, prompt: "x", expectedWord: "casa" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/ai test -- src/generation-prompts.test.ts`
Expected: FAIL — `historyStem` / `HISTORY_STEM_TYPES` not exported, and the cloze/translation/SC cases render the old heading.

- [ ] **Step 3: Implement**

In `packages/ai/src/generation-prompts.ts`:

1. Change the version constant:

```ts
export const GENERATION_PROMPT_VERSION = "generate@2026-10-07";
```

2. Just above `renderPriorPoolSection`, add:

```ts
/**
 * Exercise types whose `priorPoolSurfaces` is the cell's approved stems — a
 * DIVERSITY signal ("don't reuse these people/places/scenes"), not a dedup
 * avoid-list. Each draft is its own call and cells fill over many batches, so
 * without this no draft ever sees what the cell already holds; lexical fillers
 * and scenes collapse onto the model's prototype ("my sister" 15/38 in #727,
 * "café" 41/46 in es-b1-relative-clauses SC). The other types keep their
 * byte-identical dedup wording.
 */
export const HISTORY_STEM_TYPES: ReadonlySet<ExerciseType> = new Set([
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
  ExerciseType.SENTENCE_CONSTRUCTION,
]);
```

3. Replace the body of `renderPriorPoolSection` with:

```ts
  if (!priorPoolSurfaces || priorPoolSurfaces.length === 0) return "";
  const capped = capPriorPoolSurfaces(priorPoolSurfaces);
  const bullets = capped.map((surface) => `  - ${surface}`).join("\n");
  if (HISTORY_STEM_TYPES.has(exerciseType)) {
    // Phrased per draft ("invent your own"), never "vary across drafts": each
    // draft is a separate call, so cross-draft instructions are inert (#727).
    return (
      "## Already in this cell — write something different\n\n" +
      "These exercises are already in the pool for this cell. They test the same grammar as yours, so reusing the tested form is expected. " +
      "Do not reuse their people, relationships, places, objects or situations, and do not mirror any sentence's template. " +
      "Invent your own rather than reusing these. " +
      "If this exercise has an assigned seed word or sub-construction, that assignment takes precedence over this list.\n\n" +
      `${bullets}\n\n`
    );
  }
  const heading =
    exerciseType === ExerciseType.VOCAB_RECALL
      ? "## Already in the pool — do NOT propose any of these target words"
      : "## Already in the pool — do NOT propose any exercise whose surface matches these";
  return `${heading}\n\n${bullets}\n\n`;
```

4. After `normaliseSurface`, add:

```ts
/**
 * The line a stored or drafted exercise contributes to its cell's history
 * (`HISTORY_STEM_TYPES` only): cloze → `sentence`, translation → `sourceText`,
 * sentence_construction → `prompt → modelAnswers[0]` (the café collapse lived
 * in the model answers). Takes `unknown` because callers pass raw
 * `content_json`; anything malformed or out of scope returns `null` so it is
 * skipped rather than rendered as "undefined". Whitespace is collapsed so a
 * stem is always exactly one bullet line.
 */
export function historyStem(content: unknown): string | null {
  if (typeof content !== "object" || content === null) return null;
  const c = content as Record<string, unknown>;
  const text = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const collapsed = v.replace(/\s+/gu, " ").trim();
    return collapsed.length > 0 ? collapsed : null;
  };
  switch (c.type) {
    case ExerciseType.CLOZE:
      return text(c.sentence);
    case ExerciseType.TRANSLATION:
      return text(c.sourceText);
    case ExerciseType.SENTENCE_CONSTRUCTION: {
      const prompt = text(c.prompt);
      if (prompt === null) return null;
      const answer = Array.isArray(c.modelAnswers) ? text(c.modelAnswers[0]) : null;
      return answer === null ? prompt : `${prompt} → ${answer}`;
    }
    default:
      return null;
  }
}
```

In `packages/ai/src/index.ts`, add `historyStem` and `HISTORY_STEM_TYPES` to the `export { ... } from "./generation-prompts.js";` list (lines ~199-210).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- src/generation-prompts.test.ts`
Expected: PASS, including the existing `GENERATION_SYSTEM_PROMPT_TEMPLATE byte parity` suite (the section is rendered into an existing `{{priorPoolSection}}` var, so the parity holds). If any test pins the old version string `generate@2026-09-22`, update it to `generate@2026-10-07`: `grep -rn "generate@2026-09-22" packages/ apps/ infra/ --include=*.ts`.

- [ ] **Step 5: Package gate + commit**

```bash
pnpm --filter @language-drill/ai lint && pnpm --filter @language-drill/ai typecheck && pnpm --filter @language-drill/ai test
[ "$(git branch --show-current)" = feat/generation-pool-history ] && \
git add packages/ai/src/generation-prompts.ts packages/ai/src/generation-prompts.test.ts packages/ai/src/index.ts && \
git commit -m "Render a cell-history diversity section for cloze, translation and SC prompts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `fetchPriorStems`, wiring, and `buildCellSeedWords` extraction (packages/db)

**Files:**
- Modify: `packages/db/src/generation/run-one-cell.ts` (new `fetchPriorStems` after `fetchPriorParaphraseSurfaces` ~line 491; new `buildCellSeedWords` after `buildSeedWords`; wiring at ~line 968; seed block at ~lines 980-1015)
- Modify: `packages/db/src/generation/index.ts:37-41` (exports)
- Test: `packages/db/src/generation/run-one-cell.test.ts`

**Interfaces:**
- Consumes: `historyStem`, `HISTORY_STEM_TYPES` from `@language-drill/ai` (Task 1).
- Produces (exported from `@language-drill/db`):
  - `export const MAX_PRIOR_STEMS = 60;`
  - `export async function fetchPriorStems(db: Db, cell: Cell): Promise<readonly string[]>`
  - `export async function buildCellSeedWords(db: Db, cell: Cell, count: number, batchSeed: string, coverageTargets?: readonly CoverageTarget[]): Promise<readonly (string | null)[] | undefined>`

- [ ] **Step 1: Write the failing tests**

In `run-one-cell.test.ts`:

(a) Add `buildCellSeedWords`, `fetchPriorStems`, `MAX_PRIOR_STEMS` to the import from `'./run-one-cell'`.

(b) In the `'runOneCell — approvedDictationIds collection (pool-mocked)'` describe, make `makeMockDb` take the rows every select resolves to:

```ts
  function makeMockDb(
    rows: ReadonlyArray<Record<string, unknown>> = [{ id: 'skill-topic-row' }],
  ): { db: Db } {
    const selectResult = Promise.resolve(rows);
```

(leave the rest of `makeMockDb` unchanged; existing callers pass nothing). Then add, inside that describe:

```ts
  it.each([
    [
      ExerciseType.CLOZE,
      { type: ExerciseType.CLOZE, instructions: 'x', sentence: 'Mi hermana ___ en casa.', correctAnswer: 'está' },
      'Mi hermana ___ en casa.',
    ],
    [
      ExerciseType.SENTENCE_CONSTRUCTION,
      { type: ExerciseType.SENTENCE_CONSTRUCTION, instructions: 'x', promptMode: 'situation', prompt: 'Describe a café.', modelAnswers: ['El café es pequeño.'] },
      'Describe a café. → El café es pequeño.',
    ],
  ])('passes the cell history to the generator for a %s cell', async (exerciseType, contentJson, stem) => {
    const { db } = makeMockDb([{ id: 'skill-topic-row', contentJson }]);
    await runOneCell({
      db,
      client: {} as never,
      cell: buildCell(exerciseType),
      args: { count: 3, batchSeed: `history-${exerciseType}`, topicDomain: null, maxCostUsd: 5 },
      jobId: randomUUID(),
      trigger: 'scheduled',
    });
    const spec = vi.mocked(runGeneratorPool).mock.calls[0][0].spec;
    expect(spec.priorPoolSurfaces).toEqual([stem]);
  });

  it('passes no cell history for a dictation cell', async () => {
    const { db } = makeMockDb();
    await runOneCell({
      db,
      client: {} as never,
      cell: buildCell(ExerciseType.DICTATION),
      args: { count: 3, batchSeed: 'history-dictation', topicDomain: null, maxCostUsd: 5 },
      jobId: randomUUID(),
      trigger: 'scheduled',
    });
    expect(vi.mocked(runGeneratorPool).mock.calls[0][0].spec.priorPoolSurfaces).toBeUndefined();
  });
```

If the SC case fails because another select on the SC path chokes on the extra `contentJson` field, read the stack trace, and narrow that test to CLOZE + TRANSLATION (translation content: `{ type: ExerciseType.TRANSLATION, instructions: 'x', sourceText: 'My sister is at home.', referenceTranslation: 'Mi hermana está en casa.' }` → `'My sister is at home.'`) rather than altering production code; SC mapping is already pinned by Task 1.

(c) Add an ungated `buildCellSeedWords` test next to the other `buildSeedWords — ... (no DB)` suites:

```ts
describe('buildCellSeedWords — unseeded kind (no DB)', () => {
  const throwingDb = new Proxy(
    {},
    {
      get() {
        throw new Error('buildCellSeedWords queried the DB for an unseeded cell');
      },
    },
  ) as unknown as Db;

  it('returns undefined without touching the DB when the cell has no seed kind', async () => {
    const clozeCell = buildTestCell();
    const cell: Cell = {
      ...clozeCell,
      exerciseType: ExerciseType.CONJUGATION,
      grammarPoint: { ...clozeCell.grammarPoint, conjugationSeedKind: 'none' },
      cellKey: 'es:b1:conjugation:es-unseeded-test',
    };
    expect(seedKindFor(cell)).toBeNull();
    await expect(buildCellSeedWords(throwingDb, cell, 3, 'seed-none')).resolves.toBeUndefined();
  });
});
```

(d) Add a DB-gated `fetchPriorStems` suite after the `fetchPriorVocabRecallSurfaces` suite (same pattern; does not run in CI, run it locally if `TEST_DATABASE_URL` is available):

```ts
const STEMS_GP_KEY = 'es-b1-prior-stems-test';

const stemsCell: Cell = {
  language: Language.ES as LearningLanguage,
  cefrLevel: CefrLevel.B1 as CurriculumCefrLevel,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint: { key: STEMS_GP_KEY } as unknown as Cell['grammarPoint'],
  cellKey: `es:b1:cloze:${STEMS_GP_KEY}`,
};

async function seedClozeRow(
  db: Db,
  sentence: string,
  reviewStatus: 'auto-approved' | 'manual-approved' | 'flagged',
): Promise<void> {
  const content = { type: ExerciseType.CLOZE, instructions: 'x', sentence, correctAnswer: 'está' };
  await db.insert(exercises).values({
    id: randomUUID(),
    type: ExerciseType.CLOZE,
    language: Language.ES,
    difficulty: 'B1',
    contentJson: { ...content, _dedupKey: canonicalSurface(content as Parameters<typeof canonicalSurface>[0]) },
    grammarPointKey: STEMS_GP_KEY,
    generationSource: 'claude-realtime',
    modelId: 'claude-sonnet-4-5',
    reviewStatus,
    generatedAt: new Date('2026-04-01T00:00:00Z'),
  });
}

async function cleanStemRows(db: Db): Promise<void> {
  const rows = await db.select({ id: exercises.id }).from(exercises).where(eq(exercises.grammarPointKey, STEMS_GP_KEY));
  for (const row of rows) {
    await db.delete(exerciseTags).where(eq(exerciseTags.exerciseId, row.id));
    await db.delete(exercises).where(eq(exercises.id, row.id));
  }
}

describe.skipIf(!process.env['TEST_DATABASE_URL'])('fetchPriorStems — approved cell history', () => {
  let db: Db;
  beforeAll(() => {
    db = createDb(process.env['TEST_DATABASE_URL']!);
  });
  beforeEach(async () => {
    await cleanStemRows(db);
  });
  afterEach(async () => {
    await cleanStemRows(db);
  });

  it('returns approved stems and excludes flagged rows', async () => {
    await seedClozeRow(db, 'Mi hermana ___ en casa.', 'auto-approved');
    await seedClozeRow(db, 'El café ___ cerrado.', 'manual-approved');
    await seedClozeRow(db, 'El perro ___ fuera.', 'flagged');
    const stems = await fetchPriorStems(db, stemsCell);
    expect([...stems].sort()).toEqual(['El café ___ cerrado.', 'Mi hermana ___ en casa.']);
  });

  it('caps at MAX_PRIOR_STEMS and is deterministic', async () => {
    for (let i = 0; i < MAX_PRIOR_STEMS + 3; i++) {
      await seedClozeRow(db, `Frase número ${i} ___ aquí.`, 'auto-approved');
    }
    const a = await fetchPriorStems(db, stemsCell);
    const b = await fetchPriorStems(db, stemsCell);
    expect(a).toHaveLength(MAX_PRIOR_STEMS);
    expect(a).toEqual(b);
  });

  it('returns [] for an empty cell', async () => {
    await expect(fetchPriorStems(db, stemsCell)).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/db test -- src/generation/run-one-cell.test.ts`
Expected: FAIL — `buildCellSeedWords` / `fetchPriorStems` / `MAX_PRIOR_STEMS` not exported; cloze cell's `priorPoolSurfaces` is `undefined`.

- [ ] **Step 3: Implement**

In `packages/db/src/generation/run-one-cell.ts`:

1. Add `historyStem` and `HISTORY_STEM_TYPES` to the `@language-drill/ai` import block (lines ~25-32).

2. After `fetchPriorParaphraseSurfaces`, add:

```ts
/** Cap on approved stems fed into the generation prompt as cell history. */
export const MAX_PRIOR_STEMS = 60;

/**
 * The cell's approved stems (`historyStem`: cloze sentence, translation source,
 * SC prompt → first model answer), fed into the generation system prompt as a
 * diversity signal so drafts stop reusing the pool's people, places, objects
 * and scenes across batches. Flagged rows are deliberately excluded (unlike the
 * dedup fetchers above): they are evidence limbo and may be demoted, so steering
 * away from them is wasted signal. Ordered by `id` — a fixed, time-unbiased
 * sample — and capped so the system-prompt bytes are identical across every
 * ordinal in the batch and the cache prefix hits. Rows whose content yields no
 * stem are skipped.
 */
export async function fetchPriorStems(db: Db, cell: Cell): Promise<readonly string[]> {
  const rows = await db
    .select({ contentJson: exercises.contentJson })
    .from(exercises)
    .where(
      and(
        eq(exercises.language, cell.language),
        eq(exercises.difficulty, cell.cefrLevel),
        eq(exercises.type, cell.exerciseType),
        eq(exercises.grammarPointKey, cell.grammarPoint.key),
        inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
      ),
    )
    .orderBy(exercises.id)
    .limit(MAX_PRIOR_STEMS);
  return rows
    .map((r) => historyStem(r.contentJson))
    .filter((s): s is string => s !== null);
}
```

3. After `buildSeedWords`, add `buildCellSeedWords`, moving the seed-kind / prior-seed block (and its comments) out of `runOneCell` verbatim:

```ts
/**
 * The full per-cell seeding step `runOneCell` performs: pick the seed kind,
 * fetch that kind's prior-seed exclude set, and build the per-ordinal seeds.
 * Exported so `eval:gen --pool-history` gives both arms exactly prod's seeds.
 */
export async function buildCellSeedWords(
  db: Db,
  cell: Cell,
  count: number,
  batchSeed: string,
  coverageTargets?: readonly CoverageTarget[],
): Promise<readonly (string | null)[] | undefined> {
  // <moved comment block: "Seed cloze/translation with at-level content words, ...">
  const seedKind = seedKindFor(cell);
  const priorSeeds: ReadonlySet<string> =
    // <moved verbatim: the whole ternary from runOneCell, including its comments>
  return buildSeedWords(db, cell, count, batchSeed, priorSeeds, coverageTargets);
}
```

The `// <moved ...>` lines mean: cut the exact text from `runOneCell` (from the `// Seed cloze/translation with at-level content words` comment through the end of the `priorSeeds` ternary) and paste it here unchanged. Do not retype it.

4. In `runOneCell`, replace the removed block and the `buildSeedWords(...)` call with:

```ts
    const seedWords = await buildCellSeedWords(
      db,
      cell,
      args.count,
      args.batchSeed,
      args.coverageTargets,
    );
```

5. Replace the `priorPoolSurfaces` ternary and its comment (~line 963-976) with:

```ts
    // Pull the cell's existing inventory into the generator's system prompt.
    // vocab_recall / free_writing / contextual_paraphrase get a dedup
    // avoid-list. cloze / translation / SC get the cell's approved stems as a
    // diversity signal: cells are capped at 20–50 rows, so the whole history
    // is ~1–2k tokens written to the cache once per batch — the old "surface
    // space is unbounded" reason for excluding them no longer holds, and
    // without it lexical fillers collapse across batches (#727's "my sister").
    const priorPoolSurfaces =
      cell.exerciseType === ExerciseType.VOCAB_RECALL
        ? await fetchPriorVocabRecallSurfaces(db, cell)
        : cell.exerciseType === ExerciseType.FREE_WRITING
          ? await fetchPriorFreeWritingTitles(db, cell)
          : cell.exerciseType === ExerciseType.CONTEXTUAL_PARAPHRASE
            ? await fetchPriorParaphraseSurfaces(db, cell)
            : HISTORY_STEM_TYPES.has(cell.exerciseType)
              ? await fetchPriorStems(db, cell)
              : undefined;
```

6. In `packages/db/src/generation/index.ts`, extend the `run-one-cell` export:

```ts
export {
  runOneCell,
  buildCellSeedWords,
  fetchPriorStems,
  MAX_PRIOR_STEMS,
  type CellResult,
  type RunOneCellInput,
} from './run-one-cell';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai build && pnpm --filter @language-drill/db test -- src/generation/run-one-cell.test.ts`
Expected: PASS (the DB-gated suites skip without `TEST_DATABASE_URL`). All pre-existing `buildSeedWords` / `seedKindFor` / pool-mocked tests still pass unchanged — that is the evidence the extraction preserved behaviour. If `TEST_DATABASE_URL` is set locally, also confirm the new `fetchPriorStems` suite passes rather than skips.

- [ ] **Step 5: Package gate + commit**

```bash
pnpm --filter @language-drill/db lint && pnpm --filter @language-drill/db typecheck && pnpm --filter @language-drill/db test
[ "$(git branch --show-current)" = feat/generation-pool-history ] && \
git add packages/db/src/generation/run-one-cell.ts packages/db/src/generation/run-one-cell.test.ts packages/db/src/generation/index.ts && \
git commit -m "Feed each sentence cell's approved stems to the generator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pool-reuse metrics (pure)

**Files:**
- Create: `packages/ai/scripts/pool-reuse-metrics.ts`
- Test: `packages/ai/scripts/pool-reuse-metrics.test.ts`

**Interfaces:**
- Produces (all exported from `packages/ai/scripts/pool-reuse-metrics.ts`):
  - constants `HOT_MIN_SHARE = 0.15`, `HOT_MIN_ROWS = 3`, `MIN_TOKEN_LEN = 4`, `PREFIX_LEN = 5`, `SHIP_REUSE_RATIO = 0.7`, `MAX_APPROVAL_DROP = 0.05`
  - `type HotToken = { token: string; rows: number; share: number }`
  - `type CellReuse = { drafts: number; hotHits: number; jaccardSum: number }`
  - `type ReuseFold = { drafts: number; hotReuseRate: number; meanMaxJaccard: number }`
  - `type ReuseVerdict = "ship-ready" | "inspect" | "inconclusive"`
  - `contentTokens(text: string): Set<string>`
  - `hotTokens(poolStems: readonly string[]): HotToken[]` (sorted by rows desc, then token asc)
  - `maxJaccard(draftStem: string, poolStems: readonly string[]): number`
  - `cellReuse(draftStems: readonly string[], poolStems: readonly string[]): CellReuse`
  - `foldReuse(cells: readonly CellReuse[]): ReuseFold`
  - `reuseVerdict(baseline: ReuseFold, candidate: ReuseFold, approvalRateDelta: number): ReuseVerdict`

- [ ] **Step 1: Write the failing tests**

Create `packages/ai/scripts/pool-reuse-metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  cellReuse,
  contentTokens,
  foldReuse,
  hotTokens,
  maxJaccard,
  reuseVerdict,
} from "./pool-reuse-metrics";

describe("contentTokens", () => {
  it("lowercases, strips diacritics, drops short words and stopwords, and prefixes to 5 chars", () => {
    // "Mi"/"en"/"el"/"con" < 4 chars; "está" → "esta" and "nosotros" are stopwords.
    expect([...contentTokens("Mi Hermana está en el café con nosotros")].sort()).toEqual(
      ["cafe", "herma"],
    );
  });

  it("drops English stopwords so translation sources are comparable", () => {
    // they/said/that/their/would are stopwords; sister → "siste".
    expect([...contentTokens("They said that their sister would visit")].sort()).toEqual(
      ["siste", "visit"],
    );
  });

  it("returns an empty set for text with no content words", () => {
    expect(contentTokens("— ___ ?")).toEqual(new Set());
  });
});

describe("hotTokens", () => {
  const pool = [
    "Mi hermana ___ en casa.",
    "La casa de mi hermana ___ grande.",
    "Mi hermana ___ médica.",
    "El perro ___ fuera.",
    "El tren ___ tarde.",
    "La tienda ___ cerrada.",
  ];

  it("returns tokens in ≥15% of stems and ≥3 rows, most frequent first", () => {
    expect(hotTokens(pool)).toEqual([{ token: "herma", rows: 3, share: 0.5 }]);
  });

  it("requires at least 3 rows even when the share is high", () => {
    expect(hotTokens(["Mi hermana ___.", "Mi hermana ___ aquí."])).toEqual([]);
  });

  it("counts a token once per stem", () => {
    expect(hotTokens(["hermana hermana hermana ___", "otra frase ___", "más cosas ___"])).toEqual([]);
  });
});

describe("maxJaccard", () => {
  it("is 1 for an identical stem and 0 with no overlap or an empty pool", () => {
    expect(maxJaccard("Mi hermana ___ en casa.", ["Mi hermana ___ en casa."])).toBe(1);
    expect(maxJaccard("El tren ___ tarde.", ["Mi hermana ___ en casa."])).toBe(0);
    expect(maxJaccard("El tren ___ tarde.", [])).toBe(0);
  });

  it("takes the best match across the pool", () => {
    // draft {herma, medic}; pool[1] {herma, casa} → 1/3; pool[0] {perro, fuera} → 0
    expect(maxJaccard("Mi hermana ___ médica.", ["El perro ___ fuera.", "Mi hermana ___ en casa."])).toBeCloseTo(1 / 3, 10);
  });
});

describe("cellReuse + foldReuse", () => {
  const pool = ["Mi hermana ___ en casa.", "Mi hermana ___ médica.", "Mi hermana ___ aquí.", "El tren ___ tarde."];

  it("counts drafts containing any hot token and sums max-Jaccard", () => {
    const r = cellReuse(["Tu hermana ___ cansada.", "El vecino ___ ruidoso."], pool);
    expect(r.drafts).toBe(2);
    expect(r.hotHits).toBe(1);
    expect(r.jaccardSum).toBeGreaterThan(0);
  });

  it("folds cells by pooling drafts, not averaging rates", () => {
    const fold = foldReuse([
      { drafts: 10, hotHits: 5, jaccardSum: 2 },
      { drafts: 30, hotHits: 3, jaccardSum: 3 },
    ]);
    expect(fold).toEqual({ drafts: 40, hotReuseRate: 8 / 40, meanMaxJaccard: 5 / 40 });
  });

  it("folds an empty input to zeros", () => {
    expect(foldReuse([])).toEqual({ drafts: 0, hotReuseRate: 0, meanMaxJaccard: 0 });
  });
});

describe("reuseVerdict", () => {
  const fold = (hotReuseRate: number, drafts = 100): { drafts: number; hotReuseRate: number; meanMaxJaccard: number } => ({
    drafts,
    hotReuseRate,
    meanMaxJaccard: 0,
  });

  it("is ship-ready when reuse falls to ≤0.7× and approval drops ≤5pp", () => {
    expect(reuseVerdict(fold(0.5), fold(0.35), -0.05)).toBe("ship-ready");
  });

  it("is inspect when reuse does not fall enough", () => {
    expect(reuseVerdict(fold(0.5), fold(0.36), 0)).toBe("inspect");
  });

  it("is inspect when approval drops more than 5pp", () => {
    expect(reuseVerdict(fold(0.5), fold(0.1), -0.06)).toBe("inspect");
  });

  it("is inconclusive when the baseline has no hot reuse or no drafts", () => {
    expect(reuseVerdict(fold(0), fold(0), 0)).toBe("inconclusive");
    expect(reuseVerdict(fold(0.5, 0), fold(0.1), 0)).toBe("inconclusive");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/ai exec vitest run scripts/pool-reuse-metrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/ai/scripts/pool-reuse-metrics.ts`:

```ts
/**
 * Lexical-reuse metrics for `eval:gen --pool-history`: do new drafts reuse the
 * cell's over-represented content words (its "hot tokens") and mirror existing
 * stems less once the generator sees the cell's history?
 *
 * Deliberately crude: a 5-character prefix stands in for a lemma (good enough
 * to compare two arms over the same cells in ES/DE/TR/EN, not a linguistic
 * measure), and stopwords are one union list because translation sources are
 * English while cloze stems are target-language. The hot-token list is printed
 * per cell so a reader can tell the tested form (`donde`) from filler
 * (`herma…`, `cafe`) — the metric does not try to.
 */

export const HOT_MIN_SHARE = 0.15;
export const HOT_MIN_ROWS = 3;
export const MIN_TOKEN_LEN = 4;
export const PREFIX_LEN = 5;
/** Ship-ready iff candidate hot-reuse ≤ SHIP_REUSE_RATIO × baseline … */
export const SHIP_REUSE_RATIO = 0.7;
/** … and approval drops by at most this much (absolute, 0.05 = 5pp). */
export const MAX_APPROVAL_DROP = 0.05;

export type HotToken = { token: string; rows: number; share: number };
export type CellReuse = { drafts: number; hotHits: number; jaccardSum: number };
export type ReuseFold = { drafts: number; hotReuseRate: number; meanMaxJaccard: number };
export type ReuseVerdict = "ship-ready" | "inspect" | "inconclusive";

// Matched against the full lowercased, diacritic-stripped word (before
// prefixing). Words under MIN_TOKEN_LEN never reach this list.
const STOPWORDS: ReadonlySet<string> = new Set([
  // EN
  "that", "this", "these", "those", "with", "have", "from", "they", "them", "their",
  "there", "what", "when", "where", "which", "will", "would", "your", "were", "been",
  "about", "into", "some", "than", "then", "very", "just", "said", "also",
  // ES
  "para", "como", "pero", "este", "esta", "esto", "estos", "estas", "ella", "ellas",
  "ellos", "todo", "toda", "todos", "todas", "porque", "cuando", "sobre", "desde",
  "hasta", "entre", "tambien", "siempre", "nunca", "mucho", "mucha", "muchos",
  "nosotros", "vosotros", "usted", "ustedes",
  // DE
  "nicht", "eine", "einen", "einem", "einer", "eines", "dass", "aber", "wenn", "auch",
  "noch", "schon", "sehr", "oder", "sind", "habe", "haben", "wird", "werden", "kann",
  "mein", "meine", "dein", "deine", "sein", "seine", "ihre",
  // TR
  "icin", "gibi", "daha", "olan", "kadar", "sonra", "butun", "bunu", "buna", "onun",
  "benim", "senin",
]);

export function contentTokens(text: string): Set<string> {
  const words =
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{Diacritic}+/gu, "")
      .match(/\p{L}+/gu) ?? [];
  const out = new Set<string>();
  for (const w of words) {
    if (w.length < MIN_TOKEN_LEN || STOPWORDS.has(w)) continue;
    out.add(w.slice(0, PREFIX_LEN));
  }
  return out;
}

export function hotTokens(poolStems: readonly string[]): HotToken[] {
  if (poolStems.length === 0) return [];
  const rows = new Map<string, number>();
  for (const stem of poolStems) {
    for (const t of contentTokens(stem)) rows.set(t, (rows.get(t) ?? 0) + 1);
  }
  const out: HotToken[] = [];
  for (const [token, n] of rows) {
    const share = n / poolStems.length;
    if (n >= HOT_MIN_ROWS && share >= HOT_MIN_SHARE) out.push({ token, rows: n, share });
  }
  return out.sort((a, b) => b.rows - a.rows || a.token.localeCompare(b.token));
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function maxJaccard(draftStem: string, poolStems: readonly string[]): number {
  const d = contentTokens(draftStem);
  let best = 0;
  for (const p of poolStems) best = Math.max(best, jaccard(d, contentTokens(p)));
  return best;
}

export function cellReuse(draftStems: readonly string[], poolStems: readonly string[]): CellReuse {
  const hot = new Set(hotTokens(poolStems).map((h) => h.token));
  let hotHits = 0;
  let jaccardSum = 0;
  for (const stem of draftStems) {
    const tokens = contentTokens(stem);
    if ([...tokens].some((t) => hot.has(t))) hotHits++;
    jaccardSum += maxJaccard(stem, poolStems);
  }
  return { drafts: draftStems.length, hotHits, jaccardSum };
}

/** Pools drafts across cells (a 30-draft cell weighs 3× a 10-draft cell). */
export function foldReuse(cells: readonly CellReuse[]): ReuseFold {
  let drafts = 0;
  let hotHits = 0;
  let jaccardSum = 0;
  for (const c of cells) {
    drafts += c.drafts;
    hotHits += c.hotHits;
    jaccardSum += c.jaccardSum;
  }
  return drafts === 0
    ? { drafts: 0, hotReuseRate: 0, meanMaxJaccard: 0 }
    : { drafts, hotReuseRate: hotHits / drafts, meanMaxJaccard: jaccardSum / drafts };
}

/**
 * The spec's pre-registered decision rule. `inconclusive` when the baseline
 * shows no hot-token reuse at all — otherwise `0 ≤ 0.7 × 0` would call a
 * no-signal run ship-ready.
 */
export function reuseVerdict(
  baseline: ReuseFold,
  candidate: ReuseFold,
  approvalRateDelta: number,
): ReuseVerdict {
  if (baseline.drafts === 0 || baseline.hotReuseRate === 0) return "inconclusive";
  const reuseFell = candidate.hotReuseRate <= SHIP_REUSE_RATIO * baseline.hotReuseRate;
  const approvalHeld = approvalRateDelta >= -MAX_APPROVAL_DROP - 1e-9;
  return reuseFell && approvalHeld ? "ship-ready" : "inspect";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai exec vitest run scripts/pool-reuse-metrics.test.ts`
Expected: PASS. If a hand-computed expectation is off (e.g. a word you assumed was a stopword is not), fix the **test's** expected value only after checking the token by hand with `contentTokens`, and say so in the commit message; never widen `STOPWORDS` just to make a test pass.

- [ ] **Step 5: Commit**

```bash
pnpm --filter @language-drill/ai lint && pnpm --filter @language-drill/ai typecheck
[ "$(git branch --show-current)" = feat/generation-pool-history ] && \
git add packages/ai/scripts/pool-reuse-metrics.ts packages/ai/scripts/pool-reuse-metrics.test.ts && \
git commit -m "Add lexical pool-reuse metrics for generation evals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `eval:gen --pool-history`

**Files:**
- Modify: `packages/ai/scripts/eval-gen-run.ts`
- Test: `packages/ai/scripts/eval-gen-run.test.ts`

**Interfaces:**
- Consumes: `historyStem`, `HISTORY_STEM_TYPES` from `../src/index.js` (Task 1); `fetchPriorStems`, `buildCellSeedWords`, `createDb`, `requireEnv`, `buildCellKey`, types `Cell`, `Db` from `@language-drill/db` (Task 2); everything from `./pool-reuse-metrics` (Task 3).
- Produces (exported from `eval-gen-run.ts`):
  - `EvalGenArgs.poolHistory?: boolean`
  - `DraftOutcome.stem?: string`
  - `GenCellArmExecutorParams.explicitSeeds?: { seedWords: readonly (string | null)[] | undefined }`
  - `GenCellRecord.poolStems?: readonly string[]`
  - `type PoolContext = { stems: readonly string[]; seedWords: readonly (string | null)[] | undefined }`
  - `type PoolContextLoader = (resolved: ResolvedCell, draftsPerCell: number, batchSeed: string) => Promise<PoolContext>`
  - `runGenEval` option `poolContextLoader?: PoolContextLoader`
  - `GenEvalSummary.poolReuse?: { baseline: ReuseFold; candidate: ReuseFold; verdict: ReuseVerdict; perCell: Array<{ cellKey: string; hot: HotToken[]; baseline: ReuseFold; candidate: ReuseFold }> }`
  - `makeDbPoolContextLoader(db: Db): PoolContextLoader`

- [ ] **Step 1: Write the failing tests**

In `eval-gen-run.test.ts`, add `type PoolContextLoader` to the `./eval-gen-run` import, then add:

```ts
describe("parseEvalGenArgs — --pool-history", () => {
  it("defaults poolHistory to false and sets it with the flag", () => {
    const base = ["--candidate", "repo", "--dataset-file", "cells.json"];
    expect(parseEvalGenArgs(base).poolHistory).toBe(false);
    expect(parseEvalGenArgs([...base, "--pool-history"]).poolHistory).toBe(true);
  });
});

describe("runGenEval — --pool-history", () => {
  const STEM = "Mi hermana ___ en casa.";
  const loaderReturning = (seedWords: readonly (string | null)[] | undefined): PoolContextLoader =>
    vi.fn(async () => ({ stems: [STEM], seedWords }));

  it("gives both arms the loader's seeds and only the candidate the history", async () => {
    const seen: GenCellArmExecutorParams[] = [];
    const executor: GenCellArmExecutor = vi.fn(async (p) => {
      seen.push(p);
      return armResult();
    });
    const result = await runGenEval({
      ...runOpts({ executor, dataset: [cellEntry("tr-a1-locative")], args: { poolHistory: true } }),
      poolContextLoader: loaderReturning(["ev", null]),
    });

    expect(seen).toHaveLength(2);
    const [base, cand] = seen;
    expect(base.explicitSeeds).toEqual({ seedWords: ["ev", null] });
    expect(cand.explicitSeeds).toEqual({ seedWords: ["ev", null] });
    expect(cand.systemPromptOverride).toContain(`  - ${STEM}`);
    expect(cand.systemPromptOverride).toContain("## Already in this cell");
    expect(base.systemPromptOverride).not.toContain(STEM);
    expect(result.cells[0].poolStems).toEqual([STEM]);
  });

  it("records a non-sentence cell as a per-cell error without loading or generating", async () => {
    const executor: GenCellArmExecutor = vi.fn(async () => armResult());
    const loader = loaderReturning(undefined);
    const result = await runGenEval({
      ...runOpts({
        executor,
        dataset: [cellEntry("tr-a1-present-continuous", "TR", "A1", "vocab_recall")],
        args: { poolHistory: true },
      }),
      poolContextLoader: loader,
    });
    expect(executor).not.toHaveBeenCalled();
    expect(loader).not.toHaveBeenCalled();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/--pool-history supports cloze, translation and sentence_construction only/);
  });

  it("throws up front when --pool-history is set without a loader", async () => {
    const executor: GenCellArmExecutor = vi.fn(async () => armResult());
    await expect(
      runGenEval(runOpts({ executor, dataset: [cellEntry("tr-a1-locative")], args: { poolHistory: true } })),
    ).rejects.toThrow(/pool context loader/);
  });

  it("leaves non-pool runs untouched: no explicitSeeds, no poolStems", async () => {
    const seen: GenCellArmExecutorParams[] = [];
    const executor: GenCellArmExecutor = vi.fn(async (p) => {
      seen.push(p);
      return armResult();
    });
    const result = await runGenEval(runOpts({ executor, dataset: [cellEntry("tr-a1-locative")] }));
    expect(seen.every((p) => p.explicitSeeds === undefined)).toBe(true);
    expect(result.cells[0].poolStems).toBeUndefined();
  });
});

describe("makeRealArmExecutor — explicit seeds and stems", () => {
  beforeEach(() => {
    mockGenerateBatch.mockReset();
    mockValidateDraft.mockReset();
  });

  it("uses explicitSeeds verbatim, stamps variantId only for variant ids, and records each draft's stem", async () => {
    const grammarPoint = getGrammarPoint("tr-a1-locative");
    if (!grammarPoint) throw new Error("fixture key missing");
    const cell: CellDescriptor = {
      language: Language.TR,
      cefrLevel: CefrLevel.A1,
      exerciseType: ExerciseType.CLOZE,
      grammarPointKey: "tr-a1-locative",
    };
    mockGenerateBatch.mockResolvedValue({
      drafts: [
        { id: "d1", contentJson: { type: ExerciseType.CLOZE, instructions: "x", sentence: "Kedi ___ uyuyor.", correctAnswer: "evde" } },
        { id: "d2" },
      ] as ExerciseDraft[],
      tokenUsage: ZERO_USAGE,
      malformedDrafts: [],
    } satisfies GenerateBatchResult);
    mockValidateDraft.mockResolvedValue({ result: approveResult(), tokenUsage: ZERO_USAGE });

    const arm = await makeRealArmExecutor({} as never)({
      cell,
      grammarPoint,
      systemPromptOverride: "SYSTEM",
      draftsPerCell: 2,
      batchSeed: "eval-gen",
      seedConstructionVariants: true,
      explicitSeeds: { seedWords: ["ev", null] },
    });

    expect(mockGenerateBatch.mock.calls[0][1].seedWords).toEqual(["ev", null]);
    // "ev" is a frequency seed, not one of the point's variant ids.
    expect(arm.outcomes.map((o) => o.variantId)).toEqual([undefined, undefined]);
    expect(arm.outcomes[0].stem).toBe("Kedi ___ uyuyor.");
    expect(arm.outcomes[1].stem).toBeUndefined();
  });
});

describe("computeGenDiff + renderMarkdownSummary — pool reuse", () => {
  const POOL = ["Mi hermana ___ en casa.", "Mi hermana ___ médica.", "Mi hermana ___ aquí.", "El tren ___ tarde."];
  const outcome = (stem: string): DraftOutcome => ({ bucket: "auto-approved", reasons: [], stem });
  const run = (poolStems?: readonly string[]): GenEvalRunResult => ({
    runName: "pool-run",
    baseline: { source: "repo", sha: "aaaa1111" },
    candidate: { source: "repo", sha: "aaaa1111" },
    datasetName: "cells.json",
    startedAt: "2026-10-07T00:00:00.000Z",
    draftsPerCell: 2,
    costCapped: false,
    cells: [
      {
        cellKey: "ES:B1:cloze:es-b1-nominalizers",
        baseline: { outcomes: [outcome("Tu hermana ___ cansada."), outcome("Mi hermana ___ lista.")], usage: ZERO_USAGE },
        candidate: { outcomes: [outcome("El vecino ___ ruidoso."), outcome("La jefa ___ ocupada.")], usage: ZERO_USAGE },
        ...(poolStems ? { poolStems } : {}),
      },
    ],
    errors: [],
  });

  it("computes per-arm reuse and the verdict when cells carry poolStems", () => {
    const summary = computeGenDiff(run(POOL));
    expect(summary.poolReuse?.baseline.hotReuseRate).toBe(1);
    expect(summary.poolReuse?.candidate.hotReuseRate).toBe(0);
    expect(summary.poolReuse?.verdict).toBe("ship-ready");
    expect(summary.poolReuse?.perCell[0].hot.map((h) => h.token)).toEqual(["herma"]);

    const md = renderMarkdownSummary(summary);
    expect(md).toContain("## Pool reuse (--pool-history)");
    expect(md).toMatch(/\| hot-token reuse rate \| 100\.0% \| 0\.0% \|/);
    expect(md).toContain("**Verdict:** ship-ready");
    expect(md).toContain("herma (75%)");
  });

  it("omits poolReuse and its section for ordinary runs", () => {
    const summary = computeGenDiff(run());
    expect(summary.poolReuse).toBeUndefined();
    expect(renderMarkdownSummary(summary)).not.toContain("Pool reuse");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/ai exec vitest run scripts/eval-gen-run.test.ts`
Expected: FAIL — `poolHistory` undefined, `explicitSeeds`/`poolContextLoader` ignored, no `poolReuse`.

- [ ] **Step 3: Implement**

All edits in `packages/ai/scripts/eval-gen-run.ts`.

1. **Imports.** Extend the shared import with `type CurriculumCefrLevel, type LearningLanguage` (both from `@language-drill/shared`). Extend the `@language-drill/db` import:

```ts
import {
  buildCellKey,
  buildCellSeedWords,
  createDb,
  fetchPriorStems,
  getGrammarPoint,
  requireEnv,
  routeValidationResult,
  type Cell,
  type Db,
} from "@language-drill/db";
```

Add `HISTORY_STEM_TYPES` and `historyStem` to the `../src/index.js` import, and add:

```ts
import {
  cellReuse,
  foldReuse,
  hotTokens,
  reuseVerdict,
  type HotToken,
  type ReuseFold,
  type ReuseVerdict,
} from "./pool-reuse-metrics.js";
```

2. **Types.** Add `stem?: string;` to `DraftOutcome` with the doc comment `/** \`historyStem\` of the draft (cloze/translation/SC); read by the --pool-history reuse metrics. Absent for parser failures and drafts with no stem. */`. Add to `EvalGenArgs`:

```ts
  /** `--pool-history`: candidate sees the cell's approved stems; both arms get prod's seeds. */
  poolHistory?: boolean;
```

Add to `GenCellArmExecutorParams`:

```ts
  /**
   * `--pool-history` only: the per-ordinal seeds BOTH arms share (prod's
   * `buildCellSeedWords`). When set it replaces `seedWordsForArm`, removing the
   * baseline-unseeded/candidate-seeded asymmetry so the history section is the
   * only difference between arms. The wrapper distinguishes "explicitly
   * unseeded" (`{ seedWords: undefined }`) from "not in pool mode" (absent).
   */
  explicitSeeds?: { seedWords: readonly (string | null)[] | undefined };
```

Add to `GenCellRecord`: `/** --pool-history only: the cell's approved stems fed to the candidate. */ poolStems?: readonly string[];`

Add after `GenEvalRunResult`:

```ts
/** What `--pool-history` loads per cell from the database. */
export type PoolContext = {
  stems: readonly string[];
  seedWords: readonly (string | null)[] | undefined;
};

/** Port so tests can stub the database. See `makeDbPoolContextLoader`. */
export type PoolContextLoader = (
  resolved: ResolvedCell,
  draftsPerCell: number,
  batchSeed: string,
) => Promise<PoolContext>;
```

Add to `GenEvalSummary`:

```ts
  /** `--pool-history` runs only: lexical reuse vs. each cell's pool + the spec's decision rule. */
  poolReuse?: {
    baseline: ReuseFold;
    candidate: ReuseFold;
    verdict: ReuseVerdict;
    perCell: Array<{ cellKey: string; hot: HotToken[]; baseline: ReuseFold; candidate: ReuseFold }>;
  };
```

3. **Executor** (`makeRealArmExecutor`). Destructure `explicitSeeds` from the params. Replace the `variantSeeds` computation and its uses:

```ts
    const seedWords = explicitSeeds
      ? explicitSeeds.seedWords
      : seedWordsForArm(grammarPoint, cell.exerciseType, draftsPerCell, seedConstructionVariants);
    // Explicit (prod) seeds mix frequency lemmas with variant ids; only the
    // latter belong in `variantCounts`.
    const variantIds = new Set(variantsForType(grammarPoint, cell.exerciseType).map((v) => v.id));
    const variantFor = (o: number): string | undefined => {
      const s = seedWords?.[o];
      return s != null && variantIds.has(s) ? s : undefined;
    };
```

Set `seedWords` (not `variantSeeds`) on the spec. In the draft loop, add `const stem = historyStem(draft.contentJson);` right after the `routeValidationResult` line, and replace `variantId: variantSeeds?.[ordinal],` with:

```ts
        variantId: variantFor(ordinal),
        ...(stem !== null ? { stem } : {}),
```

In the malformed loop replace `variantId: variantSeeds?.[malformed.ordinal],` with `variantId: variantFor(malformed.ordinal),`.

4. **Orchestrator** (`runGenEval`). Add `poolContextLoader?: PoolContextLoader;` to the opts type and destructure it. Right after the destructuring add:

```ts
  if (args.poolHistory && !poolContextLoader) {
    throw new Error("[eval-gen] --pool-history requires a pool context loader (DATABASE_URL)");
  }
```

Inside the per-cell `try`, before the dictation block:

```ts
      let pool: PoolContext | undefined;
      if (args.poolHistory) {
        if (!HISTORY_STEM_TYPES.has(cell.exerciseType)) {
          throw new Error(
            `--pool-history supports cloze, translation and sentence_construction only (got ${cell.exerciseType})`,
          );
        }
        pool = await poolContextLoader!(resolution, args.draftsPerCell, batchSeed);
      }
      const explicitSeeds = pool ? { seedWords: pool.seedWords } : undefined;
```

Render the candidate with the history:

```ts
      const candidatePrompt = isDictation
        ? undefined
        : renderSystemPrompt(
            candidate.templateBody,
            pool ? { ...inputs, priorPoolSurfaces: pool.stems } : inputs,
          );
```

Pass `explicitSeeds` in both executor calls. Push the cell as:

```ts
      cells.push({
        cellKey,
        baseline: baselineResult,
        candidate: candidateResult,
        ...(pool ? { poolStems: pool.stems } : {}),
      });
```

Add one log line after the existing start log: `if (args.poolHistory) log("[eval-gen] --pool-history: candidate sees each cell's approved stems; both arms share prod seeds");`

5. **Diff.** At the end of `computeGenDiff`, before `return`, compute:

```ts
  const stemsOf = (arm: ArmResult): string[] =>
    arm.outcomes.flatMap((o) => (o.stem !== undefined ? [o.stem] : []));
  const pooled = run.cells.filter((c) => c.poolStems !== undefined);
  const approvalRateDelta = candidateStats.approvalRate - baselineStats.approvalRate;
  let poolReuse: GenEvalSummary["poolReuse"];
  if (pooled.length > 0) {
    const per = pooled.map((c) => ({
      cellKey: c.cellKey,
      hot: hotTokens(c.poolStems!),
      baseline: cellReuse(stemsOf(c.baseline), c.poolStems!),
      candidate: cellReuse(stemsOf(c.candidate), c.poolStems!),
    }));
    const baselineFold = foldReuse(per.map((p) => p.baseline));
    const candidateFold = foldReuse(per.map((p) => p.candidate));
    poolReuse = {
      baseline: baselineFold,
      candidate: candidateFold,
      verdict: reuseVerdict(baselineFold, candidateFold, approvalRateDelta),
      perCell: per.map((p) => ({
        cellKey: p.cellKey,
        hot: p.hot,
        baseline: foldReuse([p.baseline]),
        candidate: foldReuse([p.candidate]),
      })),
    };
  }
```

Use `approvalRateDelta` in the returned object (replacing the inline expression) and add `...(poolReuse ? { poolReuse } : {}),`.

6. **Render.** In `renderMarkdownSummary`, after the Construction-variants table and before Rejection reasons, add:

```ts
  if (summary.poolReuse) {
    const pr = summary.poolReuse;
    lines.push("");
    lines.push("## Pool reuse (--pool-history)");
    lines.push("");
    lines.push("| Metric | Baseline | Candidate |");
    lines.push("|---|---|---|");
    lines.push(`| hot-token reuse rate | ${pct(pr.baseline.hotReuseRate)} | ${pct(pr.candidate.hotReuseRate)} |`);
    lines.push(`| mean max-Jaccard vs pool | ${pr.baseline.meanMaxJaccard.toFixed(3)} | ${pr.candidate.meanMaxJaccard.toFixed(3)} |`);
    lines.push(`| drafts with a stem | ${pr.baseline.drafts} | ${pr.candidate.drafts} |`);
    lines.push("");
    lines.push(
      `**Verdict:** ${pr.verdict} — ship-ready iff candidate hot-reuse ≤ 0.7 × baseline and approval Δ ≥ −5pp; inconclusive if the baseline shows no hot reuse.`,
    );
    lines.push("");
    lines.push("| cell | hot tokens | reuse (b → c) | max-Jaccard (b → c) |");
    lines.push("|---|---|---|---|");
    for (const c of pr.perCell) {
      const hot = c.hot.map((h) => `${h.token} (${Math.round(h.share * 100)}%)`).join(", ") || "_(none)_";
      lines.push(
        `| ${c.cellKey} | ${hot} | ${pct(c.baseline.hotReuseRate)} → ${pct(c.candidate.hotReuseRate)} | ` +
          `${c.baseline.meanMaxJaccard.toFixed(3)} → ${c.candidate.meanMaxJaccard.toFixed(3)} |`,
      );
    }
  }
```

7. **Args.** In `parseEvalGenArgs` add `"pool-history": { type: "boolean", default: false },` to options and `poolHistory: parsed.values["pool-history"] ?? false,` to the return. In `printGenUsage` add `"  --pool-history           Candidate sees each cell's approved stems (reads DATABASE_URL);",` and `"                           both arms get prod's seeds. cloze/translation/SC cells only.",` and append ` [--pool-history]` to the third usage line.

8. **DB loader + main.** Add above `main`:

```ts
/** Real `--pool-history` loader: the cell's approved stems + prod's seeds, read-only. */
export function makeDbPoolContextLoader(db: Db): PoolContextLoader {
  return async ({ cell, grammarPoint }, draftsPerCell, batchSeed) => {
    const dbCell: Cell = {
      language: cell.language as LearningLanguage,
      cefrLevel: cell.cefrLevel as CurriculumCefrLevel,
      exerciseType: cell.exerciseType,
      grammarPoint,
      cellKey: buildCellKey(cell),
    };
    const [stems, seedWords] = await Promise.all([
      fetchPriorStems(db, dbCell),
      buildCellSeedWords(db, dbCell, draftsPerCell, batchSeed),
    ]);
    return { stems, seedWords };
  };
}
```

In `main`, before `runGenEval`:

```ts
  let poolContextLoader: PoolContextLoader | undefined;
  if (args.poolHistory) {
    const dbUrl = requireEnv("DATABASE_URL");
    // `--allow-prod` guards LANGFUSE_ENV, not the database: say which pool is read.
    console.log(`[eval-gen] --pool-history reading the pool (read-only) from ${new URL(dbUrl).host}`);
    poolContextLoader = makeDbPoolContextLoader(createDb(dbUrl));
  }
```

and pass `poolContextLoader` into `runGenEval({...})`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/ai exec vitest run scripts/eval-gen-run.test.ts scripts/pool-reuse-metrics.test.ts`
Expected: PASS, including every pre-existing eval-gen test (the `variantId` behaviour for `seedWordsForArm` seeds is unchanged because those seeds are all variant ids).

- [ ] **Step 5: Package gate + commit**

```bash
pnpm --filter @language-drill/ai lint && pnpm --filter @language-drill/ai typecheck && pnpm --filter @language-drill/ai test
[ "$(git branch --show-current)" = feat/generation-pool-history ] && \
git add packages/ai/scripts/eval-gen-run.ts packages/ai/scripts/eval-gen-run.test.ts && \
git commit -m "Add an eval:gen --pool-history arm with pool-reuse metrics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dataset fixture, Langfuse check, docs, PR

**Files:**
- Create: `packages/ai/scripts/fixtures/cells-pool-history.json`
- Modify: `CLAUDE.md` (the `pnpm eval:gen` row in "Running Locally")

**Interfaces:**
- Consumes: `hotTokens` (Task 3) for ranking; the `--pool-history` CLI (Task 4).

- [ ] **Step 1: List candidate cells on the prod branch (read-only)**

Using the Neon MCP `run_sql` on the **prod** branch (see memory `local-env-db-is-dev-branch` for the branch id; local `.env` points at dev):

```sql
SELECT language, difficulty AS cefr_level, type, grammar_point_key, count(*) AS n
FROM exercises
WHERE review_status IN ('auto-approved', 'manual-approved')
  AND type IN ('cloze', 'translation', 'sentence_construction')
  AND grammar_point_key IS NOT NULL
GROUP BY 1, 2, 3, 4
HAVING count(*) >= 20
ORDER BY 1, 2, 3, 4;
```

- [ ] **Step 2: Rank by hot-token concentration**

For the candidate cells, pull stems with:

```sql
SELECT language, difficulty, type, grammar_point_key, content_json
FROM exercises
WHERE review_status IN ('auto-approved', 'manual-approved')
  AND type IN ('cloze', 'translation', 'sentence_construction')
  AND grammar_point_key = ANY($1);
```

Save the rows as JSON in the scratchpad, and rank with a throwaway script in the scratchpad (not committed):

```ts
// scratchpad/rank-cells.ts — run with: pnpm --filter @language-drill/ai exec tsx <abs path>
import { readFileSync } from "node:fs";
import { historyStem } from "<worktree>/packages/ai/src/index.js";
import { hotTokens } from "<worktree>/packages/ai/scripts/pool-reuse-metrics.js";

const rows = JSON.parse(readFileSync(process.argv[2], "utf8")) as Array<Record<string, unknown>>;
const byCell = new Map<string, string[]>();
for (const r of rows) {
  const key = `${r.language}|${r.difficulty}|${r.type}|${r.grammar_point_key}`;
  const stem = historyStem(r.content_json);
  if (stem) byCell.set(key, [...(byCell.get(key) ?? []), stem]);
}
const ranked = [...byCell].map(([k, stems]) => ({ k, n: stems.length, hot: hotTokens(stems).slice(0, 4) }))
  .sort((a, b) => (b.hot[0]?.share ?? 0) - (a.hot[0]?.share ?? 0));
for (const r of ranked.slice(0, 40)) console.log(r.k, r.n, r.hot.map((h) => `${h.token}:${Math.round(h.share * 100)}%`).join(" "));
```

- [ ] **Step 3: Write the fixture**

Pick 12 cells: the four required ones — `es-b1-nominalizers` (cloze), `es-b1-relative-clauses` (sentence_construction), `de-a2-perfekt-with-haben` (sentence_construction), `de-a2-weil-deshalb` (sentence_construction), using the CEFR level and language the query reports for each — plus 8 from the top of the ranking whose top hot token is **filler** (a person, place or object), not the tested form. Balance across ES/DE/TR and across cloze/translation/SC. Write `packages/ai/scripts/fixtures/cells-pool-history.json` in the same shape as `cells-smoke.json`:

```json
[
  { "language": "ES", "cefrLevel": "B1", "exerciseType": "cloze", "grammarPointKey": "es-b1-nominalizers" }
]
```

(12 entries.) Validate it parses and every key resolves: `pnpm --filter @language-drill/ai exec tsx -e "import {loadCellDataset, resolveCell, isCellResolutionError} from './scripts/eval-gen-run.ts'; import {readFileSync} from 'node:fs'; const d = loadCellDataset(readFileSync('scripts/fixtures/cells-pool-history.json','utf8')); const bad = d.map(resolveCell).filter(isCellResolutionError); console.log(d.length, bad);"` → `12 []`.

- [ ] **Step 4: Confirm the Langfuse template already carries `{{priorPoolSection}}`**

Pull prod Langfuse creds (CLAUDE.md "Prompt Editing" block) and run:

```bash
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai bootstrap-prompts --check
```

Expected: exit 0 — the generation template is unchanged by this branch (only code-rendered section text and the version constant changed), so no drift. Repeat for dev. If `--check` reports the generation prompt drifted, stop and investigate: that means the registered template differs from the repo's for some other reason, and pushing it is a separate decision.

- [ ] **Step 5: Document the flag**

In `CLAUDE.md`, in the `pnpm eval:gen` row, after `Supports \`--drafts-per-cell\` (default 5), \`--limit\`, \`--max-cost-usd\`, \`--allow-prod\`.`, add:

```
`--pool-history` A/Bs the cell-history section: the candidate sees each cell's approved stems (read from `DATABASE_URL` — `--allow-prod` guards Langfuse, **not** the database), both arms get prod's seeds, and the summary adds hot-token reuse / max-Jaccard and a pre-registered verdict (ship-ready iff reuse ≤ 0.7× baseline and approval Δ ≥ −5pp). cloze / translation / sentence_construction cells only; dataset `packages/ai/scripts/fixtures/cells-pool-history.json`.
```

- [ ] **Step 6: Full gate, commit, push, PR**

```bash
pnpm --filter @language-drill/shared test
pnpm --filter @language-drill/ai lint && pnpm --filter @language-drill/ai typecheck && pnpm --filter @language-drill/ai test
pnpm --filter @language-drill/db lint && pnpm --filter @language-drill/db typecheck && pnpm --filter @language-drill/db test
pnpm --filter @language-drill/lambda typecheck && pnpm --filter @language-drill/lambda test
[ "$(git branch --show-current)" = feat/generation-pool-history ] && \
git add packages/ai/scripts/fixtures/cells-pool-history.json CLAUDE.md && \
git commit -m "Add the pool-history eval dataset and document --pool-history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/generation-pool-history
```

Run `/verify` before the final commit per the repo convention. Open the PR with `gh` (personal account alias `ghp`), summarising: what changes in the prompt and for which types; that prod is unaffected while generation is paused; the `--pool-history` eval and its decision rule; that free writing is the next spec. End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

### Task 6 (after merge): Run the A/B and record the verdict

Costs ≈ $6–8 of Anthropic spend. Confirm with the user before running.

- [ ] **Step 1: Run**

From fresh `main` with prod `DATABASE_URL` exported inline (never edit `.env`):

```bash
DATABASE_URL="<prod connection string>" pnpm eval:gen --baseline repo --candidate repo --pool-history \
  --dataset-file packages/ai/scripts/fixtures/cells-pool-history.json \
  --drafts-per-cell 10 --max-cost-usd 12 --run-name pool-history-2026-10
```

Confirm the startup line names the prod host.

- [ ] **Step 2: Inspect and record**

Read `./eval-runs/pool-history-2026-10.json`. Regardless of the verdict, open 10 candidate drafts from the cells with the largest max-Jaccard and check for frame copying (a pool stem's template with nouns swapped). Post the markdown summary, the verdict and the frame-copying check as a PR comment. `ship-ready` means the change is safe to leave live when generation resumes; `inspect` means read drafts before deciding whether to revert or reword the section; `inconclusive` means the dataset needs cells with real filler concentration.
