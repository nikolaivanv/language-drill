# Vocab Expansion — Non-Noun Words and Word-Class Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the curated vocab-target pipeline produce verbs, adjectives, adverbs and fixed expressions (not ~80% nouns), and add 60 new vocab groups (36 themed + 24 word-class) across ES/DE/TR A1–B2.

**Architecture:** `vocab_target` gains a `pos` column. The authoring core (`runOneUmbrella`) enforces a word-class mix on themed umbrellas — one follow-up call fills a shortfall, then surplus nouns are trimmed — and restricts word-class groups (curriculum `vocabGroup`) to their declared classes. Generation/validation/evaluation prompts learn citation forms for non-nouns. The Words tab sections topics by level and tags word-class groups. Two PRs: **PR 1 = Tasks 1–10** (pipeline + UI), **PR 2 = Tasks 11–14** (curriculum). Data rollout (prod) follows each PR's deploy and is listed at the end.

**Tech Stack:** TypeScript, Drizzle ORM / Postgres (Neon), Vitest, Anthropic SDK, Next.js (App Router), Zod, Hono.

**Spec:** `docs/superpowers/specs/2026-10-17-vocab-expansion-non-nouns-design.md`

## Global Constraints

- Word classes: exactly `noun | verb | adjective | adverb | phrase | other` (lower case).
- Themed-umbrella mix: nouns ≤ 60%, verbs ≥ 20%, adjectives + adverbs ≥ 15%, phrases ≤ 10%.
- Multi-token lemmas only for `pos = 'phrase'` or `pos = 'verb'`, capped at 4 tokens.
- Non-noun `displayForm` equals its `lemma` (case-insensitive, whitespace-collapsed); the lemma is the full citation form ("acordarse de", "sich freuen auf", "futbol oynamak") — the generator seeds on `lemma`.
- At most ONE follow-up authoring call per umbrella run; a still-short run is reported, not retried.
- `--fill-mix` never proposes nouns; default growth 12 words.
- Avoid-list = every `vocab_target` lemma in the language (all umbrellas, all statuses).
- Prompt edits: bump the matching `*_PROMPT_VERSION` to `<surface>@2026-10-17` (append `a` when that exact value already exists, e.g. `evaluate@2026-10-17a`), with a changelog comment. Generation + validation are system prompts → Langfuse `push-prompts` per env after merge, from fresh main.
- Curriculum descriptions ≤ 300 chars; keys `<lang>-<level>-vocab-<theme>`.
- Pre-push: `pnpm lint && pnpm typecheck && pnpm test` from the repo root, zero failures.
- Prod scripts use the prod `DATABASE_URL` from AWS Secrets Manager `language-drill/DATABASE_URL` (eu-central-1); local `.env` is the dev branch. Rollback artifacts go to `/Users/seal/dev/language-drill/.claude/backfill-artifacts-prod-2026-10/`, never only the worktree.
- Git: work in `.claude/worktrees/vocab-expansion` on `feat/vocab-expansion`; commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **`--fill-mix` on an umbrella whose rows still have `pos = null`** (backfill not yet run) must refuse with a clear message, not count them as zero and over-fill. → test in Task 5.
2. **Model returns `pos` in another casing (`"Verb"`, `"NOUN"`) or a synonym (`"adj"`)** — casing is normalized; unknown values are dropped, not stored. → test in Task 2.
3. **A word already curated in a different umbrella with a different surface** ("la cena" in food vs "cena" proposed for time-calendar) is excluded via the language-wide lemma avoid-list. → test in Task 5.
4. **The follow-up call returns nouns or out-of-class words** — they are dropped by the class restriction, never inserted. → test in Task 4.
5. **Topics arrive in mixed level order or with an unexpected level string** — sections render A1→B2 in order, unknown levels last, and no topic is dropped. → test in Task 10.

---

## PR 1 — Pipeline

### Task 1: `VocabPos` / `VocabGroup` types and the `vocab_target.pos` column

**Files:**
- Create: `packages/shared/src/vocab-pos.ts`
- Create: `packages/shared/src/vocab-pos.test.ts`
- Modify: `packages/shared/src/index.ts` (re-export)
- Modify: `packages/shared/src/curriculum-types.ts` (add `vocabGroup?` to `GrammarPoint`)
- Modify: `packages/db/src/schema/vocab.ts` (add `pos` column)
- Create: `packages/db/migrations/0044_vocab_target_pos.sql` (+ drizzle meta/journal, generated)

**Interfaces:**
- Produces:
  - `VOCAB_POS: readonly ['noun','verb','adjective','adverb','phrase','other']`
  - `type VocabPos = (typeof VOCAB_POS)[number]`
  - `parseVocabPos(v: unknown): VocabPos | null` — trims + lower-cases; accepts the six values only.
  - `VOCAB_GROUP_LABELS: readonly ['verbs','describing','adverbs','connectors','expressions']`
  - `type VocabGroupLabel`, `type VocabGroup = Readonly<{ label: VocabGroupLabel; pos: readonly VocabPos[] }>`
  - `GrammarPoint.vocabGroup?: VocabGroup`
  - `vocabTarget.pos` (`text('pos')`, nullable) → `VocabTarget['pos']: string | null`

- [ ] **Step 1: Write the failing test** — `packages/shared/src/vocab-pos.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { VOCAB_GROUP_LABELS, VOCAB_POS, parseVocabPos } from './vocab-pos';

describe('parseVocabPos', () => {
  it('accepts the six classes in any casing and with whitespace', () => {
    expect(parseVocabPos('verb')).toBe('verb');
    expect(parseVocabPos(' Verb ')).toBe('verb');
    expect(parseVocabPos('NOUN')).toBe('noun');
    expect(parseVocabPos('phrase')).toBe('phrase');
  });

  it('rejects unknown values and non-strings', () => {
    expect(parseVocabPos('adj')).toBeNull();
    expect(parseVocabPos('')).toBeNull();
    expect(parseVocabPos(undefined)).toBeNull();
    expect(parseVocabPos(3)).toBeNull();
  });

  it('exposes the closed lists', () => {
    expect(VOCAB_POS).toEqual(['noun', 'verb', 'adjective', 'adverb', 'phrase', 'other']);
    expect(VOCAB_GROUP_LABELS).toEqual(['verbs', 'describing', 'adverbs', 'connectors', 'expressions']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/shared exec vitest run src/vocab-pos.test.ts`
Expected: FAIL — cannot resolve `./vocab-pos`.

- [ ] **Step 3: Implement** — `packages/shared/src/vocab-pos.ts`

```ts
// Word classes for curated vocab targets (2026-10-17 vocab expansion). The
// authoring pipeline tags every `vocab_target` row with one of these so the
// themed-topic mix can be enforced and measured; word-class groups declare
// which of them they accept via `GrammarPoint.vocabGroup`.

export const VOCAB_POS = ['noun', 'verb', 'adjective', 'adverb', 'phrase', 'other'] as const;
export type VocabPos = (typeof VOCAB_POS)[number];

/** Normalize a model- or DB-supplied class; null for anything outside the closed set. */
export function parseVocabPos(v: unknown): VocabPos | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return (VOCAB_POS as readonly string[]).includes(s) ? (s as VocabPos) : null;
}

export const VOCAB_GROUP_LABELS = ['verbs', 'describing', 'adverbs', 'connectors', 'expressions'] as const;
export type VocabGroupLabel = (typeof VOCAB_GROUP_LABELS)[number];

/**
 * Marks a vocab umbrella as a word-class group (e.g. "Everyday verbs") rather
 * than a themed topic. `pos` restricts every authored word to those classes;
 * `label` is the tag the Words tab shows.
 */
export type VocabGroup = Readonly<{ label: VocabGroupLabel; pos: readonly VocabPos[] }>;
```

In `packages/shared/src/index.ts`, next to the other re-exports (after `export * from './vocab-article';` if present, else after `./fluency`), add:

```ts
export * from './vocab-pos';
```

In `packages/shared/src/curriculum-types.ts`, add the import at the top (`import type { VocabGroup } from './vocab-pos';`) and, inside `GrammarPoint`, directly after the `coverageSpec?: CoverageSpec;` member:

```ts
  /**
   * Word-class group marker (vocab expansion, 2026-10-17). Present only on
   * `kind: 'vocab'` umbrellas whose words are chosen by class (core verbs,
   * connectors …) instead of by theme; enforced by curriculum invariant 9m.
   * Absent → a themed topic, authored under the word-class mix.
   */
  vocabGroup?: VocabGroup;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @language-drill/shared exec vitest run src/vocab-pos.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the column and generate the migration**

In `packages/db/src/schema/vocab.ts`, inside `vocabTarget`, after `tier`:

```ts
    pos: text('pos'), // noun | verb | adjective | adverb | phrase | other (VocabPos); null until backfilled
```

Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/db db:generate --name vocab_target_pos`
Expected: a new `packages/db/migrations/0044_vocab_target_pos.sql` containing exactly
`ALTER TABLE "vocab_target" ADD COLUMN "pos" text;` plus updated `meta/_journal.json` and a snapshot. If drizzle numbers it differently (another migration landed on main), keep drizzle's number.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @language-drill/shared typecheck && pnpm --filter @language-drill/db typecheck`
Expected: no errors.

```bash
git add packages/shared/src/vocab-pos.ts packages/shared/src/vocab-pos.test.ts packages/shared/src/index.ts packages/shared/src/curriculum-types.ts packages/db/src/schema/vocab.ts packages/db/migrations
git commit -m "Add vocab word-class types and vocab_target.pos column

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Validate `pos`, allow phrases, pin non-noun citation forms

**Files:**
- Modify: `packages/db/src/vocab-target/validate.ts`
- Test: `packages/db/src/vocab-target/validate.test.ts`
- Modify: `docs/superpowers/specs/2026-10-17-vocab-expansion-non-nouns-design.md` (section 1c — record the example-sentence rule below)

**Interfaces:**
- Consumes: `parseVocabPos`, `VocabPos` (Task 1).
- Produces:
  - `type ProposedWord = { displayForm; lemma; gloss; exampleSentence; pos: VocabPos }`
  - `validateProposedWord(w: unknown, allowedPos?: readonly VocabPos[]): ProposedWord | null`
  - `MAX_LEMMA_TOKENS = 4`

Rules (in order): the four existing string fields non-empty; `pos` parses; if `allowedPos` is given, `pos` must be in it; a lemma with whitespace only when `pos` is `phrase` or `verb`, and at most 4 tokens; for any non-noun, `displayForm` (lower-cased, whitespace-collapsed) must equal `lemma` (same normalization). Example-sentence check: a **single-token** lemma must appear verbatim (or, nouns only, the displayForm's last token) — unchanged substring logic; a **multi-token** lemma passes when at least one of its tokens of ≥ 4 characters appears with its last two characters dropped (`exampleStem`), because a natural sentence reorders and inflects a fixed expression ("sich freuen auf" → "mich auf den Urlaub freuen"; "acordarse de" → "acordarme de"). **Why single words stay strict:** a conjugated example ("Como pan" for *comer*) does not contain the lemma, which is a main reason today's pipeline dropped verbs. Task 3's prompt asks for an example that uses a single-word citation form verbatim ("Quiero comer pan."), so that check stays deterministic.

- [ ] **Step 1: Write the failing tests** — append to `validate.test.ts`

```ts
describe('validateProposedWord — word class', () => {
  const base = { gloss: 'g', exampleSentence: '' };

  it('requires a known pos and normalizes its casing', () => {
    expect(
      validateProposedWord({ ...base, displayForm: 'comer', lemma: 'comer', pos: 'Verb', exampleSentence: 'Quiero comer pan.' }),
    ).toMatchObject({ pos: 'verb' });
    expect(
      validateProposedWord({ ...base, displayForm: 'comer', lemma: 'comer', pos: 'adj', exampleSentence: 'Quiero comer.' }),
    ).toBeNull();
    expect(
      validateProposedWord({ ...base, displayForm: 'comer', lemma: 'comer', exampleSentence: 'Quiero comer.' }),
    ).toBeNull();
  });

  it('accepts multi-token lemmas only for phrases and verbs, up to 4 tokens', () => {
    expect(
      validateProposedWord({ ...base, displayForm: 'echar de menos', lemma: 'echar de menos', pos: 'phrase', exampleSentence: 'Voy a echar de menos a mi familia.' }),
    ).not.toBeNull();
    expect(
      validateProposedWord({ ...base, displayForm: 'sich freuen auf', lemma: 'sich freuen auf', pos: 'verb', exampleSentence: 'Ich möchte mich auf den Urlaub freuen.' }),
    ).not.toBeNull();
    expect(
      validateProposedWord({ ...base, displayForm: 'acordarse de', lemma: 'acordarse de', pos: 'verb', exampleSentence: 'No puedo acordarme de su nombre.' }),
    ).not.toBeNull();
    expect(
      validateProposedWord({ ...base, displayForm: 'echar de menos', lemma: 'echar de menos', pos: 'phrase', exampleSentence: 'Hoy hace sol.' }),
    ).toBeNull(); // no token of the expression in the example
    expect(
      validateProposedWord({ ...base, displayForm: 'la cena fría', lemma: 'cena fría', pos: 'noun', exampleSentence: 'La cena fría.' }),
    ).toBeNull();
    expect(
      validateProposedWord({ ...base, displayForm: 'a b c d e', lemma: 'a b c d e', pos: 'phrase', exampleSentence: 'a b c d e' }),
    ).toBeNull();
  });

  it('requires a non-noun displayForm to equal its lemma', () => {
    expect(
      validateProposedWord({ ...base, displayForm: 'rápido/a', lemma: 'rápido', pos: 'adjective', exampleSentence: 'El tren es rápido.' }),
    ).toBeNull();
    expect(
      validateProposedWord({ ...base, displayForm: 'Rápido', lemma: 'rápido', pos: 'adjective', exampleSentence: 'El tren es rápido.' }),
    ).not.toBeNull();
  });

  it('keeps article display forms for nouns', () => {
    expect(
      validateProposedWord({ ...base, displayForm: 'la manzana', lemma: 'manzana', pos: 'noun', exampleSentence: 'Como una manzana.' }),
    ).toMatchObject({ displayForm: 'la manzana', pos: 'noun' });
  });

  it('enforces allowedPos when given', () => {
    const verb = { ...base, displayForm: 'comer', lemma: 'comer', pos: 'verb', exampleSentence: 'Quiero comer.' };
    expect(validateProposedWord(verb, ['verb'])).not.toBeNull();
    expect(validateProposedWord(verb, ['adjective', 'adverb'])).toBeNull();
  });

  it('rejects a conjugated example that never shows the citation form', () => {
    expect(
      validateProposedWord({ ...base, displayForm: 'comer', lemma: 'comer', pos: 'verb', exampleSentence: 'Como pan.' }),
    ).toBeNull();
  });
});
```

Update every existing call in this file (and in `run-one-umbrella.test.ts` fixtures) that builds a word object to include `pos` — nouns get `pos: 'noun'`. The existing "multi-token → dropped" fixture in `run-one-umbrella.test.ts` (`buenos días`) stays dropped because it is given `pos: 'noun'`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/db exec vitest run src/vocab-target/validate.test.ts`
Expected: FAIL (pos not returned / multi-token phrase rejected).

- [ ] **Step 3: Implement** — replace the body of `validate.ts` above `VocabTier` with:

```ts
import { parseVocabPos, type VocabPos } from '@language-drill/shared';

export type ProposedWord = {
  displayForm: string;
  lemma: string;
  gloss: string;
  exampleSentence: string;
  pos: VocabPos;
};

/** Longest fixed expression / prepositional verb accepted as one target. */
export const MAX_LEMMA_TOKENS = 4;

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** A token minus its last two characters — survives inflection ("acordarse" → "acordar…", "freuen" → "freu…"). */
function exampleStem(token: string): string {
  return token.toLowerCase().slice(0, token.length - 2);
}

/**
 * Structural gate before human review. Returns a trimmed word or null.
 * `allowedPos` restricts the class (word-class groups, follow-up calls).
 */
export function validateProposedWord(
  w: unknown,
  allowedPos?: readonly VocabPos[],
): ProposedWord | null {
  if (typeof w !== 'object' || w === null) return null;
  const r = w as Record<string, unknown>;
  if (
    !nonEmptyString(r.displayForm) ||
    !nonEmptyString(r.lemma) ||
    !nonEmptyString(r.gloss) ||
    !nonEmptyString(r.exampleSentence)
  ) {
    return null;
  }
  const pos = parseVocabPos(r.pos);
  if (pos === null) return null;
  if (allowedPos && !allowedPos.includes(pos)) return null;

  const lemma = r.lemma.trim().replace(/\s+/g, ' ');
  const tokens = lemma.split(' ');
  if (tokens.length > 1 && pos !== 'phrase' && pos !== 'verb') return null;
  if (tokens.length > MAX_LEMMA_TOKENS) return null;

  // A non-noun's learner-facing form IS its citation form; the generator seeds
  // on `lemma`, so the two must agree ("acordarse de", not "acordarse").
  if (pos !== 'noun' && norm(r.displayForm) !== norm(lemma)) return null;

  const example = r.exampleSentence.toLowerCase();
  const lemmaTok = lemma.toLowerCase();
  // displayForm's last token drops a leading article (e.g. "la manzana" -> "manzana")
  const displayTok = r.displayForm.trim().toLowerCase().split(/\s+/).pop() ?? '';
  const exampleHasWord =
    tokens.length > 1
      ? tokens.some((t) => t.length >= 4 && example.includes(exampleStem(t)))
      : example.includes(lemmaTok) || (pos === 'noun' && example.includes(displayTok));
  if (!exampleHasWord) return null;

  return {
    displayForm: r.displayForm.trim().replace(/\s+/g, ' '),
    lemma,
    gloss: r.gloss.trim(),
    exampleSentence: r.exampleSentence.trim(),
    pos,
  };
}
```

