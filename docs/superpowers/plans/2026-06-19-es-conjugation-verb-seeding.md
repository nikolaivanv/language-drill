# ES Conjugation Verb-Seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Spanish conjugation generation from collapsing on duplicates by seeding each draft with a distinct frequency-banded *verb* (coordinated with the per-draft grammatical person), and clean up the conjugation prompt so it conjugates the seeded verb and never leaks reasoning into the learner-facing `instructions`.

**Architecture:** Reuse the existing frequency-seed machinery (`buildSeedWords` → picker → `frequencyBand`) that already seeds cloze/translation. Add a verb-only band (`verbBand`) that infers part-of-speech from surface morphology (suffix + inflection count — a temporary stopgap until the vocab file gains a real `pos` field), a conjugation seed picker keyed to `(lemma, person)`, the run-one-cell wiring (ES only), and the prompt edits.

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Vitest. Packages: `@language-drill/ai` (frequency data + prompts), `@language-drill/db` (generation orchestration), `@language-drill/shared` (enums/types).

## Global Constraints

- **ES only.** Verb-seeding is gated on `cell.language === Language.ES`. DE/TR conjugation stays unseeded (current behavior) — write the verb config language-parameterized but enable only ES.
- **Temporary workaround.** `verbBand`'s suffix+inflection heuristic is a deliberate stopgap; do not over-engineer it. It collapses to a `pos === 'verb'` filter once the vocab file gains a `pos` field (see spec).
- **Prompt-version discipline.** Editing the generation system prompt requires bumping `GENERATION_PROMPT_VERSION` to `generate@2026-06-19` in the same commit (per `CLAUDE.md` → Prompt Editing). The Langfuse template and the in-code builder must stay byte-identical — a parity test enforces this.
- **`@language-drill/ai` must not import `@language-drill/db`.** Verb data lives in `ai`; the picker and wiring live in `db` and import from `ai`. Never the reverse.
- **Determinism.** All seed selection is a pure function of `(batchSeed, ordinal)` — same-day idempotent scheduler depends on it. No `Date.now()`/`Math.random()` in the picker.
- **Run from the repo root, build first.** `db` tests resolve `ai` via its built `dist`; run `pnpm build` (turbo) before single-package test runs after editing `ai`.

**Reference spec:** `docs/superpowers/specs/2026-06-19-es-conjugation-verb-seeding-design.md`

---

## Task 0: Branch + commit the spec

**Files:** none (git only)

- [ ] **Step 1: Create the feature branch from main**

```bash
cd /Users/seal/dev/language-drill
git checkout main && git pull --ff-only
git checkout -b feat/es-conjugation-verb-seeding
```

- [ ] **Step 2: Commit the spec (already written)**

```bash
git add docs/superpowers/specs/2026-06-19-es-conjugation-verb-seeding-design.md \
        docs/superpowers/plans/2026-06-19-es-conjugation-verb-seeding.md \
        docs/analysis/generation-run-2026-06-19.md
git commit -m "docs: spec + plan for ES conjugation verb-seeding

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1: `verbBand` verb-detection helper (`@language-drill/ai`)

**Files:**
- Modify: `packages/ai/src/frequency/index.ts` (add after `frequencyBand`, ~line 206)
- Modify: `packages/ai/src/index.ts` (re-export `verbBand`)
- Test: `packages/ai/src/frequency/frequency.test.ts`

**Interfaces:**
- Produces: `export function verbBand(language: LearningLanguage, rankMin: number, rankMax: number): readonly string[]` — verb lemmas whose minimum frequency rank falls in `[rankMin, rankMax]`, sorted by rank asc (lemma tie-break). Returns `[]` for languages without a verb config (DE/TR today).
- Consumes (internal): `FREQUENCY_BY_LANGUAGE`, `STOPWORDS_BY_LANGUAGE` (already in the file).

- [ ] **Step 1: Write the failing tests**

Add to `packages/ai/src/frequency/frequency.test.ts`:

```ts
import { verbBand } from "./index";
import { Language } from "@language-drill/shared";