In the spec, replace section 1c's sentence "The example-sentence check matches the phrase's first content token, since inflection changes later tokens." with: "A single-word target's example sentence must contain the citation form verbatim (the prompt asks for 'Quiero comer pan.', not 'Como pan.' — a conjugated example was the main way verbs were dropped before). A multi-word target passes when one of its ≥4-character tokens appears minus its last two characters, since natural sentences reorder and inflect fixed expressions."

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/db exec vitest run src/vocab-target/`
Expected: PASS (validate + run-one-umbrella suites).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/vocab-target docs/superpowers/specs/2026-10-17-vocab-expansion-non-nouns-design.md
git commit -m "Validate word class on vocab targets and accept short fixed expressions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Word-class mix helper and the authoring prompt

**Files:**
- Create: `packages/db/src/vocab-target/mix.ts`
- Create: `packages/db/src/vocab-target/mix.test.ts`
- Modify: `packages/ai/src/vocab-target-prompts.ts`
- Test: `packages/ai/src/vocab-target-prompts.test.ts`

**Interfaces:**
- Consumes: `VocabPos`, `VOCAB_POS` (Task 1).
- Produces (mix.ts):
  - `type PosCounts = Record<VocabPos, number>`; `emptyPosCounts(): PosCounts`
  - `countPos(rows: readonly { pos: VocabPos | null }[]): PosCounts` (null rows not counted)
  - `type MixQuota = { maxNounShare: number; minVerbShare: number; minAdjAdvShare: number; maxPhraseShare: number }`
  - `THEMED_MIX: MixQuota = { maxNounShare: 0.6, minVerbShare: 0.2, minAdjAdvShare: 0.15, maxPhraseShare: 0.1 }`
  - `type Shortfall = { verb: number; adjectiveOrAdverb: number }`
  - `mixShortfall(counts: PosCounts, total: number, quota?: MixQuota): Shortfall`
  - `fitToMix<T extends { pos: VocabPos }>(existing: PosCounts, batch: readonly T[], quota?: MixQuota): T[]`
  - `planFillMixRequest(existing: PosCounts, growth: number, quota?: MixQuota): Shortfall`
- Produces (prompts):
  - `type VocabTargetRequest = { kind: 'themed' } | { kind: 'only'; verb: number; adjectiveOrAdverb: number } | { kind: 'group'; pos: readonly string[] }`
  - `VocabTargetUserPromptInput` gains `request: VocabTargetRequest`
  - `VOCAB_TARGET_GENERATION_PROMPT_VERSION = 'vocab-target-generate@2026-10-17'`

- [ ] **Step 1: Write the failing mix tests** — `packages/db/src/vocab-target/mix.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { countPos, emptyPosCounts, fitToMix, mixShortfall, planFillMixRequest } from './mix';

const w = (pos: 'noun' | 'verb' | 'adjective' | 'adverb' | 'phrase', i: number) => ({ pos, lemma: `${pos}${i}` });

describe('countPos', () => {
  it('counts by class and skips nulls', () => {
    const c = countPos([{ pos: 'noun' }, { pos: 'verb' }, { pos: null }, { pos: 'noun' }]);
    expect(c.noun).toBe(2);
    expect(c.verb).toBe(1);
    expect(c.adjective).toBe(0);
  });
});

describe('mixShortfall', () => {
  it('reports missing verbs and adjectives/adverbs against the total', () => {
    const c = { ...emptyPosCounts(), noun: 26, verb: 2, adjective: 2 };
    // total 30 → need ceil(6)=6 verbs, ceil(4.5)=5 adj/adv
    expect(mixShortfall(c, 30)).toEqual({ verb: 4, adjectiveOrAdverb: 3 });
  });

  it('does not over-ask on exact shares (0.2 × 30 is 6, not 7)', () => {
    const c = { ...emptyPosCounts(), noun: 24, verb: 6 };
    expect(mixShortfall(c, 30).verb).toBe(0);
  });

  it('is zero when the mix is met', () => {
    const c = { ...emptyPosCounts(), noun: 15, verb: 8, adjective: 4, adverb: 3 };
    expect(mixShortfall(c, 30)).toEqual({ verb: 0, adjectiveOrAdverb: 0 });
  });
});

describe('fitToMix', () => {
  it('drops surplus nouns from the end so nouns stay at or under 60%', () => {
    const batch = [
      ...Array.from({ length: 20 }, (_, i) => w('noun', i)),
      ...Array.from({ length: 6 }, (_, i) => w('verb', i)),
      ...Array.from({ length: 4 }, (_, i) => w('adjective', i)),
    ];
    const kept = fitToMix(emptyPosCounts(), batch);
    const nouns = kept.filter((k) => k.pos === 'noun');
    // non-nouns 10 → nouns ≤ floor(1.5 × 10) = 15; the first 15 are kept (priority order)
    expect(nouns).toHaveLength(15);
    expect(nouns.at(-1)?.lemma).toBe('noun14');
    expect(kept.filter((k) => k.pos !== 'noun')).toHaveLength(10);
  });

  it('counts existing rows toward the quota', () => {
    const existing = { ...emptyPosCounts(), noun: 25, verb: 2 };
    const kept = fitToMix(existing, [w('noun', 0), w('verb', 0), w('verb', 1)]);
    // non-nouns 4 → nouns ≤ 6 overall; 25 already → no new noun fits
    expect(kept.map((k) => k.pos)).toEqual(['verb', 'verb']);
  });

  it('caps phrases at 10% of the resulting total', () => {
    const batch = [
      ...Array.from({ length: 10 }, (_, i) => w('verb', i)),
      ...Array.from({ length: 5 }, (_, i) => w('phrase', i)),
    ];
    const kept = fitToMix(emptyPosCounts(), batch);
    expect(kept.filter((k) => k.pos === 'phrase')).toHaveLength(1); // floor(0.1 × 15)
  });
});

describe('planFillMixRequest', () => {
  it('covers the shortfall and splits the remaining growth 60/40 verbs/adj-adv', () => {
    const existing = { ...emptyPosCounts(), noun: 26, verb: 2, adjective: 2 };
    // target total 42 → need ceil(8.4)=9 verbs (7 short), ceil(6.3)=7 adj/adv (5 short)
    expect(planFillMixRequest(existing, 12)).toEqual({ verb: 7, adjectiveOrAdverb: 5 });
  });

  it('never asks for less than the growth', () => {
    const existing = { ...emptyPosCounts(), noun: 10, verb: 10, adjective: 10 };
    const req = planFillMixRequest(existing, 12);
    expect(req.verb + req.adjectiveOrAdverb).toBe(12);
    expect(req.verb).toBe(7); // round(12 × 0.6)
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/db exec vitest run src/vocab-target/mix.test.ts`
Expected: FAIL — cannot resolve `./mix`.

- [ ] **Step 3: Implement** — `packages/db/src/vocab-target/mix.ts`

```ts
/**
 * Word-class mix for themed vocab umbrellas (2026-10-17 vocab expansion). Pure
 * helpers: the authoring run measures its batch against the quota, asks once
 * for a shortfall, and trims surplus nouns/phrases so the umbrella lands inside
 * it. Word-class groups (`vocabGroup`) do not use the mix.
 */
import { VOCAB_POS, type VocabPos } from '@language-drill/shared';

export type PosCounts = Record<VocabPos, number>;

export function emptyPosCounts(): PosCounts {
  return Object.fromEntries(VOCAB_POS.map((p) => [p, 0])) as PosCounts;
}

export function countPos(rows: readonly { pos: VocabPos | null }[]): PosCounts {
  const c = emptyPosCounts();
  for (const r of rows) if (r.pos) c[r.pos] += 1;
  return c;
}

export type MixQuota = {
  maxNounShare: number;
  minVerbShare: number;
  minAdjAdvShare: number;
  maxPhraseShare: number;
};

export const THEMED_MIX: MixQuota = {
  maxNounShare: 0.6,
  minVerbShare: 0.2,
  minAdjAdvShare: 0.15,
  maxPhraseShare: 0.1,
};

export type Shortfall = { verb: number; adjectiveOrAdverb: number };

const total = (c: PosCounts): number => VOCAB_POS.reduce((n, p) => n + c[p], 0);

// Floating-point guards: 0.2 * 30 is 6.000000000000001 and 0.6 / 0.4 is
// 1.4999999999999998, so a bare ceil/floor would be off by one on exact shares.
const EPS = 1e-9;
const ceilShare = (share: number, size: number): number => Math.ceil(share * size - EPS);
const floorShare = (x: number): number => Math.floor(x + EPS);

export function mixShortfall(counts: PosCounts, size: number, quota: MixQuota = THEMED_MIX): Shortfall {
  return {
    verb: Math.max(0, ceilShare(quota.minVerbShare, size) - counts.verb),
    adjectiveOrAdverb: Math.max(
      0,
      ceilShare(quota.minAdjAdvShare, size) - (counts.adjective + counts.adverb),
    ),
  };
}

/**
 * Keep the batch's priority order; drop phrases beyond maxPhraseShare of the
 * resulting total and nouns beyond maxNounShare (existing rows count).
 * nouns ≤ s·(nouns + others) ⇔ nouns ≤ s/(1−s)·others.
 */
export function fitToMix<T extends { pos: VocabPos }>(
  existing: PosCounts,
  batch: readonly T[],
  quota: MixQuota = THEMED_MIX,
): T[] {
  const phraseCap = Math.max(
    0,
    floorShare(quota.maxPhraseShare * (total(existing) + batch.length)) - existing.phrase,
  );
  let phrases = 0;
  const afterPhrases = batch.filter((w) => {
    if (w.pos !== 'phrase') return true;
    phrases += 1;
    return phrases <= phraseCap;
  });

  const others =
    total(existing) - existing.noun + afterPhrases.filter((w) => w.pos !== 'noun').length;
  const nounCap = Math.max(
    0,
    floorShare((quota.maxNounShare / (1 - quota.maxNounShare)) * others) - existing.noun,
  );
  let nouns = 0;
  return afterPhrases.filter((w) => {
    if (w.pos !== 'noun') return true;
    nouns += 1;
    return nouns <= nounCap;
  });
}

/** `--fill-mix`: non-noun request for `growth` new words that also closes the shortfall. */
export function planFillMixRequest(
  existing: PosCounts,
  growth: number,
  quota: MixQuota = THEMED_MIX,
): Shortfall {
  const short = mixShortfall(existing, total(existing) + growth, quota);
  const verb = Math.max(short.verb, Math.round(growth * 0.6));
  const adjectiveOrAdverb = Math.max(short.adjectiveOrAdverb, growth - verb);
  return { verb, adjectiveOrAdverb };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/db exec vitest run src/vocab-target/mix.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Write the failing prompt tests** — append to `packages/ai/src/vocab-target-prompts.test.ts`

```ts
import {
  VOCAB_TARGET_GENERATION_PROMPT_VERSION,
  VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE,
  buildVocabTargetUserPrompt,
} from './vocab-target-prompts';

describe('vocab-target prompt — word classes', () => {
  const base = { umbrellaName: 'Food (A1)', umbrellaDescription: 'd', wordCount: 30, freqAnchorWords: [], avoidWords: [] };

  it('is versioned 2026-10-17 and asks for pos + citation-form examples', () => {
    expect(VOCAB_TARGET_GENERATION_PROMPT_VERSION).toBe('vocab-target-generate@2026-10-17');
    expect(VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE).toContain('"pos"');
    expect(VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE).not.toContain('concrete');
    expect(VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE).toMatch(/must contain the lemma.*verbatim/);
  });

  it('states the themed mix', () => {
    const p = buildVocabTargetUserPrompt({ ...base, request: { kind: 'themed' } });
    expect(p).toContain('at most 60% nouns');
    expect(p).toContain('at least 20% verbs');
  });

  it('asks only for the missing classes in a follow-up', () => {
    const p = buildVocabTargetUserPrompt({ ...base, wordCount: 7, request: { kind: 'only', verb: 4, adjectiveOrAdverb: 3 } });
    expect(p).toContain('exactly 4 verbs');
    expect(p).toContain('3 adjectives or adverbs');
    expect(p).toContain('No nouns');
  });

  it('restricts a word-class group', () => {
    const p = buildVocabTargetUserPrompt({ ...base, request: { kind: 'group', pos: ['adverb', 'phrase'] } });
    expect(p).toContain('Every word MUST be one of: adverb, phrase');
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm --filter @language-drill/ai exec vitest run src/vocab-target-prompts.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement** — replace `packages/ai/src/vocab-target-prompts.ts` from the version constant to the end with:

```ts
// 2026-10-17: word classes. The list was ~80% nouns: the prompt asked for
// "concrete" words, banned multi-word items and showed only a noun example,
// and the structural validator dropped verbs whose example sentence was
// conjugated. Each word now carries "pos", the requested mix (or class
// restriction) rides in the user prompt, fixed expressions up to 4 words are
// allowed, and the example must contain the citation form verbatim.
export const VOCAB_TARGET_GENERATION_PROMPT_VERSION =
  'vocab-target-generate@2026-10-17';

export const VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE = `You are a lexicographer building a curated vocabulary list for {{languageName}} learners at CEFR {{cefrLevel}}.

Your task: propose exactly {{wordCount}} of the most useful words for the topic "{{umbrellaName}}" ({{umbrellaDescription}}).

Rules:
- Words MUST be squarely on-topic for "{{umbrellaName}}" and appropriate for CEFR {{cefrLevel}}: high-frequency words a learner needs to TALK about the topic — the things, but also the actions, qualities and set expressions.
- "pos" is one of: noun, verb, adjective, adverb, phrase, other ("other" = conjunctions, interjections and similar).
- "lemma" is the citation form. Nouns: bare singular, no article. Verbs: the infinitive, keeping a reflexive pronoun or governed preposition that belongs to the verb ("levantarse", "acordarse de", "sich freuen auf", "futbol oynamak"). Adjectives: the dictionary form (Spanish masculine singular, German uninflected). Phrases: the whole fixed expression ("de vez en cuando", "iyi ki").
- "displayForm" is how a learner sees it: nouns include their article where the language has one ("la manzana", "der Apfel"); for every other class it is identical to "lemma".
- Multi-word items are allowed ONLY as fixed expressions (pos "phrase") or verbs with their pronoun/preposition (pos "verb"), at most 4 words. No free combinations ("red apple").
- "gloss" is a 1-4 word English meaning. "exampleSentence" is one natural {{languageName}} sentence that uses the word. For a single word, the sentence must contain the lemma (or, for a noun, the displayForm's noun) verbatim — use a verb in its infinitive ("Quiero comer pan.", "Ich möchte früh aufstehen.", "Okula gitmek istiyorum.") and an adjective in its dictionary form. A multi-word item may be inflected and reordered as the grammar requires ("Ich freue mich auf den Urlaub.").
- No proper nouns, no duplicates. Prefer the words a learner at this level most needs first.

Return ONLY minified JSON: {"words":[{"displayForm":"...","lemma":"...","pos":"...","gloss":"...","exampleSentence":"..."}]}`;

export type VocabTargetRequest =
  | { kind: 'themed' }
  | { kind: 'only'; verb: number; adjectiveOrAdverb: number }
  | { kind: 'group'; pos: readonly string[] };

export type VocabTargetUserPromptInput = {
  umbrellaName: string;
  umbrellaDescription: string;
  wordCount: number;
  freqAnchorWords: readonly string[];
  avoidWords: readonly string[];
  request: VocabTargetRequest;
};

function requestLine(request: VocabTargetRequest): string {
  switch (request.kind) {
    case 'themed':
      return 'Word-class mix: at most 60% nouns, at least 20% verbs, at least 15% adjectives or adverbs, and at most 10% fixed phrases.';
    case 'only':
      return `Propose exactly ${request.verb} verbs and ${request.adjectiveOrAdverb} adjectives or adverbs. No nouns.`;
    case 'group':
      return `Every word MUST be one of: ${request.pos.join(', ')}. The topic is the word class itself — any level-appropriate word of that class qualifies.`;
  }
}

export function buildVocabTargetUserPrompt(
  input: VocabTargetUserPromptInput,
): string {
  const anchor =
    input.freqAnchorWords.length > 0
      ? `High-frequency candidate lemmas from our corpus (use as inspiration, not a hard constraint): ${input.freqAnchorWords.join(', ')}.`
      : '';
  const avoid =
    input.avoidWords.length > 0
      ? `Do NOT propose any of these already-listed words: ${input.avoidWords.join(', ')}.`
      : '';
  return [
    `Topic: ${input.umbrellaName}`,
    input.umbrellaDescription,
    requestLine(input.request),
    anchor,
    avoid,
    `Propose ${input.wordCount} words as JSON {"words":[...]}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
```

Update the existing tests in `vocab-target-prompts.test.ts` that call `buildVocabTargetUserPrompt` without `request` to pass `request: { kind: 'themed' }`, and any assertion on the old version string.

- [ ] **Step 8: Run to verify pass**

Run: `pnpm --filter @language-drill/ai exec vitest run src/vocab-target-prompts.test.ts && pnpm --filter @language-drill/ai build`
Expected: PASS; build succeeds (db consumes `@language-drill/ai` from dist).

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/vocab-target/mix.ts packages/db/src/vocab-target/mix.test.ts packages/ai/src/vocab-target-prompts.ts packages/ai/src/vocab-target-prompts.test.ts
git commit -m "Add word-class mix helper and request-aware vocab target prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `runOneUmbrella` — store `pos`, enforce the mix, restrict groups

**Files:**
- Modify: `packages/db/src/vocab-target/run-one-umbrella.ts`
- Test: `packages/db/src/vocab-target/run-one-umbrella.test.ts`

**Interfaces:**
- Consumes: `validateProposedWord(w, allowedPos)` (Task 2); `countPos`, `emptyPosCounts`, `mixShortfall`, `fitToMix`, `planFillMixRequest`, `PosCounts`, `Shortfall` (Task 3); `VocabTargetRequest`, `buildVocabTargetUserPrompt` (Task 3); `GrammarPoint.vocabGroup` (Task 1).
- Produces:
  - `RunOneUmbrellaDeps` gains `existing?: PosCounts` (default empty) and `fillMix?: boolean` (default false).
  - `RunOneUmbrellaResult` gains `followUp: boolean` and `remainingShortfall: Shortfall`.
  - Every returned row carries `pos`.

Behaviour:
- `umbrella.vocabGroup` set → request `{ kind: 'group', pos }`, `allowedPos = vocabGroup.pos`, no mix, no follow-up.
- `fillMix` (themed only; the CLI never passes it for groups) → request `{ kind: 'only', ...planFillMixRequest(existing, wordCount) }`, `allowedPos = ['verb','adjective','adverb','phrase']`, then follow-up/fit as below.
- Themed → request `{ kind: 'themed' }`, no restriction.
- Themed and fill-mix: after the first batch, `short = mixShortfall(existing + batch, existingTotal + wordCount)`; if `short.verb + short.adjectiveOrAdverb > 0`, ONE follow-up call with `{ kind: 'only', ...short }`, `wordCount = short.verb + short.adjectiveOrAdverb`, `allowedPos = ['verb','adjective','adverb']`, avoid-list extended with the first batch's lemmas; append its validated, de-duplicated words; then `fitToMix(existing, batch)`. `remainingShortfall` is recomputed on the final kept set.

- [ ] **Step 1: Write the failing tests** — append to `run-one-umbrella.test.ts`. First change `mockClient` so it can answer a sequence:

```ts
function mockClientSeq(...batches: unknown[][]) {
  const create = vi.fn();
  for (const words of batches) {
    create.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ words }) }] });
  }
  return { messages: { create } };
}

const noun = (l: string) => ({ displayForm: `el ${l}`, lemma: l, pos: 'noun', gloss: 'g', exampleSentence: `Veo el ${l}.` });
const verb = (l: string) => ({ displayForm: l, lemma: l, pos: 'verb', gloss: 'g', exampleSentence: `Quiero ${l}.` });
const adj = (l: string) => ({ displayForm: l, lemma: l, pos: 'adjective', gloss: 'g', exampleSentence: `Es ${l}.` });

describe('runOneUmbrella — word-class mix', () => {
  it('makes one follow-up for a shortfall and trims surplus nouns', async () => {
    const first = [...Array.from({ length: 10 }, (_, i) => noun(`n${i}`)), verb('v0')];
    const followUp = [verb('v1'), verb('v2'), adj('a0'), adj('a1'), noun('nX')];
    const client = mockClientSeq(first, followUp);
    const out = await runOneUmbrella({ db: mockDb({}) as never, client: client as never, umbrella, wordCount: 10, avoidWords: [] });

    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(out.followUp).toBe(true);
    const pos = out.rows.map((r) => r.pos);
    expect(pos.filter((p) => p === 'noun')).toHaveLength(7); // others 5 → ≤ 7.5
    expect(pos).not.toContain(undefined);
    expect(out.rows.map((r) => r.lemma)).not.toContain('nX'); // follow-up noun dropped by allowedPos
    const secondUser = client.messages.create.mock.calls[1][0].messages[0].content as string;
    expect(secondUser).toContain('No nouns');
    expect(secondUser).toContain('n0'); // first batch joins the avoid-list
  });

  it('never makes a second follow-up', async () => {
    const client = mockClientSeq([noun('n0'), noun('n1')], [noun('n2')]);
    const out = await runOneUmbrella({ db: mockDb({}) as never, client: client as never, umbrella, wordCount: 10, avoidWords: [] });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(out.remainingShortfall.verb).toBeGreaterThan(0);
  });

  it('restricts a word-class group and skips the mix', async () => {
    const group = { ...umbrella, key: 'es-a1-vocab-everyday-verbs', vocabGroup: { label: 'verbs', pos: ['verb'] } } as unknown as GrammarPoint;
    const client = mockClientSeq([verb('comer'), noun('pan'), adj('rápido')]);
    const out = await runOneUmbrella({ db: mockDb({}) as never, client: client as never, umbrella: group, wordCount: 3, avoidWords: [] });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(out.rows.map((r) => r.lemma)).toEqual(['comer']);
    const user = client.messages.create.mock.calls[0][0].messages[0].content as string;
    expect(user).toContain('Every word MUST be one of: verb');
  });

  it('fill-mix asks for non-nouns only, counting existing rows', async () => {
    const existing = { noun: 26, verb: 2, adjective: 2, adverb: 0, phrase: 0, other: 0 };
    const client = mockClientSeq(
      [verb('v1'), verb('v2'), verb('v3'), verb('v4'), verb('v5'), verb('v6'), verb('v7'), adj('a1'), adj('a2'), adj('a3'), adj('a4'), adj('a5')],
    );
    const out = await runOneUmbrella({ db: mockDb({}) as never, client: client as never, umbrella, wordCount: 12, avoidWords: [], existing, fillMix: true });
    const user = client.messages.create.mock.calls[0][0].messages[0].content as string;
    expect(user).toContain('exactly 7 verbs and 5 adjectives or adverbs');
    expect(out.rows).toHaveLength(12);
    expect(out.followUp).toBe(false);
  });
});
```

(`umbrella` and `mockDb` are the fixtures already at the top of this file; add `pos` to the existing tests' word fixtures as described in Task 2.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/db exec vitest run src/vocab-target/run-one-umbrella.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — in `run-one-umbrella.ts`:

Imports:

```ts
import type { VocabPos } from '@language-drill/shared';
import {
  countPos,
  emptyPosCounts,
  fitToMix,
  mixShortfall,
  planFillMixRequest,
  type PosCounts,
  type Shortfall,
} from './mix';
```

and add `type VocabTargetRequest` to the `@language-drill/ai` import.

Types:

```ts
export type RunOneUmbrellaDeps = {
  db: Db;
  client: Pick<Anthropic, 'messages'>;
  umbrella: GrammarPoint;
  wordCount: number;
  avoidWords: readonly string[];
  /** Class counts of the umbrella's existing (flagged + approved) rows. */
  existing?: PosCounts;
  /** Top up an existing themed umbrella with non-nouns only. */
  fillMix?: boolean;
};

export type RunOneUmbrellaResult = {
  rows: NewVocabTarget[];
  rawCount: number;
  keptCount: number;
  followUp: boolean;
  remainingShortfall: Shortfall;
};

const NON_NOUN: readonly VocabPos[] = ['verb', 'adjective', 'adverb', 'phrase'];
const FOLLOW_UP_POS: readonly VocabPos[] = ['verb', 'adjective', 'adverb'];
```

Replace the body of `runOneUmbrella` from `const system = …` down to (and including) the dedupe step with a local `propose` helper and the mix logic:

```ts
  const system = VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE.replace(
    /\{\{languageName\}\}/g,
    LANGUAGE_NAME[language],
  )
    .replace(/\{\{cefrLevel\}\}/g, cefr)
    .replace(/\{\{umbrellaName\}\}/g, umbrella.name)
    .replace(/\{\{umbrellaDescription\}\}/g, umbrella.description)
    .replace(/\{\{wordCount\}\}/g, String(wordCount));

  const seen = new Set(avoidWords.map((w) => w.toLowerCase()));
  let rawCount = 0;

  // One Claude call → validated words not yet seen (case-insensitive; stricter
  // than the DB's case-sensitive unique index, by design).
  async function propose(
    count: number,
    request: VocabTargetRequest,
    allowedPos: readonly VocabPos[] | undefined,
  ): Promise<ProposedWord[]> {
    const user = buildVocabTargetUserPrompt({
      umbrellaName: umbrella.name,
      umbrellaDescription: umbrella.description,
      wordCount: count,
      freqAnchorWords,
      avoidWords: [...seen],
      request,
    });
    const msg = await client.messages.create({
      model: GENERATION_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const raw = parseWords(extractText(msg as Anthropic.Messages.Message));
    rawCount += raw.length;
    const out: ProposedWord[] = [];
    for (const w of raw) {
      const v = validateProposedWord(w, allowedPos);
      if (!v) continue;
      const k = v.lemma.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }

  const existing = deps.existing ?? emptyPosCounts();
  const existingTotal = Object.values(existing).reduce((n, x) => n + x, 0);
  const group = umbrella.vocabGroup;

  let deduped: ProposedWord[];
  let followUp = false;
  if (group) {
    deduped = await propose(wordCount, { kind: 'group', pos: group.pos }, group.pos);
  } else {
    const first = deps.fillMix
      ? await propose(wordCount, { kind: 'only', ...planFillMixRequest(existing, wordCount) }, NON_NOUN)
      : await propose(wordCount, { kind: 'themed' }, undefined);
    const size = existingTotal + wordCount;
    let batch = first;
    const short = mixShortfall(addCounts(existing, countPos(batch)), size);
    if (short.verb + short.adjectiveOrAdverb > 0) {
      followUp = true;
      const more = await propose(
        short.verb + short.adjectiveOrAdverb,
        { kind: 'only', ...short },
        FOLLOW_UP_POS,
      );
      batch = [...batch, ...more];
    }
    deduped = fitToMix(existing, batch);
  }

  const remainingShortfall = group
    ? { verb: 0, adjectiveOrAdverb: 0 }
    : mixShortfall(addCounts(existing, countPos(deduped)), existingTotal + wordCount);
```

Then keep the existing frequency-join block unchanged (it reads `deduped`), add `pos: w.pos,` to the row object in `targetRows`, and return:

```ts
  return {
    rows: targetRows,
    rawCount,
    keptCount: targetRows.length,
    followUp,
    remainingShortfall,
  };
```

Add above `runOneUmbrella`:

```ts
function addCounts(a: PosCounts, b: PosCounts): PosCounts {
  const c = emptyPosCounts();
  for (const p of Object.keys(c) as VocabPos[]) c[p] = a[p] + b[p];
  return c;
}
```

Delete the now-unused old single-call code (`const user = …`, `const msg = …`, `const raw = …`, `const valid = …`, the old `avoid`/`seen`/`deduped` block).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/db exec vitest run src/vocab-target/`
Expected: PASS (all vocab-target suites).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/vocab-target/run-one-umbrella.ts packages/db/src/vocab-target/run-one-umbrella.test.ts
git commit -m "Enforce the word-class mix and group restrictions when authoring vocab targets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Authoring CLI — language-wide avoid-list, `--fill-mix`, review shows class

**Files:**
- Modify: `packages/db/scripts/generate-vocab-targets.ts`
- Test: `packages/db/scripts/generate-vocab-targets.test.ts`
- Modify: `packages/db/scripts/review-flagged-vocab.ts` (add `pos` to `FlaggedRowView` + format)
- Test: the review script's existing test file if it has one (`grep -l formatFlaggedRow packages/db/scripts/*.test.ts`); else add the assertion to `generate-vocab-targets.test.ts`.

**Interfaces:**
- Consumes: `runOneUmbrella` deps `existing`, `fillMix`; result `followUp`, `remainingShortfall` (Task 4); `countPos`, `PosCounts` (Task 3); `parseVocabPos` (Task 1).
- Produces:
  - `loadLanguageLemmas(db: Db, language: LearningLanguage): Promise<string[]>` (replaces `loadExistingLemmas`; all umbrellas, all statuses)
  - `loadUmbrellaPosCounts(db, language, umbrellaKey): Promise<{ counts: PosCounts; untagged: number }>` (flagged + approved rows only)
  - `parseFillMix(argv): boolean`
  - `assertFillMixReady(umbrellaKey: string, untagged: number): void` — throws `"<key> has <n> rows without pos — run backfill:vocab-target-pos first"` when `untagged > 0`
  - `parseWordCount(argv, fillMix: boolean): number` — default 30, or 12 with `--fill-mix`
  - `FlaggedRowView.pos: string | null`; `formatFlaggedRow` prints `{pos}` after the display form.

- [ ] **Step 1: Write the failing tests** — append to `generate-vocab-targets.test.ts` (extend the import list accordingly)

```ts
describe('--fill-mix', () => {
  it('parses the flag and switches the default word count', () => {
    expect(parseFillMix(['--fill-mix'])).toBe(true);
    expect(parseFillMix([])).toBe(false);
    expect(parseWordCount([], true)).toBe(12);
    expect(parseWordCount([], false)).toBe(30);
    expect(parseWordCount(['--word-count', '8'], true)).toBe(8);
  });

  it('refuses an umbrella with untagged rows', () => {
    expect(() => assertFillMixReady('es-a1-vocab-food-drink', 3)).toThrow(
      'es-a1-vocab-food-drink has 3 rows without pos — run backfill:vocab-target-pos first',
    );
    expect(() => assertFillMixReady('es-a1-vocab-food-drink', 0)).not.toThrow();
  });
});

describe('loadLanguageLemmas', () => {
  it('reads every umbrella of the language, so a word curated elsewhere is avoided', async () => {
    const where = vi.fn().mockResolvedValue([{ lemma: 'cena' }, { lemma: 'comer' }]);
    const db = { select: () => ({ from: () => ({ where }) }) };
    const out = await loadLanguageLemmas(db as never, 'ES');
    expect(out).toEqual(['cena', 'comer']);
    expect(where).toHaveBeenCalledTimes(1);
  });
});

describe('formatFlaggedRow', () => {
  it('shows the word class', () => {
    expect(
      formatFlaggedRow({ umbrellaKey: 'u', displayForm: 'comer', lemma: 'comer', pos: 'verb', gloss: 'eat', tier: 'core', freqRank: 10, exampleSentence: 'Quiero comer.' }),
    ).toContain('comer {verb} (comer)');
  });
});
```

(`vi` comes from `vitest`; `formatFlaggedRow` is imported from `./review-flagged-vocab`.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/db exec vitest run scripts/generate-vocab-targets.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 3: Implement** — in `generate-vocab-targets.ts`:

```ts
import { and, eq, inArray } from 'drizzle-orm';
import { parseVocabPos } from '@language-drill/shared';
import { countPos, type PosCounts } from '../src/vocab-target/mix';

/**
 * Every curated lemma in the language, any umbrella, any status — the
 * avoid-list, so one word lives in exactly one group per language.
 */
export async function loadLanguageLemmas(db: Db, language: LearningLanguage): Promise<string[]> {
  const rows = await db
    .select({ lemma: vocabTarget.lemma })
    .from(vocabTarget)
    .where(eq(vocabTarget.language, language));
  return rows.map((r) => r.lemma);
}

/** Class counts of an umbrella's live (flagged + approved) rows; untagged = pos null. */
export async function loadUmbrellaPosCounts(
  db: Db,
  language: LearningLanguage,
  umbrellaKey: string,
): Promise<{ counts: PosCounts; untagged: number }> {
  const rows = await db
    .select({ pos: vocabTarget.pos })
    .from(vocabTarget)
    .where(
      and(
        eq(vocabTarget.language, language),
        eq(vocabTarget.umbrellaKey, umbrellaKey),
        inArray(vocabTarget.status, ['flagged', 'approved']),
      ),
    );
  const parsed = rows.map((r) => ({ pos: parseVocabPos(r.pos) }));
  return { counts: countPos(parsed), untagged: parsed.filter((r) => r.pos === null).length };
}

export function parseFillMix(argv: readonly string[]): boolean {
  return argv.includes('--fill-mix');
}

export function assertFillMixReady(umbrellaKey: string, untagged: number): void {
  if (untagged > 0) {
    throw new Error(
      `${umbrellaKey} has ${untagged} rows without pos — run backfill:vocab-target-pos first`,
    );
  }
}

const FILL_MIX_WORD_COUNT = 12;
```

Change `parseWordCount` to `parseWordCount(argv: readonly string[], fillMix: boolean): number` returning `fillMix ? FILL_MIX_WORD_COUNT : DEFAULT_WORD_COUNT` when the flag is absent. Delete `loadExistingLemmas` (and update any test that imported it to `loadLanguageLemmas`). Update the header usage comment to document `--fill-mix`.

`main()`:

```ts
  const fillMix = parseFillMix(argv);
  const wordCount = parseWordCount(argv, fillMix);
  // …language/level/umbrellaKey/db/client unchanged…
  const resolved = filterUmbrellaByKey(resolveVocabUmbrellas(ALL_CURRICULA, language, level), umbrellaKey);
  // --fill-mix tops up themed topics only; word-class groups are skipped.
  const umbrellas = fillMix ? resolved.filter((u) => !u.vocabGroup) : resolved;

  process.stdout.write(
    `Authoring ${umbrellas.length} ${language} ${level} vocab umbrella(s)` +
      `${umbrellaKey ? ` (filtered to ${umbrellaKey})` : ''}${fillMix ? ' in --fill-mix mode' : ''}, ~${wordCount} words each.\n`,
  );

  for (const umbrella of umbrellas) {
    const { counts, untagged } = await loadUmbrellaPosCounts(db, language, umbrella.key);
    if (fillMix) assertFillMixReady(umbrella.key, untagged);
    const avoidWords = await loadLanguageLemmas(db, language);
    const { rows, rawCount, keptCount, followUp, remainingShortfall } = await runOneUmbrella({
      db,
      client,
      umbrella,
      wordCount,
      avoidWords,
      existing: counts,
      fillMix,
    });
    // …insert block unchanged…
    const short = remainingShortfall.verb + remainingShortfall.adjectiveOrAdverb;
    process.stdout.write(
      `[${umbrella.key}] proposed ${rawCount}, kept ${keptCount}, inserted ${inserted}` +
        `${followUp ? ', 1 follow-up' : ''}${short > 0 ? `, STILL SHORT verbs ${remainingShortfall.verb} / adj+adv ${remainingShortfall.adjectiveOrAdverb}` : ''}\n`,
    );
  }
```

Reload `loadLanguageLemmas` inside the loop (as above) so words inserted for an earlier umbrella in the same run are avoided by later ones.

In `review-flagged-vocab.ts`: add `pos: string | null;` to `FlaggedRowView`, `pos: vocabTarget.pos,` to the select, and change `formatFlaggedRow` to:

```ts
export function formatFlaggedRow(row: FlaggedRowView): string {
  const rank = row.freqRank === null ? 'n/a' : String(row.freqRank);
  return `${row.umbrellaKey} | ${row.displayForm} {${row.pos ?? '?'}} (${row.lemma}) — ${row.gloss} [${row.tier}, ${rank}] :: ${row.exampleSentence}`;
}
```

Update any existing `formatFlaggedRow` test expectation to the new format.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/db exec vitest run scripts/generate-vocab-targets.test.ts scripts/ && pnpm --filter @language-drill/db typecheck`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/scripts/generate-vocab-targets.ts packages/db/scripts/generate-vocab-targets.test.ts packages/db/scripts/review-flagged-vocab.ts packages/db/scripts/*.test.ts
git commit -m "Avoid words curated anywhere in the language and add --fill-mix top-ups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `backfill:vocab-target-pos` — tag the existing ~1,600 targets

**Files:**
- Create: `packages/db/scripts/backfill-vocab-target-pos.ts`
- Create: `packages/db/scripts/backfill-vocab-target-pos.test.ts`
- Modify: `packages/db/package.json` (script `"backfill:vocab-target-pos": "npx tsx scripts/backfill-vocab-target-pos.ts"`)
- Modify: root `package.json` (script `"backfill:vocab-target-pos": "dotenv -e .env -- pnpm --filter @language-drill/db backfill:vocab-target-pos"` — copy the exact shape of the existing `backfill:vocab-article-form` entry)
- Modify: `CLAUDE.md` Running Locally table (one row, modelled on neighbouring backfill rows)

**Interfaces:**
- Consumes: `parseVocabPos`, `VocabPos` (Task 1); `vocabTarget.pos` (Task 1).
- Produces:
  - `parseArgs(argv): { apply: boolean; noLlm: boolean; revert: string | null }` (same contract as `backfill-vocab-article-form.ts`)
  - `posFromUd(language: string, displayForm: string, posAll: readonly string[] | null): VocabPos | null`
  - `type PlannedPos = { id: string; lemma: string; pos: VocabPos; source: 'article' | 'corpus' | 'llm' }`

Resolution per row with `pos IS NULL` (any status):
1. ES/DE `displayForm` starting with a definite/indefinite article (`el la los las un una der die das ein eine`) followed by a space → `noun` (source `article`).
2. Single-token lemma whose `vocab_lemma.pos_all` (joined on `language` + lower-cased lemma) maps to exactly ONE class via `NOUN|PROPN→noun, VERB|AUX→verb, ADJ→adjective, ADV→adverb, INTJ|CCONJ|SCONJ|ADP|PRON|DET|NUM|PART|CLASSIFIER→other` → that class (source `corpus`). Several tags mapping to different classes → unresolved.
3. Everything else (multi-token, no lemma match, ambiguous tags) → one Claude call per batch of 40 per language (`claude-sonnet-4-6`, forced tool `record_word_classes`, items `{ index, pos }` with `pos` enum the six classes), validated with `parseVocabPos` (source `llm`). Unless `--no-llm`.

Writes are `UPDATE vocab_target SET pos = $pos WHERE id = $id AND pos IS NULL`. Artifact: `./backfill-runs/vocab-target-pos-<timestamp>.json` with `{ applied, written, planned, unresolved }`. `--revert <artifact> --apply` sets `pos = NULL` for the artifact's planned ids (refuses a dry-run artifact).

- [ ] **Step 1: Write the failing tests** — `backfill-vocab-target-pos.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parseArgs, posFromUd } from './backfill-vocab-target-pos';

describe('posFromUd', () => {
  it('treats an ES/DE article display form as a noun regardless of corpus tags', () => {
    expect(posFromUd('ES', 'la cena', ['VERB'])).toBe('noun');
    expect(posFromUd('DE', 'das Essen', ['VERB', 'NOUN'])).toBe('noun');
  });

  it('maps a single unambiguous UD class', () => {
    expect(posFromUd('ES', 'comer', ['VERB'])).toBe('verb');
    expect(posFromUd('TR', 'güzel', ['ADJ'])).toBe('adjective');
    expect(posFromUd('DE', 'oft', ['ADV'])).toBe('adverb');
    expect(posFromUd('ES', 'aunque', ['SCONJ'])).toBe('other');
    expect(posFromUd('TR', 'ev', ['NOUN', 'PROPN'])).toBe('noun');
  });

  it('leaves ambiguous, missing and multi-token rows for the classifier', () => {
    expect(posFromUd('TR', 'yemek', ['NOUN', 'VERB'])).toBeNull();
    expect(posFromUd('ES', 'rápido', null)).toBeNull();
    expect(posFromUd('ES', 'por la mañana', ['ADP'])).toBeNull();
  });

  it('does not read an article off Turkish forms', () => {
    expect(posFromUd('TR', 'bir şey', ['NOUN'])).toBeNull();
  });
});

describe('parseArgs', () => {
  it('parses flags and rejects unknown ones', () => {
    expect(parseArgs(['--apply', '--no-llm'])).toEqual({ apply: true, noLlm: true, revert: null });
    expect(parseArgs(['--revert', 'a.json'])).toEqual({ apply: false, noLlm: false, revert: 'a.json' });
    expect(() => parseArgs(['--revert'])).toThrow('--revert requires an artifact path');
    expect(() => parseArgs(['--nope'])).toThrow('Unknown argument: --nope');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/db exec vitest run scripts/backfill-vocab-target-pos.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `backfill-vocab-target-pos.ts`. Follow `scripts/backfill-vocab-article-form.ts` line for line for `parseArgs`, artifact writing, `revert`, `main` and the `isMain` guard; the parts that differ:

```ts
/**
 * `pnpm backfill:vocab-target-pos` — one-off tag of `vocab_target.pos` for the
 * rows authored before the column existed (2026-10-17 vocab expansion).
 * Resolution: an ES/DE article display form → noun; one unambiguous corpus
 * class from vocab_lemma.pos_all → that class; anything else → a batched
 * Claude classification (skip with --no-llm). Dry-run by default (the Claude
 * step still runs); --apply writes `pos` only where it is still null;
 * --revert <artifact> --apply nulls exactly the rows an applied run wrote.
 * Required env: DATABASE_URL; ANTHROPIC_API_KEY unless --no-llm.
 */
import Anthropic from '@anthropic-ai/sdk';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { VOCAB_POS, parseVocabPos, type VocabPos } from '@language-drill/shared';
import { createDb, type Db } from '../src/client';
import { vocabLemma, vocabTarget } from '../src/schema';
import { requireEnv } from '../src/lib/env';

const CLASSIFIER_MODEL = 'claude-sonnet-4-6';
const BATCH_SIZE = 40;
const ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'der', 'die', 'das', 'ein', 'eine']);
const UD_TO_POS: Record<string, VocabPos> = {
  NOUN: 'noun', PROPN: 'noun',
  VERB: 'verb', AUX: 'verb',
  ADJ: 'adjective',
  ADV: 'adverb',
  INTJ: 'other', CCONJ: 'other', SCONJ: 'other', ADP: 'other', PRON: 'other',
  DET: 'other', NUM: 'other', PART: 'other', CLASSIFIER: 'other',
};

export function posFromUd(
  language: string,
  displayForm: string,
  posAll: readonly string[] | null,
): VocabPos | null {
  const tokens = displayForm.trim().split(/\s+/);
  if ((language === 'ES' || language === 'DE') && tokens.length > 1 && ARTICLES.has(tokens[0].toLowerCase())) {
    return 'noun';
  }
  if (tokens.length > 1 || !posAll || posAll.length === 0) return null;
  const classes = new Set(posAll.map((t) => UD_TO_POS[t]).filter((p): p is VocabPos => p !== undefined));
  return classes.size === 1 ? [...classes][0] : null;
}
```

Row loading (left join on the lower-cased lemma):

```ts
async function loadRows(db: Db) {
  return db
    .select({
      id: vocabTarget.id,
      language: vocabTarget.language,
      lemma: vocabTarget.lemma,
      displayForm: vocabTarget.displayForm,
      gloss: vocabTarget.gloss,
      posAll: vocabLemma.posAll,
    })
    .from(vocabTarget)
    .leftJoin(
      vocabLemma,
      and(eq(vocabLemma.language, vocabTarget.language), eq(vocabLemma.lemma, sql`lower(${vocabTarget.lemma})`)),
    )
    .where(isNull(vocabTarget.pos));
}
```

Classifier (one call per ≤40 rows per language), modelled on `classifyBatch` in the article backfill:

```ts
async function classifyBatch(
  client: Anthropic,
  language: string,
  batch: readonly { id: string; lemma: string; displayForm: string; gloss: string }[],
): Promise<Map<string, VocabPos | null>> {
  const lines = batch.map((r, i) => `${i}. "${r.displayForm}" — meaning: "${r.gloss}"`).join('\n');
  const response = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 4000,
    tools: [{
      name: 'record_word_classes',
      description: 'Record the word class of each item.',
      input_schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { index: { type: 'integer' }, pos: { type: 'string', enum: [...VOCAB_POS] } },
              required: ['index', 'pos'],
            },
          },
        },
        required: ['items'],
      },
    }],
    tool_choice: { type: 'tool', name: 'record_word_classes' },
    messages: [{
      role: 'user',
      content: `Language: ${language === 'ES' ? 'Spanish' : language === 'DE' ? 'German' : 'Turkish'}. Classify each vocabulary item, as used with the given meaning, as noun, verb, adjective, adverb, phrase (a fixed multi-word expression that is not a single verb), or other (conjunction, interjection, pronoun, …). A verb with its reflexive pronoun or governed preposition ("acordarse de", "sich freuen auf") is a verb; a Turkish noun + light verb ("futbol oynamak") is a verb.\n\n${lines}`,
    }],
  });
  const out = new Map<string, VocabPos | null>();
  const block = response.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') return out;
  const items = (block.input as { items?: { index: number; pos: string }[] }).items ?? [];
  for (const it of items) {
    const row = batch[it.index];
    if (row) out.set(row.id, parseVocabPos(it.pos));
  }
  return out;
}
```

`plan()`: run `posFromUd` per row (`source` = `'article'` when the article branch fired — compute it by calling `posFromUd(language, displayForm, null)` and checking for `'noun'` — else `'corpus'`); collect nulls; classify them per language in batches unless `--no-llm`; anything still null → `unresolved`. `applyPlanned`: per planned row, `db.update(vocabTarget).set({ pos: p.pos }).where(and(eq(vocabTarget.id, p.id), isNull(vocabTarget.pos))).returning({ id: vocabTarget.id })`. `revert`: `set({ pos: null })` for the artifact's ids in chunks of 500. `main` prints `planned: N { article, corpus, llm }`, the unresolved count, the first 20 llm results and the artifact path — same as the article backfill.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/db exec vitest run scripts/backfill-vocab-target-pos.test.ts && pnpm --filter @language-drill/db typecheck`
Expected: PASS (6 tests); no type errors.