describe("verbBand", () => {
  it("includes real Spanish verbs and excludes look-alike non-verbs", () => {
    // Wide cumulative band to capture both common and mid-frequency verbs.
    const verbs = new Set(verbBand(Language.ES, 1, 5000));
    expect(verbs.has("hablar")).toBe(true);
    expect(verbs.has("comer")).toBe(true);
    expect(verbs.has("vivir")).toBe(true);
    // -ar/-er/-ir suffix but NOT verbs (≤2 surfaces: singular + plural).
    expect(verbs.has("lugar")).toBe(false);
    expect(verbs.has("mujer")).toBe(false);
    expect(verbs.has("mar")).toBe(false);
    expect(verbs.has("ayer")).toBe(false);
  });

  it("is sorted by rank ascending and deterministic (cached identity)", () => {
    const a = verbBand(Language.ES, 1, 5000);
    const b = verbBand(Language.ES, 1, 5000);
    expect(a).toBe(b); // same frozen instance from cache
    expect([...a]).toEqual([...a].slice().sort(() => 0)); // stable order
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("returns empty for languages without a verb config (DE/TR)", () => {
    expect(verbBand(Language.DE, 1, 5000)).toEqual([]);
    expect(verbBand(Language.TR, 1, 5000)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @language-drill/ai test -- frequency.test.ts
```
Expected: FAIL — `verbBand is not a function`.

- [ ] **Step 3: Implement `verbBand`**

Append to `packages/ai/src/frequency/index.ts` (after `frequencyBand`):

```ts
// ---------------------------------------------------------------------------
// Verb detection (TEMPORARY — see
// docs/superpowers/specs/2026-06-19-es-conjugation-verb-seeding-design.md).
// The frequency files carry no part-of-speech, so verbs are inferred from
// surface morphology: an infinitive-suffix match PLUS an inflection-count
// floor (verbs inflect across person/tense/mood → many surface forms; nouns
// have ~2: singular + plural). Collapses to a `pos === 'verb'` filter once the
// vocab file gains a `pos` field. ES-only for now.
// ---------------------------------------------------------------------------

const VERB_SUFFIXES_BY_LANGUAGE: Partial<Record<LearningLanguage, readonly string[]>> = {
  [Language.ES]: ["ar", "er", "ir"],
};

// A lemma must map to at least this many distinct surface forms to count as a
// verb. Tuned against es.json: nouns top out at ~2 (sg+pl); verbs have many.
const MIN_VERB_SURFACES = 4;

type VerbStat = { minRank: number; surfaces: number };

// lemma -> { minRank, surface count } over the WHOLE file. A verb's surfaces
// span many ranks (most fall outside any one band), so this scan is global,
// not windowed; the band filter below uses `minRank`. Cached per language.
const VERB_STATS_CACHE: Partial<Record<LearningLanguage, ReadonlyMap<string, VerbStat>>> = {};

function verbStats(language: LearningLanguage): ReadonlyMap<string, VerbStat> {
  const cached = VERB_STATS_CACHE[language];
  if (cached !== undefined) return cached;

  const freqMap = FREQUENCY_BY_LANGUAGE[language];
  const acc = new Map<string, { minRank: number; surfaces: Set<string> }>();
  for (const [surface, entry] of Object.entries(freqMap)) {
    const cur = acc.get(entry.lemma);
    if (cur === undefined) {
      acc.set(entry.lemma, { minRank: entry.rank, surfaces: new Set([surface]) });
    } else {
      cur.surfaces.add(surface);
      if (entry.rank < cur.minRank) cur.minRank = entry.rank;
    }
  }
  const out = new Map<string, VerbStat>();
  for (const [lemma, s] of acc) out.set(lemma, { minRank: s.minRank, surfaces: s.surfaces.size });
  VERB_STATS_CACHE[language] = out;
  return out;
}

const VERB_BAND_CACHE = new Map<string, readonly string[]>();
const EMPTY_BAND: readonly string[] = Object.freeze([]);

/**
 * Verb lemmas whose minimum frequency rank falls in `[rankMin, rankMax]`
 * (inclusive), sorted by rank asc with lemma tie-break, cached per
 * `(language, band)`. A lemma qualifies as a verb when its infinitive suffix
 * matches the language AND it has at least `MIN_VERB_SURFACES` distinct surface
 * forms. Returns the empty band for languages without a verb config.
 */
export function verbBand(
  language: LearningLanguage,
  rankMin: number,
  rankMax: number,
): readonly string[] {
  const suffixes = VERB_SUFFIXES_BY_LANGUAGE[language];
  if (suffixes === undefined) return EMPTY_BAND;

  const cacheKey = `${language}:${rankMin}:${rankMax}`;
  const cached = VERB_BAND_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;

  const stopwordSet = STOPWORDS_BY_LANGUAGE[language];
  const stats = verbStats(language);

  const picked: { lemma: string; rank: number }[] = [];
  for (const [lemma, s] of stats) {
    if (s.minRank < rankMin || s.minRank > rankMax) continue;
    if (s.surfaces < MIN_VERB_SURFACES) continue;
    if (stopwordSet.has(lemma)) continue;
    if (!suffixes.some((suf) => lemma.endsWith(suf))) continue;
    picked.push({ lemma, rank: s.minRank });
  }

  const band = Object.freeze(
    picked
      .sort((a, b) =>
        a.rank !== b.rank ? a.rank - b.rank : a.lemma < b.lemma ? -1 : a.lemma > b.lemma ? 1 : 0,
      )
      .map((p) => p.lemma),
  );

  VERB_BAND_CACHE.set(cacheKey, band);
  return band;
}
```

Add the re-export in `packages/ai/src/index.ts` next to the existing `frequencyBand` export:

```ts
  frequencyBand,
  verbBand,
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @language-drill/ai test -- frequency.test.ts
```
Expected: PASS. If `MIN_VERB_SURFACES = 4` excludes a real verb in the assertions, lower to 3 and re-verify the nouns still drop; record the chosen value in the code comment.

- [ ] **Step 5: Build + commit**

```bash
pnpm --filter @language-drill/ai build
git add packages/ai/src/frequency/index.ts packages/ai/src/frequency/frequency.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): verbBand — frequency-banded verb lemmas (ES, heuristic)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `pickConjugationSeeds` picker (`@language-drill/db`)

**Files:**
- Modify: `packages/db/src/generation/seed-picker.ts`
- Test: `packages/db/src/generation/seed-picker.test.ts` (add to existing file)

**Interfaces:**
- Consumes: `verbBand`, `cefrRankWindow` from `@language-drill/ai`; private `hashIndex` (same file).
- Produces: `export function pickConjugationSeeds(opts: PickConjugationSeedsOptions): (string | null)[]` and `export type PickConjugationSeedsOptions = { language: LearningLanguage; cefrLevel: CefrLevel; batchSeed: string; count: number; persons: readonly (string | null)[]; exclude: ReadonlySet<string> }`. Returns one slot per ordinal: the chosen verb lemma, or `null` (person target absent, or band exhausted).

- [ ] **Step 1: Write the failing tests**

Add to `packages/db/src/generation/seed-picker.test.ts`:

```ts
import { pickConjugationSeeds } from "./seed-picker";
import { Language, CefrLevel } from "@language-drill/shared";

describe("pickConjugationSeeds", () => {
  const base = {
    language: Language.ES,
    cefrLevel: CefrLevel.B1,
    batchSeed: "seed-abc",
    exclude: new Set<string>(),
  };

  it("assigns a distinct (lemma, person) pair per ordinal and is deterministic", () => {
    const persons = ["1sg", "2sg", "3sg", "1pl", "3pl"];
    const a = pickConjugationSeeds({ ...base, count: 5, persons });
    const b = pickConjugationSeeds({ ...base, count: 5, persons });
    expect(a).toEqual(b); // deterministic
    const pairs = a.map((lemma, i) => `${lemma}|${persons[i]}`);
    expect(new Set(pairs).size).toBe(pairs.length); // all distinct
    expect(a.every((l) => typeof l === "string")).toBe(true);
  });

  it("may reuse the same verb across different persons but not within one person", () => {
    // Two ordinals, same person → must be different verbs.
    const samePerson = pickConjugationSeeds({ ...base, count: 2, persons: ["1sg", "1sg"] });
    expect(samePerson[0]).not.toBe(samePerson[1]);
  });

  it("respects the exclude set of prior (lemma, person) keys", () => {
    const persons = ["1sg"];
    const first = pickConjugationSeeds({ ...base, count: 1, persons })[0]!;
    const excluded = pickConjugationSeeds({
      ...base,
      count: 1,
      persons,
      exclude: new Set([`${first}|1sg`]),
    })[0];
    expect(excluded).not.toBe(first);
  });

  it("returns null for ordinals with no person target", () => {
    const out = pickConjugationSeeds({ ...base, count: 2, persons: [null, "3sg"] });
    expect(out[0]).toBeNull();
    expect(typeof out[1]).toBe("string");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm build && pnpm --filter @language-drill/db test -- seed-picker.test.ts
```
Expected: FAIL — `pickConjugationSeeds is not a function`.

- [ ] **Step 3: Implement the picker**

In `packages/db/src/generation/seed-picker.ts`, extend the `@language-drill/ai` import and append the function:

```ts
import { cefrRankWindow, frequencyBand, verbBand } from '@language-drill/ai';
```

```ts
export type PickConjugationSeedsOptions = {
  language: LearningLanguage;
  cefrLevel: CefrLevel;
  batchSeed: string;
  count: number;
  /** Per-ordinal grammatical-person target (`coverageTargets[ordinal].person`), or null. */
  persons: readonly (string | null)[];
  /** Prior `${lemma}|${person}` keys already in the cell's pool — never re-proposed. */
  exclude: ReadonlySet<string>;
};

/**
 * Conjugation seed picker. Like `pickSeeds`, but draws VERBS and keys
 * distinctness/exclusion on `(lemma, person)` — the same verb in a different
 * person is a legitimately distinct drill (it matches the `lemma+featureBundle`
 * dedup surface). Conjugation drills any at-or-below-level verb (the grammar
 * point sets the difficulty, not the verb), so the band is CUMULATIVE from rank
 * 1 up to the cell level's ceiling — broader than cloze/translation's at-level
 * window, which also keeps the band large enough to avoid early exhaustion.
 *
 * Deterministic: identical options produce identical output.
 */
export function pickConjugationSeeds(opts: PickConjugationSeedsOptions): (string | null)[] {
  const { language, cefrLevel, batchSeed, count, persons, exclude } = opts;

  const { rankMax } = cefrRankWindow(cefrLevel);
  const band = verbBand(language, 1, rankMax);

  const result: (string | null)[] = [];
  if (band.length === 0) {
    for (let ordinal = 0; ordinal < count; ordinal++) result.push(null);
    return result;
  }

  const excludeLc = new Set<string>();
  for (const key of exclude) excludeLc.add(key.toLowerCase());

  const chosen = new Set<string>(); // `${lemma}|${person}` chosen this batch
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const person = persons[ordinal] ?? null;
    if (person === null) {
      result.push(null);
      continue;
    }
    const start = hashIndex(`${batchSeed}|${ordinal}`) % band.length;
    let pick: string | null = null;
    for (let step = 0; step < band.length; step++) {
      const lemma = band[(start + step) % band.length];
      const key = `${lemma}|${person}`.toLowerCase();
      if (excludeLc.has(key) || chosen.has(key)) continue;
      pick = lemma;
      chosen.add(key);
      break;
    }
    result.push(pick);
  }

  return result;
}
```

- [ ] **Step 4: Run to verify pass**

```bash
pnpm --filter @language-drill/db test -- seed-picker.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/generation/seed-picker.ts packages/db/src/generation/seed-picker.test.ts
git commit -m "feat(db): pickConjugationSeeds — verb seeds keyed on (lemma, person)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire conjugation seeding into `runOneCell` (`@language-drill/db`)

**Files:**
- Modify: `packages/db/src/generation/run-one-cell.ts` (`buildSeedWords` ~383–402; add `fetchPriorConjugationSeeds`; the seeding block ~540–561)
- Test: `packages/db/src/generation/run-one-cell.test.ts` (add to existing file)

**Interfaces:**
- Consumes: `pickConjugationSeeds`, `pickSeeds` (Task 2 / existing); `CoverageTarget` type; `Language` enum.
- Produces: extended `buildSeedWords(cell, count, batchSeed, priorSeeds: ReadonlySet<string>, coverageTargets?: readonly CoverageTarget[]): readonly (string | null)[] | undefined`; new `async function fetchPriorConjugationSeeds(db: Db, cell: Cell): Promise<ReadonlySet<string>>`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/db/src/generation/run-one-cell.test.ts` (these test the pure `buildSeedWords` gate — no DB):

```ts
import { Language, CefrLevel, ExerciseType } from "@language-drill/shared";

// Minimal Cell factory — mirror the existing test helpers in this file.
const conjCell = (language: Language) => ({
  language,
  cefrLevel: CefrLevel.B1,
  exerciseType: ExerciseType.CONJUGATION,
  grammarPoint: { key: "es-b1-conditional" },
  cellKey: `${language}:b1:conjugation:es-b1-conditional`,
} as unknown as Parameters<typeof buildSeedWords>[0]);

describe("buildSeedWords — conjugation", () => {
  const targets = [{ person: "1sg" }, { person: "2sg" }, { person: "3sg" }];

  it("seeds ES conjugation cells with verbs coordinated to the person targets", () => {
    const seeds = buildSeedWords(conjCell(Language.ES), 3, "b", new Set(), targets);
    expect(seeds).toBeDefined();
    expect(seeds!.filter((s) => typeof s === "string").length).toBeGreaterThan(0);
  });

  it("leaves non-ES conjugation cells unseeded (current behavior)", () => {
    expect(buildSeedWords(conjCell(Language.TR), 3, "b", new Set(), targets)).toBeUndefined();
    expect(buildSeedWords(conjCell(Language.DE), 3, "b", new Set(), targets)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @language-drill/db test -- run-one-cell.test.ts
```
Expected: FAIL — `buildSeedWords` returns `undefined` for ES conjugation (or arity mismatch on the 5th arg).

- [ ] **Step 3: Extend `buildSeedWords`**

Replace the body of `buildSeedWords` (`run-one-cell.ts:383`) with:

```ts
export function buildSeedWords(
  cell: Cell,
  count: number,
  batchSeed: string,
  priorSeeds: ReadonlySet<string>,
  coverageTargets?: readonly CoverageTarget[],
): readonly (string | null)[] | undefined {
  if (
    cell.exerciseType === ExerciseType.CLOZE ||
    cell.exerciseType === ExerciseType.TRANSLATION
  ) {
    return pickSeeds({
      language: cell.language,
      cefrLevel: cell.cefrLevel,
      batchSeed,
      count,
      exclude: priorSeeds,
    });
  }
  // ES conjugation: seed a distinct verb per ordinal, coordinated with the
  // ordinal's grammatical-person coverage target. Other languages stay
  // unseeded until they have a verb config (see verbBand).
  if (
    cell.exerciseType === ExerciseType.CONJUGATION &&
    cell.language === Language.ES
  ) {
    const persons = Array.from(
      { length: count },
      (_, ordinal) => coverageTargets?.[ordinal]?.person ?? null,
    );
    return pickConjugationSeeds({
      language: cell.language,
      cefrLevel: cell.cefrLevel,
      batchSeed,
      count,
      persons,
      exclude: priorSeeds,
    });
  }
  return undefined;
}
```

Update imports at the top of the file:
- add `pickConjugationSeeds` to the existing `'./seed-picker'` import;
- ensure `Language` and `CoverageTarget` are imported from `@language-drill/shared` (add to the existing import block at line ~33–40 if missing).

- [ ] **Step 4: Add `fetchPriorConjugationSeeds`**

Add next to `fetchPriorSeeds` (`run-one-cell.ts:349`):

```ts
/**
 * Prior `${seedWord}|${person}` keys for a conjugation cell — the cross-run
 * exclude set for `pickConjugationSeeds`. `seedWord` is the verb lemma we
 * persisted into content_json; `person` is the realized coverage tag. A verb
 * may recur across persons, so the key is the pair, matching the
 * `lemma+featureBundle` dedup surface.
 */
async function fetchPriorConjugationSeeds(
  db: Db,
  cell: Cell,
): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({
      seed: sql<string>`content_json->>'seedWord'`,
      person: sql<string>`coverage_tags->>'person'`,
    })
    .from(exercises)
    .where(
      and(
        eq(exercises.language, cell.language),
        eq(exercises.difficulty, cell.cefrLevel),
        eq(exercises.type, cell.exerciseType),
        eq(exercises.grammarPointKey, cell.grammarPoint.key),
        inArray(exercises.reviewStatus, [
          'auto-approved',
          'manual-approved',
          'flagged',
        ]),
        sql`content_json ? 'seedWord'`,
      ),
    );
  const set = new Set<string>();
  for (const r of rows) {
    if (typeof r.seed === 'string' && r.seed && typeof r.person === 'string' && r.person) {
      set.add(`${r.seed}|${r.person}`);
    }
  }
  return set;
}
```

- [ ] **Step 5: Update the seeding block in `runOneCell`**

Replace the `isSeedableType` / `priorSeeds` / `buildSeedWords` block (`run-one-cell.ts:552–561`) with:

```ts
    // Seed cloze/translation with at-level content words, and ES conjugation
    // with at-or-below-level verbs (keyed on (lemma, person)). Other types and
    // non-ES conjugation stay unseeded. Prior-seed exclusion is fetched only
    // for the seeded types to avoid a needless query.
    const isClozeOrTranslation =
      cell.exerciseType === ExerciseType.CLOZE ||
      cell.exerciseType === ExerciseType.TRANSLATION;
    const isEsConjugation =
      cell.exerciseType === ExerciseType.CONJUGATION &&
      cell.language === Language.ES;
    const priorSeeds: ReadonlySet<string> = isClozeOrTranslation
      ? new Set(await fetchPriorSeeds(db, cell))
      : isEsConjugation
        ? await fetchPriorConjugationSeeds(db, cell)
        : new Set<string>();
    const seedWords = buildSeedWords(
      cell,
      args.count,
      args.batchSeed,
      priorSeeds,
      args.coverageTargets,
    );
```

- [ ] **Step 6: Run the focused test + the package suite**

```bash
pnpm --filter @language-drill/db test -- run-one-cell.test.ts
pnpm --filter @language-drill/db test
```
Expected: PASS. If existing `buildSeedWords` callers in tests break on the new 5th arg, they pass `undefined` (it's optional) — only the internal call site changed.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/generation/run-one-cell.ts packages/db/src/generation/run-one-cell.test.ts
git commit -m "feat(db): seed ES conjugation drafts with distinct verbs per (lemma, person)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Prompt — conjugate-the-seed directive, instruction discipline, version bump (`@language-drill/ai`)

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts` (`buildGenerationUserPrompt` seedBlock ~557–560; `renderConjugationSection` ~225–243; `GENERATION_PROMPT_VERSION` line 152)
- Test: `packages/ai/src/generation-prompts.test.ts` (version assertion line ~231; add two assertions)

**Interfaces:**
- Consumes: `ExerciseType.CONJUGATION`, the existing `seedWord` param of `buildGenerationUserPrompt`.
- Produces: no new exports. `renderConjugationSection` feeds the `{{conjugationSection}}` template var via `computeGenerationPromptVars`, so the byte-parity test (`generation-prompts.test.ts:481`) keeps the Langfuse template and the in-code builder in sync automatically — edit only `renderConjugationSection`.

- [ ] **Step 1: Write the failing tests**

In `packages/ai/src/generation-prompts.test.ts`, update the version assertion (line ~231) and add new assertions in the same `describe`:

```ts
expect(GENERATION_PROMPT_VERSION).toBe("generate@2026-06-19");
```

```ts
it("renders conjugation seeds as a strict conjugate-this-verb directive", () => {
  const prompt = buildGenerationUserPrompt(
    conjugationInputs, // reuse the existing conjugation GenerationPromptInputs fixture in this file
    0,
    null,
    "cantar",
    [{ person: "1sg" }],
  );
  expect(prompt).toContain('The verb to conjugate is "cantar"');
  expect(prompt).not.toContain("choose a related content word"); // no substitution escape hatch
});

it("conjugation guidance forbids reasoning leaking into instructions", () => {
  const conj = renderConjugationSection(/* same args the file's other conj test uses */);
  expect(conj).toContain("instructions");
  expect(conj.toLowerCase()).toContain("do not");
});
```

(Use the existing conjugation fixtures already present in this test file — see the test at line ~288 that asserts `"## Conjugation/inflection specifics"`. If `renderConjugationSection` is not exported, assert against `buildGenerationSystemPrompt` output for a conjugation cell instead, as that test does.)

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @language-drill/ai test -- generation-prompts.test.ts
```
Expected: FAIL — version mismatch + missing directive strings.

- [ ] **Step 3: Branch the user-prompt seed block**

In `buildGenerationUserPrompt` (`generation-prompts.ts:557`), replace the `seedBlock` assignment with:

```ts
  const seedBlock =
    seedWord && seedWord.length > 0
      ? inputs.exerciseType === ExerciseType.CONJUGATION
        ? // Strict: the seed IS the verb to conjugate. No substitution escape
          // hatch — the picker already guarantees a conjugatable verb, and
          // substitution would re-open the dedup-collapse we are fixing.
          `The verb to conjugate is "${seedWord}". Use exactly this verb — do not substitute another.\n\n`
        : `Build this exercise around the word "${seedWord}". If "${seedWord}" does not fit ${inputs.grammarPoint.name} naturally, choose a related content word of similar frequency instead.\n\n`
      : "";
```

- [ ] **Step 4: Add the discipline bullets to `renderConjugationSection`**

In `renderConjugationSection` (`generation-prompts.ts:~229`), add two bullets to the list (after the `featureBundle` bullet, before `exampleSentences`):

```ts
- **Use the verb you are given in the user prompt as the lemma — do NOT choose your own.** When a verb is provided, conjugate exactly that verb.
- **\`instructions\` must contain ONLY the directive the learner reads** — one clean sentence telling them which form to produce for which person. Never include your own reasoning, alternative phrasings, abandoned attempts, or meta-text (no "Actually…", "Wait…", "let's keep it simple", or arrows). The carrier/context sentence, if any, must use the target verb.
```

- [ ] **Step 5: Bump the version**

`generation-prompts.ts:152`:

```ts
export const GENERATION_PROMPT_VERSION = "generate@2026-06-19";
```

Add a one-line note to the version comment block explaining the 2026-06-19 cohort (verb-seeded ES conjugation + instruction-discipline rules).

- [ ] **Step 6: Run tests (focused + byte-parity)**

```bash
pnpm --filter @language-drill/ai test -- generation-prompts.test.ts
```
Expected: PASS, including the `GENERATION_SYSTEM_PROMPT_TEMPLATE byte parity` block (the conjugation section flows through `{{conjugationSection}}`). If parity fails, you edited the template constant directly instead of `renderConjugationSection` — revert the template edit; the var is computed.

- [ ] **Step 7: Build + commit**

```bash
pnpm --filter @language-drill/ai build
git add packages/ai/src/generation-prompts.ts packages/ai/src/generation-prompts.test.ts
git commit -m "feat(ai): conjugate-the-seed directive + instruction discipline; bump generate@2026-06-19

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full-suite gate + local generation smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the full pre-push suite from the repo root**

```bash
cd /Users/seal/dev/language-drill
pnpm lint && pnpm typecheck && pnpm test
```
Expected: zero failures. (If a stale `infra/lambda/dist` or `db/dist` produces phantom failures, `rm -rf infra/lambda/dist` and re-run `pnpm build` per the project memories.)

- [ ] **Step 2: Local generation smoke for one ES conjugation cell**

`pnpm generate:exercises` loads `.env` (which points at the Neon **dev** branch — safe to write). Run a small batch for the previously-failing cell and inspect the result. Confirm the exact CLI flags first:

```bash
pnpm generate:exercises --help
```

Then generate a small batch (adjust flag names to match `--help`), e.g.:

```bash
pnpm generate:exercises --language es --cefr b1 --type conjugation \
  --grammar-point es-b1-conditional --count 25
```

- [ ] **Step 3: Verify diversity improved**

Query the dev DB (or the CLI's summary output) for the rows just generated and confirm:
- distinct lemma count is now ≫ 2 (target: roughly one distinct verb per (person) slot, not 2 verbs total);
- `dedup_given_up_count` for the job dropped sharply vs the 2026-06-19 prod run (11/30);
- no `instructions` field contains "Actually"/"Wait"/"→".

Record the before/after (distinct lemmas, dedup-given-up, approval count) in the PR description.

- [ ] **Step 4: (Optional) eval:gen prompt A/B**

`eval:gen` exercises the prompt source but may not replicate the db-side seed injection, so treat Step 2–3 as the primary evidence for the seeding effect and eval:gen as secondary evidence for the prompt-discipline change:

```bash
pnpm eval:gen:export --language es --cefr b1 --sample 6 --out ./eval-runs/es-conj.json --allow-prod
pnpm eval:gen --baseline langfuse:generate@production --candidate repo \
  --dataset-file ./eval-runs/es-conj.json --drafts-per-cell 6 --max-cost-usd 5
```
Confirm the dataset includes the two `es:b1:conjugation:*` cells; if not, hand-add them to the dataset file.

---

## Task 6: Open the PR + post-merge deployment

**Files:** none (process)

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/es-conjugation-verb-seeding
gh pr create --title "feat: verb-seeded ES conjugation generation" \
  --body "$(cat <<'EOF'
Fixes the ES B1 conjugation dedup-collapse from the 2026-06-19 run (es-b1-conditional approved 3/65; es-b1-present-subjunctive 10/50).

- New `verbBand` (ai): frequency-banded verb lemmas via suffix + inflection-count heuristic (TEMPORARY — collapses to a `pos` filter once the vocab file gains that field).
- New `pickConjugationSeeds` (db): one distinct verb per ordinal, keyed on `(lemma, person)`.
- `runOneCell` seeds ES conjugation cells; non-ES conjugation unchanged.
- Prompt: seed rendered as a strict "conjugate this verb" directive; conjugation guidance forbids reasoning leaking into `instructions`; `GENERATION_PROMPT_VERSION` → generate@2026-06-19.

Spec: docs/superpowers/specs/2026-06-19-es-conjugation-verb-seeding-design.md
Local smoke before/after: <distinct lemmas, dedup-given-up, approval — fill in from Task 5>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Verify `gh auth status` shows `nikolaivanv` before running (per project memory).

- [ ] **Step 2: After merge — sync the prompt to Langfuse (both envs)**

The runtime serves the system-prompt body from Langfuse; the version bump alone does not change behavior. The **user-prompt** directive ships with the CDK code deploy, but the conjugation-specifics block change must be pushed. Follow `CLAUDE.md` → Prompt Editing:

```bash
# prod
PK=$(aws --region eu-central-1 secretsmanager get-secret-value --secret-id language-drill/LANGFUSE_PUBLIC_KEY --query SecretString --output text)
SK=$(aws --region eu-central-1 secretsmanager get-secret-value --secret-id language-drill/LANGFUSE_SECRET_KEY --query SecretString --output text)
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai push-prompts --dry-run
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai push-prompts
# repeat with the language-drill-dev/ secret prefix for dev
```

- [ ] **Step 3: Confirm the next scheduled run recovered**

After the next ~04:00 UTC tick, re-run the analysis query for `es:b1:conjugation:*` and confirm approval is up and dedup-given-up is down. Both cells should re-run automatically (the seeder is a code change; `es-b1-conditional` at 3 approved is not below the `<3` skip-low-yield threshold). No `CURRICULUM_VERSION` bump required.

---

## Self-Review

**Spec coverage:**
- verbBand + suffix/inflection heuristic + ES-only + caching → Task 1 ✅
- `(lemma, person)` exclusion + cumulative band + determinism → Task 2 ✅
- run-one-cell wiring + `fetchPriorConjugationSeeds` + ES gate → Task 3 ✅
- conjugate-the-seed user directive + instruction-discipline rules + version bump → Task 4 ✅
- testing (unit) → Tasks 1–4; end-to-end smoke + eval:gen → Task 5 ✅
- deployment (Langfuse push both envs; re-run note) → Task 6 ✅
- temporary-workaround framing → Task 1 code comment + Global Constraints ✅

**Placeholder scan:** the only intentionally-open items are `MIN_VERB_SURFACES` tuning (Task 1 Step 4 gives the adjustment rule + starting value) and confirming `generate:exercises` flag names via `--help` (Task 5 Step 2) — both are explicit verification steps, not vague TODOs.

**Type consistency:** `buildSeedWords` 5-arg signature, `priorSeeds: ReadonlySet<string>`, `PickConjugationSeedsOptions.persons`/`.exclude`, and the `${lemma}|${person}` key format are consistent across Tasks 2–3. `verbBand(language, rankMin, rankMax)` matches between Task 1 and its caller in Task 2.