- [ ] **Step 5: Smoke against the dev branch, read-only**

Run (from `packages/db`, local `.env` = dev): `npx dotenv -e ../../.env -- npx tsx scripts/backfill-vocab-target-pos.ts --no-llm`
Expected: `planned: …` with counts from the dev data, `dry-run — pass --apply to write`, an artifact path. No writes.

- [ ] **Step 6: Commit**

```bash
git add packages/db/scripts/backfill-vocab-target-pos.ts packages/db/scripts/backfill-vocab-target-pos.test.ts packages/db/package.json package.json CLAUDE.md
git commit -m "Add backfill:vocab-target-pos to tag existing vocab targets by word class

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Generation + validation prompts — non-noun citation forms and word-class groups

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts` (system prompt bullet + `GENERATION_PROMPT_VERSION` + changelog)
- Modify: `packages/ai/src/validation-prompts.ts` (vocab_recall `grammarPointMatch` note + `VALIDATION_PROMPT_VERSION` + changelog)
- Test: `packages/ai/src/generation-prompts.test.ts`, `packages/ai/src/validation-prompts.test.ts`, plus every test pinning `generate@2026-10-07` / `validate@2026-10-09` (`grep -rln "generate@2026-10-07\|validate@2026-10-09" packages/ai/src`)

**Interfaces:**
- Produces: `GENERATION_PROMPT_VERSION = "generate@2026-10-17"`, `VALIDATION_PROMPT_VERSION = "validate@2026-10-17"`.

- [ ] **Step 1: Write the failing tests**

In `generation-prompts.test.ts`:

```ts
it('teaches vocab_recall citation forms for non-nouns (2026-10-17)', () => {
  expect(GENERATION_PROMPT_VERSION).toBe('generate@2026-10-17');
  expect(GENERATION_SYSTEM_PROMPT).toContain('vocab_recall citation forms');
  expect(GENERATION_SYSTEM_PROMPT).toContain('acordarse de');
  expect(GENERATION_SYSTEM_PROMPT).toMatch(/feminine.*acceptableAnswers/);
});
```

In `validation-prompts.test.ts`:

```ts
it('accepts word-class groups and citation-form variants for vocab_recall (2026-10-17)', () => {
  expect(VALIDATION_PROMPT_VERSION).toBe('validate@2026-10-17');
  const prompt = VALIDATION_SYSTEM_PROMPT;
  expect(prompt).toContain('word-class group');
  expect(prompt).toMatch(/feminine of an adjective.*NOT a distinct-referent defect/);
});
```

Use the actual exported system-prompt constant names of each file (`grep -n "export const .*SYSTEM_PROMPT" packages/ai/src/generation-prompts.ts packages/ai/src/validation-prompts.ts`); the version constants are as named above. Update each existing pinned version expectation to the new value.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/ai exec vitest run src/generation-prompts.test.ts src/validation-prompts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Generation system prompt — insert this bullet immediately after the `**vocab_recall kinship terms …**` bullet (line ~564):

```
- **vocab_recall citation forms.** \`expectedWord\` is the citation form of the seeded target, exactly as seeded: a verb in its infinitive (ES \`-ar/-er/-ir\`, DE infinitive, TR \`-mek/-mak\`), keeping a reflexive pronoun or governed preposition that is part of the target ("acordarse de", "sich freuen auf", "futbol oynamak"); an adjective in its dictionary form (DE uninflected, TR bare; for an ES adjective the masculine singular, with the feminine singular in \`acceptableAnswers\`); a fixed expression in full ("de vez en cuando", "iyi ki"), with a legitimate word-order or clitic-placement variant in \`acceptableAnswers\`. The \`prompt\` must make the word class unmistakable — "to …" for a verb, a description of a quality for an adjective, "how often / when …" for an adverb, and for a fixed expression the situation in which it is said. Never write a definition a noun could answer when the target is a verb or adjective, and never write one that a single word answers when the target is a multi-word expression.
```

Bump and log, directly above the constant:

```ts
// Bumped 2026-10-17 — vocab expansion: the curated targets now include verbs,
// adjectives, adverbs and fixed expressions (not ~80% nouns), seeded on their
// citation form. New "vocab_recall citation forms" bullet: infinitive with its
// pronoun/preposition, ES adjectives masculine with the feminine accepted,
// expressions in full, and a definition that forces the word class. Mirrored
// by validate@2026-10-17 (citation-form variants are not distinct referents;
// word-class groups). Template edit → Langfuse push per env.
export const GENERATION_PROMPT_VERSION = "generate@2026-10-17";
```

Validation prompt — replace the `**grammarPointMatch for vocab_recall:**` paragraph (line ~440) with:

```
**grammarPointMatch for vocab_recall:** a vocab umbrella is a SEMANTIC DOMAIN (e.g. food & drink, transport & places), NOT a part of speech. A domain-appropriate verb (içmek "to drink"), adjective (acı "spicy"), adverb, or fixed expression is on-target — set grammarPointMatch=false ONLY when the headword is outside that domain, never merely because it is not a noun. The exception is a **word-class group**, whose name states a word class rather than a topic ("Everyday verbs (A1)", "Describing words (A1)", "Connectors and discourse markers (B1)", "Collocations and idioms (B2)"): there the headword must belong to that class, and any level-appropriate word of the class is on-target whatever its topic. Citation-form variants are the SAME headword: \`acceptableAnswers\` listing the feminine of an adjective, or a word-order / clitic-placement variant of a fixed expression, is NOT a distinct-referent defect. Judge every other dimension (levelMatch, ambiguous, contextSpoilsAnswer, qualityScore) exactly as defined above, unchanged.
```

Bump and log above `VALIDATION_PROMPT_VERSION`:

```ts
// 2026-10-17 (validate@2026-10-17): vocab expansion mirror of
// generate@2026-10-17. Word-class groups (topic = a word class) judge
// grammarPointMatch on the class, and citation-form variants (ES adjective
// feminine, expression word order) in acceptableAnswers are the same
// headword, not distinct referents. Template edit → Langfuse push per env.
export const VALIDATION_PROMPT_VERSION = "validate@2026-10-17";
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/ai test`
Expected: PASS (whole ai suite — catches every version pin).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src
git commit -m "Teach generation and validation non-noun citation forms and word-class groups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Evaluator — citation-form rule for non-noun vocab answers

**Files:**
- Modify: `packages/ai/src/prompts.ts` (`buildVocabRecallUserPrompt`, `EVALUATION_SYSTEM_PROMPT_VERSION` + changelog)
- Test: `packages/ai/src/prompts.test.ts`, `packages/ai/src/evaluate.test.ts` (version pins)

**Interfaces:**
- Produces: `EVALUATION_SYSTEM_PROMPT_VERSION = "evaluate@2026-10-17a"`.

Why: a learner who types "comí" for *comer*, "rápida" for *rápido* (when not listed), or "acordarse" for *acordarse de* gave the right word in the wrong form; without a rule the evaluator scores these unpredictably — the same inconsistency PR #790 fixed for articles. User-prompt builder only → no Langfuse push.

- [ ] **Step 1: Write the failing test** — in `prompts.test.ts`, next to the existing vocab article-rule tests (reuse that suite's builder call and fixture; `articleForm` absent):

```ts
describe('vocab_recall citation-form rule (evaluate@2026-10-17a)', () => {
  const verb: VocabRecallContent = {
    type: ExerciseType.VOCAB_RECALL,
    instructions: 'Recall the word.',
    prompt: 'to remember something or someone',
    expectedWord: 'acordarse de',
    hints: [],
    exampleSentence: 'No puedo ___ su nombre.',
  };

  it('states the citation-form rule when there is no article requirement', () => {
    const out = buildUserPrompt(verb as any, 'acordarse', 'ES' as any, 'B1' as any);
    expect(out).toContain('CITATION FORM');
    expect(out).toContain('score 0.8');
    expect(out).toMatch(/listed in \*\*Acceptable Answers\*\* is fully correct/);
  });

  it('omits the citation-form rule for an article-bearing noun', () => {
    const noun = { ...verb, expectedWord: 'espalda', articleForm: 'la espalda' };
    expect(buildUserPrompt(noun as any, 'espalda', 'ES' as any, 'A2' as any)).not.toContain('CITATION FORM');
  });

  it('pins the evaluator version', () => {
    expect(EVALUATION_SYSTEM_PROMPT_VERSION).toBe('evaluate@2026-10-17a');
  });
});
```

(`buildUserPrompt`, `ExerciseType`, `VocabRecallContent` and `EVALUATION_SYSTEM_PROMPT_VERSION` are already imported at the top of `prompts.test.ts`.) Update the `evaluate@2026-10-17` pins in `prompts.test.ts` and `evaluate.test.ts`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/ai exec vitest run src/prompts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — in `buildVocabRecallUserPrompt`, replace the `: \`There is no article requirement …\`` branch with:

```ts
    : `There is no article requirement for this item. An article the learner adds is NOT an error when it is correct, and its absence is never an error — do not ask for one.

CITATION FORM — the **Expected Word** is the dictionary form the learner was asked for (a verb's infinitive with any reflexive pronoun or preposition that belongs to it, an adjective's dictionary form, a fixed expression in full). A form listed in **Acceptable Answers** is fully correct. The right word in a different form — a conjugated verb ("comí" for "comer"), a declined or agreeing adjective not listed, or an expression missing an obligatory part ("acordarse" for "acordarse de", "freuen" for "sich freuen auf") — is NOT wrong: score 0.8 with one grammar error of severity "minor" whose correction is the **Expected Word**.`;
```

Above the version constant add:

```ts
// 2026-10-17a: vocab_recall citation-form rule (user-prompt builder only, no
// Langfuse push). The curated pool now includes verbs, adjectives and fixed
// expressions; the right word in a non-citation form scores 0.8 with a minor
// error, mirroring the 0.8 missing-article rule from evaluate@2026-10-17.
```

and set `EVALUATION_SYSTEM_PROMPT_VERSION = "evaluate@2026-10-17a"`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/ai test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/prompts.ts packages/ai/src/prompts.test.ts packages/ai/src/evaluate.test.ts
git commit -m "Score non-citation forms of vocab answers consistently at 0.8

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: API — expose the word-class group label on topic summaries

**Files:**
- Modify: `infra/lambda/src/routes/vocab.ts` (`GET /vocab/topics`)
- Test: the route's existing test file (`grep -ln "vocab/topics" infra/lambda/src/routes/*.test.ts`)
- Modify: `packages/api-client/src/schemas/vocab.ts`
- Test: the schema's existing test (`grep -ln "VocabTopicSummarySchema" packages/api-client/src`)

**Interfaces:**
- Consumes: `GrammarPoint.vocabGroup` (Task 1), `VOCAB_GROUP_LABELS` (Task 1).
- Produces: `VocabTopicSummary.group: VocabGroupLabel | null` (Zod: `z.enum(VOCAB_GROUP_LABELS).nullable().default(null)`).

- [ ] **Step 1: Write the failing tests**

Route test — mirror the file's existing `/vocab/topics` test and add a case where `getGrammarPoint` returns a vocab point with `vocabGroup: { label: 'verbs', pos: ['verb'] }`, asserting `body.topics[0].group === 'verbs'`, and a themed point asserting `group === null`.

Schema test:

```ts
it('defaults group to null for responses from an older API', () => {
  const parsed = VocabTopicSummarySchema.parse({ umbrellaKey: 'k', name: 'n', cefrLevel: 'A1', wordCount: 1, available: 1, practiced: 0 });
  expect(parsed.group).toBeNull();
  expect(VocabTopicSummarySchema.parse({ umbrellaKey: 'k', name: 'n', cefrLevel: 'A1', wordCount: 1, available: 1, practiced: 0, group: 'connectors' }).group).toBe('connectors');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/api-client exec vitest run && pnpm --filter @language-drill/lambda exec vitest run src/routes`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

Schema: add after `strong`:

```ts
  // Word-class group tag ("verbs", "connectors" …) or null for a themed topic.
  // Defaulted so a response from an API deployed before the field still parses.
  group: z.enum(VOCAB_GROUP_LABELS).nullable().default(null),
```

(import `VOCAB_GROUP_LABELS` from `@language-drill/shared`; if api-client does not depend on shared, inline `['verbs','describing','adverbs','connectors','expressions'] as const` with a comment naming `VOCAB_GROUP_LABELS` as the source of truth.)

Route: in the `topics.push({ … })` object add `group: point.vocabGroup?.label ?? null,`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/api-client test && pnpm --filter @language-drill/lambda exec vitest run src/routes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes packages/api-client/src
git commit -m "Return the word-class group label with each vocab topic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Words tab — level sections and a group tag

**Files:**
- Modify: `apps/web/app/(dashboard)/progress/_components/words-tab.tsx`
- Modify: `apps/web/app/(dashboard)/vocab/_components/vocab-topic-card.tsx`
- Test: `apps/web/app/(dashboard)/progress/_components/__tests__/words-tab.test.tsx`

**Interfaces:**
- Consumes: `VocabTopicSummary.group` (Task 9).
- Produces: `groupTopicsByLevel(topics: readonly VocabTopicSummary[]): { level: string; topics: VocabTopicSummary[] }[]` (exported from `words-tab.tsx`).

Ordering: `A1, A2, B1, B2, C1, C2`, then any other level string in first-seen order; topics keep their API order within a section. Group tag text: `verbs → "verbs"`, `describing → "adjectives"`, `adverbs → "adverbs"`, `connectors → "connectors"`, `expressions → "expressions"`.

- [ ] **Step 1: Write the failing tests** — append to `words-tab.test.tsx` (the `topic()` helper must add `group: o.group ?? null`)

```ts
describe('WordsTab — level sections', () => {
  it('sections topics A1→B2 regardless of API order and keeps unknown levels last', () => {
    render(
      <WordsTab
        data={loaded([
          topic({ umbrellaKey: 'b1', cefrLevel: 'B1' }),
          topic({ umbrellaKey: 'a1', cefrLevel: 'A1' }),
          topic({ umbrellaKey: 'x', cefrLevel: 'Z9' }),
          topic({ umbrellaKey: 'a1b', cefrLevel: 'A1' }),
        ])}
        isLoading={false}
        isError={false}
        onRetry={mockRetry}
      />,
    );
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['A1', 'B1', 'Z9']);
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });

  it('tags word-class groups', () => {
    render(
      <WordsTab
        data={loaded([topic({ umbrellaKey: 'v', name: 'Everyday verbs (A1)', group: 'describing' })])}
        isLoading={false}
        isError={false}
        onRetry={mockRetry}
      />,
    );
    expect(screen.getByText('adjectives')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/progress/_components/__tests__/words-tab.test.tsx"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`words-tab.tsx`:

```tsx
const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Topics sectioned by CEFR level, A1 first; unknown levels after, in first-seen order. */
export function groupTopicsByLevel(
  topics: readonly VocabTopicSummary[],
): { level: string; topics: VocabTopicSummary[] }[] {
  const byLevel = new Map<string, VocabTopicSummary[]>();
  for (const t of topics) {
    const list = byLevel.get(t.cefrLevel);
    if (list) list.push(t);
    else byLevel.set(t.cefrLevel, [t]);
  }
  const rank = (l: string) => {
    const i = LEVEL_ORDER.indexOf(l);
    return i === -1 ? LEVEL_ORDER.length : i;
  };
  return [...byLevel.entries()]
    .map(([level, list], seen) => ({ level, topics: list, seen }))
    .sort((a, b) => rank(a.level) - rank(b.level) || a.seen - b.seen)
    .map(({ level, topics: list }) => ({ level, topics: list }));
}

export function WordsTab({ data, isLoading, isError, onRetry }: WordsTabProps) {
  if (isLoading) return <VocabListLoading />;
  if (isError) return <VocabListError onRetry={onRetry} />;
  if (!data || data.topics.length === 0) return <VocabEmpty />;
  return (
    <div className="mt-s-4 flex flex-col gap-s-4">
      {groupTopicsByLevel(data.topics).map(({ level, topics }) => (
        <section key={level} aria-labelledby={`words-level-${level}`}>
          <h3 id={`words-level-${level}`} className="t-mono mb-s-2 text-[12px] text-ink-mute">
            {level}
          </h3>
          <div className="overflow-hidden rounded-lg border border-rule bg-card">
            {topics.map((topic) => (
              <VocabTopicCard key={topic.umbrellaKey} topic={topic} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

(Import `type VocabTopicSummary` alongside `VocabTopicsResponse`.)

`vocab-topic-card.tsx` — add above the component:

```tsx
const GROUP_TAG: Record<NonNullable<VocabTopicSummary['group']>, string> = {
  verbs: 'verbs',
  describing: 'adjectives',
  adverbs: 'adverbs',
  connectors: 'connectors',
  expressions: 'expressions',
};
```

and, inside the name row after the CEFR `<Chip>`:

```tsx
          {topic.group ? <Chip>{GROUP_TAG[topic.group]}</Chip> : null}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/progress" "app/(dashboard)/vocab"`
Expected: PASS (existing words-tab / topic-card tests included — update any that asserted the single flat container).

- [ ] **Step 5: Verify visually**

Run (with `pnpm dev:api` up): `pnpm --filter @language-drill/web shoot --route "/progress?tab=words"` and open the screenshot in `apps/web/e2e/.shots/`. Expected: level headings with their topic cards beneath; desktop and a 390px-wide shot both without horizontal scroll.

- [ ] **Step 6: PR 1 gate, push, PR**

Run from the repo root: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures (the known `topic-switcher-sheet` flake passes on a rerun of that file alone).

```bash
git add apps/web
git commit -m "Section the Words tab by level and tag word-class groups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/vocab-expansion
GH_CONFIG_DIR="$HOME/.config/gh-personal" gh pr create --title "Vocab expansion part 1: word classes in the vocab-target pipeline" --body "<summary of Tasks 1–10, the Langfuse push needed after merge, and the rollout steps>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Stop here for review. PR 2 is a new branch off main after PR 1 merges (`feat/vocab-expansion-curriculum`).

---

## PR 2 — Curriculum

### Task 11: Curriculum invariant for `vocabGroup`

**Files:**
- Modify: `packages/db/src/curriculum/index.ts` (new invariant 9m, after the coverageSpec block 9d)
- Test: `packages/db/src/curriculum/curriculum.test.ts`

**Interfaces:**
- Consumes: `VOCAB_GROUP_LABELS`, `VOCAB_POS` (Task 1).

- [ ] **Step 1: Write the failing tests** — append to `curriculum.test.ts` (same shape as the `clozeUnsuitable` synthetic-entry tests; `GrammarPoint`, `Language` and `assertCurriculumInvariants` are already imported there)

```ts
describe('curriculum vocabGroup', () => {
  const vocabEntry = (vocabGroup: unknown, kind: 'vocab' | 'grammar' = 'vocab'): GrammarPoint =>
    ({
      key: 'tr-a2-synthetic-vg',
      kind,
      name: 'Synthetic vocab group',
      description: 'Synthetic vocab entry for vocabGroup invariant testing.',
      cefrLevel: 'A2',
      language: Language.TR,
      examplesPositive: ['a', 'b'],
      examplesNegative: ['*c'],
      commonErrors: ['e'],
      vocabGroup,
    }) as GrammarPoint;

  it('accepts a well-formed group', () => {
    expect(() => assertCurriculumInvariants([vocabEntry({ label: 'verbs', pos: ['verb'] })])).not.toThrow();
  });

  it('throws when a non-vocab entry declares vocabGroup', () => {
    expect(() => assertCurriculumInvariants([vocabEntry({ label: 'verbs', pos: ['verb'] }, 'grammar')])).toThrow(
      "'tr-a2-synthetic-vg' has vocabGroup but is not kind 'vocab'",
    );
  });

  it('throws on an unknown label, an empty class list and an unknown class', () => {
    expect(() => assertCurriculumInvariants([vocabEntry({ label: 'nouns', pos: ['noun'] })])).toThrow(
      "vocabGroup.label 'nouns' is not one of",
    );
    expect(() => assertCurriculumInvariants([vocabEntry({ label: 'verbs', pos: [] })])).toThrow(
      'vocabGroup.pos must be non-empty',
    );
    expect(() => assertCurriculumInvariants([vocabEntry({ label: 'verbs', pos: ['adj'] })])).toThrow(
      "vocabGroup.pos has unknown class 'adj'",
    );
  });
});
```

If the grammar-kind synthetic entry trips an unrelated grammar-only invariant first (e.g. a missing field grammar entries require), add that field to the `'grammar'` branch of `vocabEntry` so the test reaches 9m.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/db exec vitest run src/curriculum/curriculum.test.ts -t vocabGroup`
Expected: FAIL.

- [ ] **Step 3: Implement** — in `index.ts`, after the 9d coverageSpec block:

```ts
    // 9m. vocabGroup (vocab expansion, 2026-10-17): word-class groups are vocab
    //     umbrellas only, with a known label and a non-empty, known class list.
    if (entry.vocabGroup) {
      if (entry.kind !== 'vocab') {
        throw new Error(
          `Curriculum invariant violated: '${entry.key}' has vocabGroup but is not kind 'vocab'`,
        );
      }
      if (!(VOCAB_GROUP_LABELS as readonly string[]).includes(entry.vocabGroup.label)) {
        throw new Error(
          `Curriculum invariant violated: '${entry.key}' vocabGroup.label '${entry.vocabGroup.label}' is not one of ${VOCAB_GROUP_LABELS.join(', ')}`,
        );
      }
      if (entry.vocabGroup.pos.length === 0) {
        throw new Error(`Curriculum invariant violated: '${entry.key}' vocabGroup.pos must be non-empty`);
      }
      for (const p of entry.vocabGroup.pos) {
        if (!(VOCAB_POS as readonly string[]).includes(p)) {
          throw new Error(`Curriculum invariant violated: '${entry.key}' vocabGroup.pos has unknown class '${p}'`);
        }
      }
    }
```

(import `VOCAB_GROUP_LABELS`, `VOCAB_POS` from `@language-drill/shared`.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/db exec vitest run src/curriculum/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/curriculum/index.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "Add curriculum invariant for vocab word-class groups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tasks 12–14: New vocab umbrellas per language

One task per language, same steps. Each inserts 20 entries **directly after the language's last existing vocab umbrella** (ES: after `es-b2-vocab-culture-arts`; DE: after `de-b2-vocab-culture-arts`; TR: after `tr-b2-vocab-global-issues`), under a header comment:

```ts
  // ---------------------------------------------------------------------------
  // Vocab expansion (2026-10-17): +3 themed topics and +2 word-class groups per
  // level. Themed topics author under the word-class mix (≤60% nouns); groups
  // carry `vocabGroup` and author only their declared classes. coverageSpec:
  // none — the curated target list fixes the class mix, so a wordClass floor on
  // the exercise pool would only duplicate it. No theory-categories entry.
  // ---------------------------------------------------------------------------
```

Every entry has `kind: 'vocab'`, the file's `cefrLevel` / `language` constants (`A1`…`B2`, `ES`/`DE`/`TR`), and the fields given below. `vocabGroup` appears only where listed.

**Steps (each language):**

- [ ] **Step 1: Update the failing count test** — in `curriculum.test.ts`, the language's parity test: `expect(vocab).toBe(20)` → `toBe(40)`, and the test title's "has 20 vocab umbrellas" → "has 40 vocab umbrellas". Add, in the same describe block:

```ts
it('<LANG> has 2 word-class groups per level A1–B2', () => {
  for (const level of ['A1', 'A2', 'B1', 'B2']) {
    const groups = <lang>Curriculum.filter((p) => p.kind === 'vocab' && p.cefrLevel === level && p.vocabGroup);
    expect(groups).toHaveLength(2);
  }
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @language-drill/db exec vitest run src/curriculum/curriculum.test.ts` → FAIL (20 ≠ 40).
- [ ] **Step 3: Add the 20 entries below** and bump the language's `CURRICULUM_VERSION_<LANG>` to the implementation date (`YYYY-MM-DD`, suffix a letter if that date is already the current value) with a changelog line in its doc comment: "+20 vocab umbrellas (vocab expansion): 3 themed topics + 2 word-class groups per level; opens 20 new vocab_recall cells."
- [ ] **Step 4: Run** `pnpm --filter @language-drill/db test` → PASS (invariants, description lengths, book-coverage unaffected).
- [ ] **Step 5: Commit** — `git add packages/db/src/curriculum && git commit -m "Add 20 <LANG> vocab umbrellas: themed topics and word-class groups" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

#### Task 12: Spanish (`packages/db/src/curriculum/es.ts`)

```ts
  {
    key: 'es-a1-vocab-free-time',
    kind: 'vocab',
    name: 'Free time and hobbies (A1)',
    description: 'Core A1 vocabulary for hobbies, sports, and free-time activities, including the verbs used to talk about them (jugar, nadar, bailar).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['jugar al fútbol', 'la película'],
    examplesNegative: ['*jugar la guitarra (instruments take tocar: tocar la guitarra)'],
    commonErrors: [
      'Using "jugar" for instruments — instruments take "tocar" ("tocar la guitarra"), games and sports take "jugar".',
      'Confusing "el deporte" (sport) with "el ejercicio" (exercise).',
    ],
  },
  {
    key: 'es-a1-vocab-time-calendar',
    kind: 'vocab',
    name: 'Time and calendar (A1)',
    description: 'Core A1 vocabulary for days, months, seasons, parts of the day, and telling the time.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['el lunes', 'por la mañana'],
    examplesNegative: ['*en lunes (days take the article: el lunes)'],
    commonErrors: [
      'Capitalizing days and months ("*Lunes", "*Enero") — Spanish writes them in lower case.',
      'Using "en" with days ("*en lunes") instead of the article ("el lunes").',
    ],
  },
  {
    key: 'es-a1-vocab-greetings-phrases',
    kind: 'vocab',
    name: 'Greetings and everyday phrases (A1)',
    description: 'Core A1 fixed expressions for greeting, thanking, apologizing, and polite requests (buenos días, por favor, lo siento, de nada).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['buenos días', 'lo siento'],
    examplesNegative: ['*de nadas'],
    commonErrors: [
      'Using "perdón" and "lo siento" interchangeably: "perdón" gets attention or excuses, "lo siento" expresses regret.',
      'Inflecting fixed expressions ("*de nadas", "*buenas día").',
    ],
  },
  {
    key: 'es-a1-vocab-everyday-verbs',
    kind: 'vocab',
    name: 'Everyday verbs (A1)',
    description: 'Core A1 verbs for daily actions — eating, sleeping, working, buying, living, speaking — in the infinitive, including common reflexive verbs (levantarse, llamarse).',
    cefrLevel: A1,
    language: ES,
    vocabGroup: { label: 'verbs', pos: ['verb'] },
    examplesPositive: ['comer', 'levantarse'],
    examplesNegative: ['*levantar (for "to get up": the reflexive levantarse)'],
    commonErrors: [
      'Dropping the reflexive pronoun on pronominal verbs ("*levanto a las siete" for "me levanto").',
      'Confusing "saber" (know a fact / how to) with "conocer" (know a person or place).',
    ],
  },
  {
    key: 'es-a1-vocab-describing-words',
    kind: 'vocab',
    name: 'Describing words (A1)',
    description: 'Core A1 adjectives for describing people, things, and places — size, colour, age, character, price — in the masculine singular dictionary form.',
    cefrLevel: A1,
    language: ES,
    vocabGroup: { label: 'describing', pos: ['adjective'] },
    examplesPositive: ['grande', 'barato'],
    examplesNegative: ['*la casa blanco'],
    commonErrors: [
      'Missing gender agreement with the noun ("*la casa blanco").',
      'Confusing "bueno" (good, adjective) with "bien" (well, adverb).',
    ],
  },
  {
    key: 'es-a2-vocab-technology-communication',
    kind: 'vocab',
    name: 'Technology and communication (A2)',
    description: 'A2 vocabulary for phones, computers, the internet, messages, and the verbs used with them (enviar, descargar, llamar).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['el móvil', 'descargar'],
    examplesNegative: ['*la móvil'],
    commonErrors: [
      'Mismatching gender on clipped or loan nouns ("*la móvil", "*el red").',
      'Confusing "la contraseña" (password) with "la cuenta" (account).',
    ],
  },
  {
    key: 'es-a2-vocab-celebrations-traditions',
    kind: 'vocab',
    name: 'Celebrations and traditions (A2)',
    description: 'A2 vocabulary for holidays, festivals, birthdays, weddings, and the verbs and phrases used to celebrate (celebrar, felicitar, feliz cumpleaños).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['la boda', 'felicitar'],
    examplesNegative: ['*el boda'],
    commonErrors: [
      'Dropping the final -s of "cumpleaños" ("*feliz cumpleaño") — the noun is invariable.',
      'Confusing "la fiesta" (party, public holiday) with "el festival" (an organised event such as a music festival).',
    ],
  },
  {
    key: 'es-a2-vocab-cooking-restaurants',
    kind: 'vocab',
    name: 'Cooking and restaurants (A2)',
    description: 'A2 vocabulary for cooking methods, kitchen tools, ordering in a restaurant, and describing taste (freír, hervir, la cuenta, picante).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['freír', 'la cuenta'],
    examplesNegative: ['*el cuenta'],
    commonErrors: [
      'Confusing "la cuenta" (the restaurant bill) with "la factura" (an invoice).',
      'Confusing "cocinar" (to cook) with "la cocina" (kitchen, cuisine).',
    ],
  },
  {
    key: 'es-a2-vocab-movement-change-verbs',
    kind: 'vocab',
    name: 'Verbs of movement and change (A2)',
    description: 'A2 verbs for moving and changing state — going, arriving, leaving, returning, becoming, getting better — in the infinitive (llegar, volver, ponerse, quedarse).',
    cefrLevel: A2,
    language: ES,
    vocabGroup: { label: 'verbs', pos: ['verb'] },
    examplesPositive: ['volver', 'quedarse'],
    examplesNegative: ['*quedar (for "to stay somewhere": quedarse)'],
    commonErrors: [
      'Confusing "llevar" (take somewhere) with "traer" (bring here).',
      'Dropping "se" on change-of-state verbs ("*pongo nervioso" for "me pongo nervioso").',
    ],
  },
  {
    key: 'es-a2-vocab-time-frequency-adverbs',
    kind: 'vocab',
    name: 'Time and frequency words (A2)',
    description: 'A2 adverbs and short fixed phrases for time and frequency — ya, todavía, siempre, a menudo, de vez en cuando, nunca.',
    cefrLevel: A2,
    language: ES,
    vocabGroup: { label: 'adverbs', pos: ['adverb', 'phrase'] },
    examplesPositive: ['todavía', 'de vez en cuando'],
    examplesNegative: ['*Siempre no como carne (for "I never eat meat": Nunca como carne)'],
    commonErrors: [
      'Confusing "ya" (already) with "todavía" (still; "todavía no" = not yet).',
      'Putting "nunca" after the verb without "no" ("*Como nunca carne" for "No como nunca carne" / "Nunca como carne").',
    ],
  },
  {
    key: 'es-b1-vocab-travel-tourism',
    kind: 'vocab',
    name: 'Travel and tourism (B1)',
    description: 'B1 vocabulary for planning and booking trips, accommodation, transport problems, and travel experiences (reservar, el alojamiento, el equipaje).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: ['el equipaje', 'reservar'],
    examplesNegative: ['*la equipaje'],
    commonErrors: [
      'Mismatching gender on -aje nouns, which are masculine ("*la equipaje").',
      'Confusing "el billete" / "el boleto" (travel ticket) with "la entrada" (admission ticket).',
    ],
  },
  {
    key: 'es-b1-vocab-money-consumers',
    kind: 'vocab',
    name: 'Money and consumers (B1)',
    description: 'B1 vocabulary for banking, paying, saving, prices, complaints, and consumer rights (ahorrar, la tarjeta, el reembolso, reclamar).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: ['ahorrar', 'el reembolso'],
    examplesNegative: ['*la reembolso'],
    commonErrors: [
      'Confusing "cobrar" (charge, get paid) with "pagar" (pay).',
      'Confusing "la tarjeta" (card) with "la carta" (letter, menu).',
    ],
  },
  {
    key: 'es-b1-vocab-health-lifestyle',
    kind: 'vocab',
    name: 'Health and lifestyle (B1)',
    description: 'B1 vocabulary for healthy habits, diet, exercise, stress, and sleep, including verbs and adjectives (adelgazar, sedentario, el estrés).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: ['adelgazar', 'sedentario'],
    examplesNegative: ['*la estrés'],
    commonErrors: [
      'Confusing "adelgazar" (lose weight) with "engordar" (put on weight).',
      'Using "sano" (healthy, of a person or food) and "saludable" (health-giving) as if every context took both.',
    ],
  },
  {
    key: 'es-b1-vocab-prepositional-verbs',
    kind: 'vocab',
    name: 'Verbs with prepositions (B1)',
    description: 'B1 verbs that govern a fixed preposition, given as the verb plus its preposition (acordarse de, pensar en, depender de, soñar con, tratar de).',
    cefrLevel: B1,
    language: ES,
    vocabGroup: { label: 'verbs', pos: ['verb'] },
    examplesPositive: ['acordarse de', 'soñar con'],
    examplesNegative: ['*pensar de (for "think about": pensar en)'],
    commonErrors: [
      'Calquing English prepositions ("*soñar de", "*depender en").',
      'Dropping "se" on pronominal prepositional verbs ("*acordar de").',
    ],
  },
  {
    key: 'es-b1-vocab-connectors',
    kind: 'vocab',
    name: 'Connectors and discourse markers (B1)',
    description: 'B1 connectors and discourse markers for linking ideas — contrast, cause, consequence, addition (sin embargo, por eso, además, aunque, es decir).',
    cefrLevel: B1,
    language: ES,
    vocabGroup: { label: 'connectors', pos: ['adverb', 'phrase', 'other'] },
    examplesPositive: ['sin embargo', 'por eso'],
    examplesNegative: ['*Porque llovía, no salimos (sentence-initial cause: Como llovía, no salimos)'],
    commonErrors: [
      'Confusing "sino" (but rather, after a negative) with "pero".',
      'Starting a sentence with causal "porque" where "como" is required ("*Porque llovía, no salimos").',
    ],
  },
  {
    key: 'es-b2-vocab-law-justice',
    kind: 'vocab',
    name: 'Law and justice (B2)',
    description: 'B2 vocabulary for the legal system, crime, trials, and rights, including verbs (denunciar, juzgar, condenar) and nouns (el juicio, la pena).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: ['el juicio', 'denunciar'],
    examplesNegative: ['*la juicio'],
    commonErrors: [
      'Confusing "el juez" (judge) with "el jurado" (jury).',
      'Confusing "denunciar" (report a crime) with "demandar" (sue).',
    ],
  },
  {
    key: 'es-b2-vocab-economy-business',
    kind: 'vocab',
    name: 'Economy and business (B2)',
    description: 'B2 vocabulary for the economy, companies, markets, and finance (la inversión, el beneficio, invertir, rentable).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: ['la inversión', 'rentable'],
    examplesNegative: ['*el inversión'],
    commonErrors: [
      'Mismatching article gender on -ión nouns ("*el inversión").',
      'Confusing "el presupuesto" (budget) with "el precio" (price).',
    ],
  },
  {
    key: 'es-b2-vocab-psychology-behaviour',
    kind: 'vocab',
    name: 'Psychology and behaviour (B2)',
    description: 'B2 vocabulary for personality, emotions, mental health, and behaviour, with verbs and adjectives (superar, la autoestima, egoísta, desconfiado).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: ['la autoestima', 'superar'],
    examplesNegative: ['*el autoestima'],
    commonErrors: [
      'Using "sensible" for English "sensible" — Spanish "sensible" means sensitive; sensible is "sensato".',
      'Mismatching gender on "la autoestima" (feminine despite the stressed-a pattern not applying).',
    ],
  },
  {
    key: 'es-b2-vocab-collocations-idioms',
    kind: 'vocab',
    name: 'Collocations and idioms (B2)',
    description: 'B2 fixed collocations and idiomatic expressions in their citation form (tomar una decisión, echar de menos, darse cuenta de, estar de acuerdo, a fin de cuentas).',
    cefrLevel: B2,
    language: ES,
    vocabGroup: { label: 'expressions', pos: ['phrase', 'verb'] },
    examplesPositive: ['echar de menos', 'darse cuenta de'],
    examplesNegative: ['*hacer una decisión (calque: tomar una decisión)'],
    commonErrors: [
      'Calquing English collocations ("*hacer una decisión", "*hacer sentido" for "tener sentido").',
      'Dropping the preposition of a fixed expression ("*darse cuenta que" in careful writing, for "darse cuenta de que").',
    ],
  },
  {
    key: 'es-b2-vocab-formal-connectors',
    kind: 'vocab',
    name: 'Formal connectors and hedging (B2)',
    description: 'B2 formal connectors and hedging expressions for argumentative writing (no obstante, por consiguiente, en cambio, cabe destacar, al parecer).',
    cefrLevel: B2,
    language: ES,
    vocabGroup: { label: 'connectors', pos: ['adverb', 'phrase', 'other'] },
    examplesPositive: ['no obstante', 'por consiguiente'],
    examplesNegative: ['*a cambio (for "by contrast": en cambio)'],
    commonErrors: [
      'Using informal connectors ("pero", "así que") where formal register calls for "no obstante", "por consiguiente".',
      'Confusing "en cambio" (by contrast) with "a cambio" (in exchange).',
    ],
  },
```

#### Task 13: German (`packages/db/src/curriculum/de.ts`)

```ts
  {
    key: 'de-a1-vocab-free-time',
    kind: 'vocab',
    name: 'Free time and hobbies (A1)',
    description: 'Core A1 vocabulary for hobbies, sports, and free-time activities, including the verbs used to talk about them (spielen, schwimmen, tanzen).',
    cefrLevel: A1,
    language: DE,
    examplesPositive: ['das Hobby', 'schwimmen'],
    examplesNegative: ['*der Hobby'],
    commonErrors: [
      'Mismatching article gender on loanwords ("*der Hobby" for "das Hobby").',
      'Using "spielen" for every activity — swimming, dancing and cycling take their own verbs ("schwimmen", "tanzen", "Rad fahren").',
    ],
  },
  {
    key: 'de-a1-vocab-time-calendar',
    kind: 'vocab',
    name: 'Time and calendar (A1)',
    description: 'Core A1 vocabulary for days, months, seasons, parts of the day, and telling the time.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: ['der Montag', 'am Morgen'],
    examplesNegative: ['*die Montag'],
    commonErrors: [
      'Using "in" with days ("*in Montag") instead of "am" ("am Montag").',
      'Forgetting that days, months and seasons are masculine ("der Montag", "der Mai", "der Winter").',
    ],
  },
  {
    key: 'de-a1-vocab-greetings-phrases',
    kind: 'vocab',
    name: 'Greetings and everyday phrases (A1)',
    description: 'Core A1 fixed expressions for greeting, thanking, apologizing, and polite requests (guten Morgen, bitte, danke schön, Entschuldigung).',
    cefrLevel: A1,
    language: DE,
    examplesPositive: ['guten Morgen', 'Entschuldigung'],
    examplesNegative: ['*gute Morgen'],
    commonErrors: [
      'Dropping the accusative ending in greetings ("*gute Morgen" for "guten Morgen").',
      'Confusing "Entschuldigung" (excuse me / sorry) with "Es tut mir leid" (I am sorry, expressing regret).',
    ],
  },
  {
    key: 'de-a1-vocab-everyday-verbs',
    kind: 'vocab',
    name: 'Everyday verbs (A1)',
    description: 'Core A1 verbs for daily actions — eating, sleeping, working, buying, living, speaking — in the infinitive, including common separable verbs (aufstehen, einkaufen).',
    cefrLevel: A1,
    language: DE,
    vocabGroup: { label: 'verbs', pos: ['verb'] },
    examplesPositive: ['essen', 'aufstehen'],
    examplesNegative: ['*Ich aufstehe um sieben'],
    commonErrors: [
      'Not separating the prefix in a main clause ("*Ich aufstehe um sieben" for "Ich stehe um sieben auf").',
      'Confusing "kennen" (know a person or place) with "wissen" (know a fact).',
    ],
  },
  {
    key: 'de-a1-vocab-describing-words',
    kind: 'vocab',
    name: 'Describing words (A1)',
    description: 'Core A1 adjectives for describing people, things, and places — size, colour, age, character, price — in the uninflected dictionary form.',
    cefrLevel: A1,
    language: DE,
    vocabGroup: { label: 'describing', pos: ['adjective'] },
    examplesPositive: ['groß', 'billig'],
    examplesNegative: ['*ein großer Haus'],
    commonErrors: [
      'Wrong adjective ending after an article ("*ein großer Haus" for "ein großes Haus").',
      'Confusing "alt" (old) with the comparative "älter" (older).',
    ],
  },
  {
    key: 'de-a2-vocab-technology-communication',
    kind: 'vocab',
    name: 'Technology and communication (A2)',
    description: 'A2 vocabulary for phones, computers, the internet, messages, and the verbs used with them (schicken, herunterladen, anrufen).',
    cefrLevel: A2,
    language: DE,
    examplesPositive: ['das Handy', 'anrufen'],
    examplesNegative: ['*Ich rufe dir an'],
    commonErrors: [
      'Using a dative object with "anrufen" ("*Ich rufe dir an") — it takes the accusative ("Ich rufe dich an").',
      'Mismatching gender on loanwords ("*der Handy").',
    ],
  },
  {
    key: 'de-a2-vocab-time-daily-routine',
    kind: 'vocab',
    name: 'Time and daily routine (A2)',
    description: 'A2 vocabulary for daily routines, schedules, and household tasks, including separable and reflexive verbs (sich anziehen, aufräumen, der Feierabend).',
    cefrLevel: A2,
    language: DE,
    examplesPositive: ['sich anziehen', 'der Feierabend'],
    examplesNegative: ['*Ich aufräume mein Zimmer'],
    commonErrors: [
      'Dropping the reflexive pronoun ("*Ich ziehe an" for "Ich ziehe mich an").',
      'Leaving the separable prefix attached in a main clause ("*Ich aufräume mein Zimmer").',
    ],
  },
  {
    key: 'de-a2-vocab-cooking-restaurants',
    kind: 'vocab',
    name: 'Cooking and restaurants (A2)',
    description: 'A2 vocabulary for cooking methods, kitchen tools, ordering in a restaurant, and describing taste (braten, kochen, die Rechnung, scharf).',
    cefrLevel: A2,
    language: DE,
    examplesPositive: ['braten', 'die Rechnung'],
    examplesNegative: ['*der Rechnung'],
    commonErrors: [
      'Confusing "kochen" (cook, boil) with "backen" (bake).',
      'Confusing the noun "das Essen" (food, meal) with the verb "essen" (to eat) — only the noun is capitalized.',
    ],
  },
  {
    key: 'de-a2-vocab-movement-change-verbs',
    kind: 'vocab',
    name: 'Verbs of movement and change (A2)',
    description: 'A2 verbs for moving and changing state — going, arriving, leaving, returning, becoming — in the infinitive (ankommen, zurückkommen, werden, sich verändern).',
    cefrLevel: A2,
    language: DE,
    vocabGroup: { label: 'verbs', pos: ['verb'] },
    examplesPositive: ['ankommen', 'sich verändern'],
    examplesNegative: ['*Ich habe angekommen'],
    commonErrors: [
      'Using "haben" instead of "sein" in the perfect of movement verbs ("*Ich habe angekommen").',
      'Confusing "bringen" (bring, take) with "holen" (fetch).',
    ],
  },
  {
    key: 'de-a2-vocab-time-frequency-adverbs',
    kind: 'vocab',
    name: 'Time and frequency words (A2)',
    description: 'A2 adverbs and short fixed phrases for time and frequency — schon, noch, immer, oft, ab und zu, nie.',
    cefrLevel: A2,
    language: DE,
    vocabGroup: { label: 'adverbs', pos: ['adverb', 'phrase'] },
    examplesPositive: ['noch nicht', 'ab und zu'],
    examplesNegative: ['*Ich oft gehe ins Kino'],
    commonErrors: [
      'Confusing "schon" (already) with "noch" (still), and "noch nicht" (not yet) with "nicht mehr" (no longer).',
      'Placing the adverb before the verb in a main clause ("*Ich oft gehe ins Kino").',
    ],
  },
  {
    key: 'de-b1-vocab-travel-tourism',
    kind: 'vocab',
    name: 'Travel and tourism (B1)',
    description: 'B1 vocabulary for planning and booking trips, accommodation, transport problems, and travel experiences (buchen, die Unterkunft, die Verspätung).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: ['die Unterkunft', 'buchen'],
    examplesNegative: ['*der Unterkunft'],
    commonErrors: [
      'Confusing "verpassen" (miss a train) with "vermissen" (miss a person).',
      'Confusing "die Reise" (a trip) with "das Reisen" (travelling, the activity).',
    ],
  },
  {
    key: 'de-b1-vocab-money-consumers',
    kind: 'vocab',
    name: 'Money and consumers (B1)',
    description: 'B1 vocabulary for banking, paying, saving, prices, complaints, and consumer rights (sparen, überweisen, die Rückerstattung, sich beschweren).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: ['sparen', 'sich beschweren'],
    examplesNegative: ['*sich beschweren an (for "complain about": sich beschweren über)'],
    commonErrors: [
      'Using "bekommen" as "become" — it means "get"; "become" is "werden".',
      'Confusing "das Konto" (account) with "die Rechnung" (bill).',
    ],
  },
  {
    key: 'de-b1-vocab-health-lifestyle',
    kind: 'vocab',
    name: 'Health and lifestyle (B1)',
    description: 'B1 vocabulary for healthy habits, diet, exercise, stress, and sleep, including verbs and adjectives (abnehmen, sich ernähren, gesund, der Stress).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: ['abnehmen', 'sich ernähren'],
    examplesNegative: ['*Ich ernähre gesund (missing the reflexive: Ich ernähre mich gesund)'],
    commonErrors: [
      'Dropping the reflexive pronoun on "sich ernähren" and "sich bewegen".',
      'Confusing "abnehmen" (lose weight) with "zunehmen" (gain weight).',
    ],
  },
  {
    key: 'de-b1-vocab-prepositional-verbs',
    kind: 'vocab',
    name: 'Verbs with prepositions (B1)',
    description: 'B1 verbs with a fixed preposition, given as the verb plus its preposition (sich freuen auf, warten auf, denken an, sich interessieren für, teilnehmen an).',
    cefrLevel: B1,
    language: DE,
    vocabGroup: { label: 'verbs', pos: ['verb'] },
    examplesPositive: ['sich freuen auf', 'warten auf'],
    examplesNegative: ['*warten für'],
    commonErrors: [
      'Calquing English prepositions ("*warten für", "*denken über" for "denken an").',
      'Confusing "sich freuen auf" (look forward to) with "sich freuen über" (be pleased about).',
    ],
  },
  {
    key: 'de-b1-vocab-connectors',
    kind: 'vocab',
    name: 'Connectors and discourse markers (B1)',
    description: 'B1 connectors and discourse markers for linking ideas — contrast, cause, consequence, addition (trotzdem, deshalb, außerdem, obwohl, das heißt).',
    cefrLevel: B1,
    language: DE,
    vocabGroup: { label: 'connectors', pos: ['adverb', 'phrase', 'other'] },
    examplesPositive: ['trotzdem', 'deshalb'],
    examplesNegative: ['*Trotzdem ich bin müde'],
    commonErrors: [
      'Wrong word order after an adverbial connector — the verb comes second ("Trotzdem bin ich müde").',
      'Confusing "obwohl" (subordinating, verb-final) with "trotzdem" (adverb, verb-second).',
    ],
  },
  {
    key: 'de-b2-vocab-law-justice',
    kind: 'vocab',
    name: 'Law and justice (B2)',
    description: 'B2 vocabulary for the legal system, crime, trials, and rights, including verbs (anzeigen, verurteilen, klagen) and nouns (das Gericht, die Strafe).',
    cefrLevel: B2,
    language: DE,
    examplesPositive: ['das Gericht', 'verurteilen'],
    examplesNegative: ['*der Gericht'],
    commonErrors: [
      'Confusing "der Richter" (judge) with "der Anwalt" (lawyer).',
      'Confusing "anzeigen" (report to the police) with "verklagen" (sue).',
    ],
  },
  {
    key: 'de-b2-vocab-economy-business',
    kind: 'vocab',
    name: 'Economy and business (B2)',
    description: 'B2 vocabulary for the economy, companies, markets, and finance (die Investition, der Gewinn, investieren, rentabel).',
    cefrLevel: B2,
    language: DE,
    examplesPositive: ['der Gewinn', 'rentabel'],
    examplesNegative: ['*das Gewinn'],
    commonErrors: [
      'Confusing "der Gewinn" (profit) with "der Umsatz" (turnover).',
      'Confusing "die Firma" (the company) with "der Betrieb" (the operation, plant).',
    ],
  },
  {
    key: 'de-b2-vocab-psychology-behaviour',
    kind: 'vocab',
    name: 'Psychology and behaviour (B2)',
    description: 'B2 vocabulary for personality, emotions, mental health, and behaviour, with verbs and adjectives (bewältigen, das Selbstwertgefühl, rücksichtslos, misstrauisch).',
    cefrLevel: B2,
    language: DE,
    examplesPositive: ['bewältigen', 'misstrauisch'],
    examplesNegative: ['*die Selbstwertgefühl'],
    commonErrors: [
      'Using "sensibel" for English "sensible" — "sensibel" means sensitive; sensible is "vernünftig".',
      'Confusing "sich verhalten" (behave, act) with "sich benehmen" (behave well or badly, manners).',
    ],
  },
  {
    key: 'de-b2-vocab-collocations-idioms',
    kind: 'vocab',
    name: 'Collocations and idioms (B2)',
    description: 'B2 fixed collocations and idiomatic expressions in their citation form (eine Entscheidung treffen, in Frage kommen, zur Verfügung stehen, Bescheid sagen).',
    cefrLevel: B2,
    language: DE,
    vocabGroup: { label: 'expressions', pos: ['phrase', 'verb'] },
    examplesPositive: ['eine Entscheidung treffen', 'zur Verfügung stehen'],
    examplesNegative: ['*eine Entscheidung machen'],
    commonErrors: [
      'Calquing English collocations ("*eine Entscheidung machen", "*ein Foto nehmen" for "ein Foto machen").',
      'Dropping the contracted article of a fixed phrase ("*zu Verfügung stehen").',
    ],
  },
  {
    key: 'de-b2-vocab-formal-connectors',
    kind: 'vocab',
    name: 'Formal connectors and hedging (B2)',
    description: 'B2 formal connectors and hedging expressions for argumentative writing (dennoch, folglich, hingegen, es ist anzumerken, angeblich).',
    cefrLevel: B2,
    language: DE,
    vocabGroup: { label: 'connectors', pos: ['adverb', 'phrase', 'other'] },
    examplesPositive: ['dennoch', 'folglich'],
    examplesNegative: ['*Folglich wir müssen handeln'],
    commonErrors: [
      'Using informal connectors ("aber", "also") where formal register calls for "dennoch", "folglich".',
      'Wrong word order after an adverbial connector ("*Folglich wir müssen handeln" for "Folglich müssen wir handeln").',
    ],
  },
```

#### Task 14: Turkish (`packages/db/src/curriculum/tr.ts`)

```ts
  {
    key: 'tr-a1-vocab-free-time',
    kind: 'vocab',
    name: 'Free time and hobbies (A1)',
    description: 'Core A1 vocabulary for hobbies, sports, and free-time activities, including the verbs used to talk about them (oynamak, yüzmek, dans etmek).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: ['futbol oynamak', 'yüzmek'],
    examplesNegative: ['*gitar oynamak (instruments take çalmak: gitar çalmak)'],
    commonErrors: [
      'Using "oynamak" for instruments — instruments take "çalmak" ("gitar çalmak").',
      'Using "oynamak" for sport in general — the general verb is "spor yapmak".',
    ],
  },
  {
    key: 'tr-a1-vocab-time-calendar',
    kind: 'vocab',
    name: 'Time and calendar (A1)',
    description: 'Core A1 vocabulary for days, months, seasons, parts of the day, and telling the time.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: ['pazartesi', 'sabah'],
    examplesNegative: ['*üç saat (for "three o\'clock": saat üç)'],
    commonErrors: [
      'Confusing "saat üç" (three o\'clock) with "üç saat" (three hours).',
      'Confusing "gün" (day) with "gündüz" (daytime).',
    ],
  },
  {
    key: 'tr-a1-vocab-greetings-phrases',
    kind: 'vocab',
    name: 'Greetings and everyday phrases (A1)',
    description: 'Core A1 fixed expressions for greeting, thanking, apologizing, and polite requests (merhaba, teşekkür ederim, özür dilerim, lütfen, kolay gelsin).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: ['teşekkür ederim', 'kolay gelsin'],
    examplesNegative: ['*afiyet olsun (said before a trip — it is for meals; for a trip: iyi yolculuklar)'],
    commonErrors: [
      'Using "afiyet olsun" (enjoy your meal) where "iyi yolculuklar" (have a good trip) fits.',
      'Confusing "özür dilerim" (I apologize) with "pardon" (excuse me, to get attention).',
    ],
  },
  {
    key: 'tr-a1-vocab-everyday-verbs',
    kind: 'vocab',
    name: 'Everyday verbs (A1)',
    description: 'Core A1 verbs for daily actions — eating, sleeping, working, buying, living, speaking — in the -mek/-mak infinitive (yemek, uyumak, çalışmak, almak).',
    cefrLevel: A1,
    language: TR,
    vocabGroup: { label: 'verbs', pos: ['verb'] },
    examplesPositive: ['uyumak', 'çalışmak'],
    examplesNegative: ['*içmak (vowel harmony: içmek)'],
    commonErrors: [
      'Breaking vowel harmony in the infinitive ("*içmak" for "içmek").',
      'Confusing "bilmek" (know a fact) with "tanımak" (know a person).',
    ],
  },
  {
    key: 'tr-a1-vocab-describing-words',
    kind: 'vocab',
    name: 'Describing words (A1)',
    description: 'Core A1 adjectives for describing people, things, and places — size, colour, age, character, price (büyük, ucuz, yeni, güzel).',
    cefrLevel: A1,
    language: TR,
    vocabGroup: { label: 'describing', pos: ['adjective'] },
    examplesPositive: ['büyük', 'ucuz'],
    examplesNegative: ['*yaşlı ev (for an old house: eski ev)'],
    commonErrors: [
      'Confusing "eski" (old, of things) with "yaşlı" (old, of people).',
      'Placing "bir" before the adjective in neutral description — the unmarked order is "kırmızı bir araba".',
    ],
  },
  {
    key: 'tr-a2-vocab-technology-communication',
    kind: 'vocab',
    name: 'Technology and communication (A2)',
    description: 'A2 vocabulary for phones, computers, the internet, messages, and the verbs used with them (mesaj göndermek, indirmek, aramak).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: ['cep telefonu', 'indirmek'],
    examplesNegative: ['*cep telefon'],
    commonErrors: [
      'Dropping the compound marker on noun compounds ("*cep telefon" for "cep telefonu").',
      'Confusing "aramak" (call, search) with "çağırmak" (summon, call over).',
    ],
  },
  {
    key: 'tr-a2-vocab-celebrations-traditions',
    kind: 'vocab',
    name: 'Celebrations and traditions (A2)',
    description: 'A2 vocabulary for holidays, festivals, birthdays, weddings, and the phrases used to celebrate (bayram, düğün, kutlamak, iyi bayramlar).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: ['düğün', 'kutlamak'],
    examplesNegative: ['*bayram (for a summer vacation: tatil)'],
    commonErrors: [
      'Confusing "bayram" (religious or national holiday) with "tatil" (vacation, day off).',
      'Using the informal possessive in formal wishes ("doğum günün kutlu olsun" vs formal "doğum gününüz kutlu olsun").',
    ],
  },
  {
    key: 'tr-a2-vocab-cooking-restaurants',
    kind: 'vocab',
    name: 'Cooking and restaurants (A2)',
    description: 'A2 vocabulary for cooking methods, kitchen tools, ordering in a restaurant, and describing taste (kızartmak, haşlamak, hesap, acı).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: ['kızartmak', 'hesap'],
    examplesNegative: ['*hesapı (consonant softening: hesabı)'],
    commonErrors: [
      'Missing consonant softening before a vowel suffix ("*hesapı" for "hesabı").',
      'Confusing "pişirmek" (cook something) with "pişmek" (be cooked).',
    ],
  },
  {
    key: 'tr-a2-vocab-movement-change-verbs',
    kind: 'vocab',
    name: 'Verbs of movement and change (A2)',
    description: 'A2 verbs for moving and changing state — going, arriving, leaving, returning, becoming — in the -mek/-mak infinitive (varmak, dönmek, ayrılmak, olmak).',
    cefrLevel: A2,
    language: TR,
    vocabGroup: { label: 'verbs', pos: ['verb'] },
    examplesPositive: ['varmak', 'ayrılmak'],
    examplesNegative: ['*okulu ayrılmak (ayrılmak takes the ablative: okuldan ayrılmak)'],
    commonErrors: [
      'Wrong case with movement verbs ("*okulu ayrılmak" for "okuldan ayrılmak", "*evde dönmek" for "eve dönmek").',
      'Confusing "gelmek" (come) with "girmek" (enter).',
    ],
  },
  {
    key: 'tr-a2-vocab-time-frequency-adverbs',
    kind: 'vocab',
    name: 'Time and frequency words (A2)',
    description: 'A2 adverbs and short fixed phrases for time and frequency — hâlâ, henüz, artık, her zaman, sık sık, ara sıra.',
    cefrLevel: A2,
    language: TR,
    vocabGroup: { label: 'adverbs', pos: ['adverb', 'phrase'] },
    examplesPositive: ['hâlâ', 'ara sıra'],
    examplesNegative: ['*Hiç gittim (hiç needs a negative verb: Hiç gitmedim)'],
    commonErrors: [
      'Using "hiç" with an affirmative verb ("*Hiç gittim" for "Hiç gitmedim").',
      'Confusing "hâlâ" (still) with "artık" (anymore, from now on).',
    ],
  },
  {
    key: 'tr-b1-vocab-travel-tourism',
    kind: 'vocab',
    name: 'Travel and tourism (B1)',
    description: 'B1 vocabulary for planning and booking trips, accommodation, transport problems, and travel experiences (rezervasyon yaptırmak, konaklama, rötar).',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['konaklama', 'rezervasyon yaptırmak'],
    examplesNegative: ['*rezervasyon etmek'],
    commonErrors: [
      'Using the wrong light verb ("*rezervasyon etmek" for "rezervasyon yapmak / yaptırmak").',
      'Confusing "kaçırmak" (miss a bus) with "özlemek" (miss a person).',
    ],
  },
  {
    key: 'tr-b1-vocab-money-consumers',
    kind: 'vocab',
    name: 'Money and consumers (B1)',
    description: 'B1 vocabulary for banking, paying, saving, prices, complaints, and consumer rights (biriktirmek, havale, iade, şikâyet etmek).',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['biriktirmek', 'iade'],
    examplesNegative: ['*şikâyet yapmak'],
    commonErrors: [
      'Using the wrong light verb ("*şikâyet yapmak" for "şikâyet etmek").',
      'Confusing "borç almak" (borrow) with "borç vermek" (lend).',
    ],
  },
  {
    key: 'tr-b1-vocab-health-lifestyle',
    kind: 'vocab',
    name: 'Health and lifestyle (B1)',
    description: 'B1 vocabulary for healthy habits, diet, exercise, stress, and sleep, including verbs and adjectives (kilo vermek, beslenmek, sağlıklı, hareketsiz).',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['kilo vermek', 'sağlıklı'],
    examplesNegative: ['*kilo vermek (for "put on weight": kilo almak)'],
    commonErrors: [
      'Confusing "kilo vermek" (lose weight) with "kilo almak" (put on weight).',
      'Confusing "sağlık" (health, noun) with "sağlıklı" (healthy, adjective).',
    ],
  },
  {
    key: 'tr-b1-vocab-case-governed-verbs',
    kind: 'vocab',
    name: 'Verbs with case government (B1)',
    description: 'B1 verbs that require a fixed case on their object, in the -mek/-mak infinitive with the case named in the gloss (güvenmek -e, korkmak -den, bahsetmek -den, inanmak -e).',
    cefrLevel: B1,
    language: TR,
    vocabGroup: { label: 'verbs', pos: ['verb'] },
    examplesPositive: ['güvenmek', 'bahsetmek'],
    examplesNegative: ['*onu güvenmek (güvenmek takes the dative: ona güvenmek)'],
    commonErrors: [
      'Using the accusative where the verb governs the dative or ablative ("*köpeği korkmak" for "köpekten korkmak").',
      'Confusing "bahsetmek" (mention, with -den) with "anlatmak" (tell, with -i).',
    ],
  },
  {
    key: 'tr-b1-vocab-connectors',
    kind: 'vocab',
    name: 'Connectors and discourse markers (B1)',
    description: 'B1 connectors and discourse markers for linking ideas — contrast, cause, consequence, addition (ama, ancak, bu yüzden, ayrıca, yani, çünkü).',
    cefrLevel: B1,
    language: TR,
    vocabGroup: { label: 'connectors', pos: ['adverb', 'phrase', 'other'] },
    examplesPositive: ['bu yüzden', 'ayrıca'],
    examplesNegative: ['*Yağmura rağmen ama çıktık (rağmen already marks the contrast)'],
    commonErrors: [
      'Doubling contrast markers ("*-e rağmen … ama").',
      'Confusing "yani" (that is, I mean) with "yoksa" (or else, otherwise).',
    ],
  },
  {
    key: 'tr-b2-vocab-law-justice',
    kind: 'vocab',
    name: 'Law and justice (B2)',
    description: 'B2 vocabulary for the legal system, crime, trials, and rights, including verbs (dava açmak, yargılamak, cezalandırmak) and nouns (mahkeme, ceza).',
    cefrLevel: B2,
    language: TR,
    examplesPositive: ['mahkeme', 'dava açmak'],
    examplesNegative: ['*dava yapmak'],
    commonErrors: [
      'Using the wrong light verb ("*dava yapmak" for "dava açmak").',
      'Confusing "hâkim" (judge) with "avukat" (lawyer) and "savcı" (prosecutor).',
    ],
  },
  {
    key: 'tr-b2-vocab-economy-business',
    kind: 'vocab',
    name: 'Economy and business (B2)',
    description: 'B2 vocabulary for the economy, companies, markets, and finance (yatırım, kâr, yatırım yapmak, kârlı).',
    cefrLevel: B2,
    language: TR,
    examplesPositive: ['yatırım yapmak', 'kârlı'],
    examplesNegative: ['*yatırım etmek'],
    commonErrors: [
      'Using the wrong light verb ("*yatırım etmek" for "yatırım yapmak").',
      'Writing "kâr" (profit) without its circumflex, which reads as "kar" (snow).',
    ],
  },
  {
    key: 'tr-b2-vocab-psychology-behaviour',
    kind: 'vocab',
    name: 'Psychology and behaviour (B2)',
    description: 'B2 vocabulary for personality, emotions, mental health, and behaviour, with verbs and adjectives (üstesinden gelmek, özgüven, bencil, kuşkucu).',
    cefrLevel: B2,
    language: TR,
    examplesPositive: ['özgüven', 'üstesinden gelmek'],
    examplesNegative: ['*sorunu üstesinden gelmek (the object takes the genitive: sorunun üstesinden gelmek)'],
    commonErrors: [
      'Wrong case with "üstesinden gelmek" — the object takes the genitive ("sorunun üstesinden gelmek").',
      'Confusing "duygusal" (emotional) with "hassas" (sensitive).',
    ],
  },
  {
    key: 'tr-b2-vocab-collocations-idioms',
    kind: 'vocab',
    name: 'Collocations and idioms (B2)',
    description: 'B2 fixed collocations and idiomatic expressions in their citation form (karar vermek, göz önünde bulundurmak, aklına gelmek, iyi ki, ne de olsa).',
    cefrLevel: B2,
    language: TR,
    vocabGroup: { label: 'expressions', pos: ['phrase', 'verb'] },
    examplesPositive: ['karar vermek', 'göz önünde bulundurmak'],
    examplesNegative: ['*karar yapmak'],
    commonErrors: [
      'Using the wrong light verb in a collocation ("*karar yapmak", "*fotoğraf almak" for "fotoğraf çekmek").',
      'Breaking the fixed word order of an idiom ("*bulundurmak göz önünde").',
    ],
  },
  {
    key: 'tr-b2-vocab-formal-connectors',
    kind: 'vocab',
    name: 'Formal connectors and hedging (B2)',
    description: 'B2 formal connectors and hedging expressions for argumentative writing (dolayısıyla, bununla birlikte, öte yandan, söz konusu, görünüşe göre).',
    cefrLevel: B2,
    language: TR,
    vocabGroup: { label: 'connectors', pos: ['adverb', 'phrase', 'other'] },
    examplesPositive: ['dolayısıyla', 'bununla birlikte'],
    examplesNegative: ['*o yüzden (in a formal essay, where dolayısıyla fits)'],
    commonErrors: [
      'Using informal connectors ("ama", "o yüzden") where formal register calls for "ancak", "dolayısıyla".',
      'Confusing "öte yandan" (on the other hand) with "ayrıca" (in addition).',
    ],
  },
```

- [ ] **PR 2 gate** (after Task 14): from the repo root `pnpm lint && pnpm typecheck && pnpm test` → zero failures. Push the branch, open the PR (`Vocab expansion part 2: 60 new vocab groups`), body ending with the Claude Code attribution line.

---

## Rollout (prod — not code tasks)

`DBURL=$(aws --region eu-central-1 secretsmanager get-secret-value --secret-id language-drill/DATABASE_URL --query SecretString --output text)`. Commands run from `packages/db`.

1. **Merge PR 1 and deploy.** From fresh main:
   - Langfuse: `push-prompts --dry-run` → `push-prompts` → `bootstrap-prompts --check`, prod and dev (CLAUDE.md "Prompt Editing").
   - `DATABASE_URL="$DBURL" npx tsx scripts/backfill-vocab-target-pos.ts` (dry run, classifier included) → review counts and the llm sample → `--apply`. Copy the artifact to `/Users/seal/dev/language-drill/.claude/backfill-artifacts-prod-2026-10/`. Verify: `select language, pos, count(*) from vocab_target where status='approved' group by 1,2` shows no null `pos`.
2. **Pilot ES A2 + B1:** `generate:vocab-targets --language ES --level A2 --fill-mix`, same for B1 → Claude triage of `review:flagged-vocab --language ES` → user spot-check → `--approve-all`. After one nightly run, compare `vocab_recall` approval rates by target `pos` (join on `content_json->>'seedWord'` = `vocab_target.lemma`). A gap > 15pp vs nouns → fix the generation/validation prompt before going on.
3. **Author the PR 2 umbrellas against prod from the PR 2 branch, BEFORE merging it.** `vocab_target.umbrella_key` has no FK and the CLI resolves umbrellas from code, so the branch can write their targets while prod does not know the umbrellas yet. Approving them first means the 60 new `vocab_recall` cells never free-generate untargeted rows once they exist. Per new umbrella: `DATABASE_URL="$DBURL" pnpm generate:vocab-targets --language <L> --level <X> --umbrella <key>` (never a whole level without `--umbrella`, which would also grow the existing themed topics; use `--fill-mix` per level for those) → triage → spot-check → approve, per language. The branch carries `vocab-target-generate@2026-10-18` (group request line, class-tagged avoid list); both changes are in the code-built user prompt, so the CLI uses them directly.
4. **Merge PR 2 and deploy.** From fresh main, `push-prompts --dry-run` / `push-prompts` / `bootstrap-prompts --check` for prod and dev to record `vocab-target-generate@2026-10-18` (expect no body drift: the Langfuse system template did not change). `deploy.yml` runs `seed:exercises`, which adds the new umbrellas' `skill_topics` rows. The nightly scheduler then fills the cells over 1–2 weeks; watch the generation-run stats for flag-loop spikes on the new cells.
