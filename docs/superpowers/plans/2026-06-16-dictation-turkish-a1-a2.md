# Dictation for Turkish (A1/A2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the dictation generation pipeline (live for ES B1/B2) to **Turkish A1 + A2** — two curriculum umbrellas, the `Burcu` neural voice, A1/A2 cell targets, and A1/A2 length bands in the generation + validation prompts.

**Architecture:** The pipeline is already language/level-agnostic. This adds the three per-language/level knobs: curriculum dictation umbrellas (`tr-a1-dictation`, `tr-a2-dictation`), the Polly voice pool entry (`Burcu` — the only neural `tr-TR` voice), and the prompts' per-level length bands (currently B1/B2-only). No DB migration, no infra change.

**Tech Stack:** TypeScript, pnpm + Turborepo, Vitest; Drizzle curriculum data (`packages/db`); Langfuse-registered prompts (`packages/ai`); Lambda cell-targets (`infra/lambda`).

**Spec:** [`../specs/2026-06-16-dictation-turkish-a1-a2-design.md`](../specs/2026-06-16-dictation-turkish-a1-a2-design.md)

**Conventions:** Work in the worktree `/Users/seal/dev/language-drill/.claude/worktrees/feat-dictation-langs` (run all commands from there). Real gate is `pnpm turbo run test --concurrency=1`; build changed deps (`pnpm turbo run build`) if a single-package run hits stale-dist "Cannot find module '@language-drill/...'". Editing a `*_SYSTEM_PROMPT` requires bumping its `*_PROMPT_VERSION` in the same commit (CLAUDE.md).

---

## Task 1: TR dictation umbrellas + curriculum version bump

**Files:**
- Modify: `packages/db/src/curriculum/tr.ts`
- Test: `packages/db/src/generation/cells.test.ts`, `packages/db/src/curriculum/curriculum.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/db/src/generation/cells.test.ts`, add (mirror the existing ES dictation test):

```ts
import { ExerciseType } from '@language-drill/shared';
import { enumerateCurriculumCells } from './cells';
import { trCurriculum } from '../curriculum';

it('pairs the TR dictation umbrellas with DICTATION only', () => {
  const cells = enumerateCurriculumCells(trCurriculum).filter(
    (c) => c.grammarPoint.kind === 'dictation',
  );
  const keys = cells.map((c) => c.grammarPoint.key).sort();
  expect(keys).toEqual(['tr-a1-dictation', 'tr-a2-dictation']);
  for (const cell of cells) {
    expect(cell.exerciseType).toBe(ExerciseType.DICTATION);
  }
});
```

- [ ] **Step 2: Run it — expect FAIL** (no TR dictation umbrellas yet).

Run: `pnpm --filter @language-drill/db test -- cells.test.ts`

- [ ] **Step 3: Add the two umbrellas**

In `packages/db/src/curriculum/tr.ts`, append to the `trCurriculum` array (after the last entry, before the closing `];`). `TR`, `A1`, `A2` constants are already defined at the top of the file:

```ts
  // ---------------------------------------------------------------------------
  // Dictation umbrellas — kind: 'dictation' (Phase 2 generation pipeline)
  // ---------------------------------------------------------------------------
  {
    key: 'tr-a1-dictation',
    kind: 'dictation',
    name: 'Dictation — connected speech (A1)',
    description:
      'Short, clearly-articulated A1 Turkish clips (one simple everyday sentence); tests vowel-harmony suffixes and word-final consonant softening by ear.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Bugün hava çok güzel.',
      'Benim adım Ali ve ben öğretmenim.',
    ],
    examplesNegative: ['*Tek kelime ya da bağlantısız bir kelime listesi (cümle değil).'],
    commonErrors: [
      'Mishearing vowel-harmony suffixes (evler vs. *evlar).',
      'Missing word-final consonant softening (kitabı heard/spelled as kitap).',
    ],
  },
  {
    key: 'tr-a2-dictation',
    kind: 'dictation',
    name: 'Dictation — connected speech (A2)',
    description:
      'Short A2 Turkish clips (1–2 everyday sentences, light connected speech); tests suffix-heavy word segmentation and tracking across joined clauses.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Hafta sonu arkadaşlarımla sinemaya gittik ve film çok güzeldi.',
      'Dün markete gidip biraz ekmek, peynir ve süt aldım.',
    ],
    examplesNegative: ['*Çok uzun ya da A2 seviyesinin çok üstünde kelimeler içeren metin.'],
    commonErrors: [
      "Losing track across two clauses joined by 've'.",
      'Mis-segmenting suffix-heavy words (arkadaşlarımla).',
    ],
  },
```

- [ ] **Step 4: Bump `CURRICULUM_VERSION_TR`**

In `tr.ts`, change `export const CURRICULUM_VERSION_TR = '2026-06-14';` to `'2026-06-16'`, and add a one-line note to its doc-comment, e.g.: `// 2026-06-16: added the tr-a1/a2-dictation umbrellas (clears suppression so the scheduler enumerates the new dictation cells).` This is REQUIRED — the scheduler only enumerates new cells / clears low-yield suppression on a curriculum-version change.

- [ ] **Step 5: Run both test files — expect PASS**

Run: `pnpm --filter @language-drill/db test -- cells.test.ts curriculum.test.ts`

If `curriculum.test.ts` asserts an exact TR entry total or a per-kind count (the file's header references TR count assertions), update it to include the two new `kind: 'dictation'` entries — adjust the expected number by +2 and add `'dictation'` to any kind allow-list. Do NOT loosen an exact-count assertion silently. (The `PER_LANGUAGE_GRAMMAR_MIN` grammar-count invariant counts only `kind: 'grammar'`, so it is unaffected.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/curriculum/tr.ts packages/db/src/generation/cells.test.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(db): add tr-a1/a2-dictation umbrellas + bump TR curriculum version"
```

---

## Task 2: Turkish voice pool (Burcu)

**Files:**
- Modify: `packages/ai/src/generate.ts`
- Test: `packages/ai/src/generate.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/ai/src/generate.test.ts`:

```ts
import { DICTATION_VOICE_POOL_BY_LANGUAGE, parseGeneratedDictationDraft } from './generate';
import { ExerciseType, Language } from '@language-drill/shared';

it('has a Turkish dictation voice pool (Burcu, the only neural tr-TR voice)', () => {
  const pool = DICTATION_VOICE_POOL_BY_LANGUAGE[Language.TR];
  expect(pool.length).toBeGreaterThan(0);
  expect(pool[0].voiceId).toBe('Burcu');
});

it('parseGeneratedDictationDraft assigns the Turkish voice for a TR spec', () => {
  const trSpec = {
    language: Language.TR, cefrLevel: 'A1', exerciseType: ExerciseType.DICTATION,
    grammarPoint: { key: 'tr-a1-dictation', kind: 'dictation', name: 'x', description: 'x',
      cefrLevel: 'A1', language: Language.TR, examplesPositive: ['a', 'b'], examplesNegative: ['*c'], commonErrors: ['d'] },
    topicDomain: null, count: 1, batchSeed: 'test',
  } as never;
  const content = parseGeneratedDictationDraft(
    { title: 'Selam', referenceText: 'Bugün hava güzel.', sentences: ['Bugün hava güzel.'], tested: ['ünlü uyumu'], durationSec: 4 },
    trSpec,
    0,
  );
  expect(content.voiceId).toBe('Burcu');
});
```

- [ ] **Step 2: Run it — expect FAIL** (TR pool empty → first test fails; parser throws "no dictation voice pool configured for TR").

Run: `pnpm --filter @language-drill/ai test -- generate.test.ts`

- [ ] **Step 3: Add the Turkish voice**

In `packages/ai/src/generate.ts`, in `DICTATION_VOICE_POOL_BY_LANGUAGE`, replace the `[Language.TR]: []` entry (and update the comment) so TR carries Burcu; DE stays empty:

```ts
  // The only neural tr-TR Polly voice is Burcu (Filiz is standard-engine only),
  // so the TR pool is single-voice. DE added when German enters dictation scope.
  [Language.DE]: [],
  [Language.TR]: [{ voiceId: "Burcu", accent: "standart Türkçe · İstanbul" }],
```

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/ai test -- generate.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/generate.ts packages/ai/src/generate.test.ts
git commit -m "feat(ai): add Turkish dictation voice (Burcu)"
```

---

## Task 3: A1/A2 cell targets for dictation

**Files:**
- Modify: `infra/lambda/src/generation/cell-targets.ts`
- Test: `infra/lambda/src/generation/cell-targets.test.ts`

- [ ] **Step 1: Write the failing test**

In `infra/lambda/src/generation/cell-targets.test.ts` (mirror the existing B1/B2 dictation test):

```ts
import { ExerciseType } from '@language-drill/shared';
import { resolveCellTarget } from './cell-targets';

it('resolves TR dictation A1/A2 targets to 10/12', () => {
  const make = (cefrLevel: 'A1' | 'A2') => ({
    language: 'TR', cefrLevel, exerciseType: ExerciseType.DICTATION,
    grammarPoint: { key: `tr-${cefrLevel.toLowerCase()}-dictation`, kind: 'dictation' },
    cellKey: `TR:${cefrLevel}:dictation:tr-${cefrLevel.toLowerCase()}-dictation`,
  } as never);
  expect(resolveCellTarget(make('A1'))).toBe(10);
  expect(resolveCellTarget(make('A2'))).toBe(12);
});
```

- [ ] **Step 2: Run it — expect FAIL** (A1/A2 unset → falls to `TARGET_PER_CELL` 50).

Run: `pnpm --filter @language-drill/lambda test -- cell-targets.test.ts`

- [ ] **Step 3: Add the A1/A2 targets**

In `infra/lambda/src/generation/cell-targets.ts`, change the `DICTATION` line:

```ts
  // B1/B2: 15 (ES). A1/A2 (TR): lower — short clips with a smaller distinct-clip
  // surface. A1/A2 dictation is pedagogically apt only for languages whose
  // curriculum lives there (TR); tunable.
  [ExerciseType.DICTATION]: { A1: 10, A2: 12, B1: 15, B2: 15 },
```

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/lambda test -- cell-targets.test.ts`

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/generation/cell-targets.ts infra/lambda/src/generation/cell-targets.test.ts
git commit -m "feat(lambda): dictation cell targets A1=10, A2=12"
```

---

## Task 4: A1/A2 band in the dictation generation prompt

**Files:**
- Modify: `packages/ai/src/dictation-generation-prompts.ts`
- Test: `packages/ai/src/dictation-generation-prompts.test.ts`

- [ ] **Step 1: Update the failing test**

In `packages/ai/src/dictation-generation-prompts.test.ts`, add an assertion that the template covers A1/A2 (and bump any version-string assertion to the new date):

```ts
it('the generation prompt gives explicit A1 and A2 length bands', () => {
  expect(DICTATION_GENERATION_SYSTEM_PROMPT).toContain('A1');
  expect(DICTATION_GENERATION_SYSTEM_PROMPT).toContain('A2');
});

it('version is bumped to the A1/A2 edit date', () => {
  expect(DICTATION_GENERATION_PROMPT_VERSION).toBe('dictation-generate@2026-06-16');
});
```

(Keep the existing template/vars-parity test — it must still pass after the edit.)

- [ ] **Step 2: Run it — expect FAIL** (no A1/A2 bands; version still `@2026-06-15`).

Run: `pnpm --filter @language-drill/ai test -- dictation-generation-prompts.test.ts`

- [ ] **Step 3: Edit the length-for-level constraint + bump the version**

In `dictation-generation-prompts.ts`, replace the `**Length for level.**` bullet (currently `- **Length for level.** B1: 2–4 short sentences. B2: 3–5 sentences with some subordination. Keep it to one breath-group per sentence — a learner must be able to hold it in working memory.`) with:

```
- **Length for level.** A1: ONE short, clearly-articulated everyday sentence — high-frequency A1 vocabulary, simple structures, minimal connected-speech reduction (a careful near-beginner should be able to transcribe it). A2: 1–2 short sentences with everyday A2 vocabulary and only light connected speech. B1: 2–4 short sentences. B2: 3–5 sentences with some subordination. Keep it to one breath-group per sentence — a learner must be able to hold it in working memory.
```

Bump the version constant:

```ts
export const DICTATION_GENERATION_PROMPT_VERSION = "dictation-generate@2026-06-16";
```

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/ai test -- dictation-generation-prompts.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/dictation-generation-prompts.ts packages/ai/src/dictation-generation-prompts.test.ts
git commit -m "feat(ai): add A1/A2 length bands to the dictation generation prompt"
```

---

## Task 5: A1/A2 band in the dictation validation prompt

**Files:**
- Modify: `packages/ai/src/dictation-validation-prompts.ts`
- Test: `packages/ai/src/dictation-validation-prompts.test.ts`

- [ ] **Step 1: Update the failing test**

In `packages/ai/src/dictation-validation-prompts.test.ts`:

```ts
it('the validation rubric covers A1 and A2 (short clips are not "too short")', () => {
  expect(DICTATION_VALIDATION_SYSTEM_PROMPT).toContain('A1');
  expect(DICTATION_VALIDATION_SYSTEM_PROMPT).toContain('A2');
});

it('version is bumped to the A1/A2 edit date', () => {
  expect(DICTATION_VALIDATION_PROMPT_VERSION).toBe('dictation-validate@2026-06-16');
});
```

(Keep the existing template/vars-parity + "submit_validation_result"/"listenab" tests — they must still pass.)

- [ ] **Step 2: Run it — expect FAIL.**

Run: `pnpm --filter @language-drill/ai test -- dictation-validation-prompts.test.ts`

- [ ] **Step 3: Edit the length-for-level line + bump the version**

In `dictation-validation-prompts.ts`, replace the `**Length for level**` sub-bullet (currently `- **Length for level** — B1: 2–4 short sentences; B2: 3–5 with some subordination. Too long to hold in working memory, or trivially short → lower.`) with:

```
   - **Length for level** — A1: ONE short, clear sentence (a single sentence is CORRECT, not "too short"). A2: 1–2 short sentences. B1: 2–4 short sentences; B2: 3–5 with some subordination. Too long to hold in working memory → lower; but do NOT penalize an A1/A2 clip for being short or simple — at those levels clarity is the goal, not density.
```

Bump the version constant:

```ts
export const DICTATION_VALIDATION_PROMPT_VERSION = "dictation-validate@2026-06-16";
```

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/ai test -- dictation-validation-prompts.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/dictation-validation-prompts.ts packages/ai/src/dictation-validation-prompts.test.ts
git commit -m "feat(ai): A1/A2 length guidance in the dictation validation prompt"
```

---

## Task 6: Full-suite gate + manual eval:gen + rollout note

- [ ] **Step 1: Run the pre-push gate**

```bash
pnpm lint
pnpm typecheck
pnpm turbo run test --concurrency=1
```

Expected: zero failures across all packages. The manifest count test in `bootstrap-prompts.test.ts` does NOT change — the manifest references the version *constants*, which now resolve to the bumped values automatically (still 14 prompts). If a stale-dist "Cannot find module" appears, `pnpm turbo run build` then re-run.

- [ ] **Step 2 (manual, optional, costs Claude tokens — NOT a CI gate): eval:gen smoke**

Build a 2-cell dataset (TR A1 + TR A2 dictation) and run `pnpm eval:gen` (repo arm) to confirm A1 clips generate short and auto-approve rather than getting rejected as too-short, and A2 clips fit the band. Per CLAUDE.md `eval:gen` usage. This is a pre-merge confidence check; skip if not exercising real generation locally.

- [ ] **Step 3: Document the post-merge prompt sync in the PR description**

Both dictation prompts were edited (generation + validation), so after merge run `pnpm push-prompts` to sync prod + dev Langfuse (per CLAUDE.md "Prompt Editing"), then `bootstrap-prompts --check` (exit 0). Until the push, the runtime serves the updated in-repo fallback (correct). The ~04:00 UTC scheduler then fills `tr:a1:dictation` + `tr:a2:dictation`; the audio Lambda synthesizes each approved clip via Burcu (`tr-TR`, neural). Watch `generation_jobs` rejection-reason counts for the two TR cells; if A1 over-rejects, tune the prompt/targets.

- [ ] **Step 4: Commit any gate fixes** (only if needed)

```bash
git add -A
git commit -m "chore(dictation-tr): fix full-suite gate issues"
```

---

## Self-review

- **Spec coverage:** §1 curriculum umbrellas + version bump → Task 1; voice pool → Task 2; cell targets → Task 3. §2 generation-prompt A1/A2 band → Task 4; validation-prompt A1/A2 band → Task 5. §3 testing + eval:gen + push-prompts rollout → Tasks 1–6.
- **No DB migration / infra / env change** — curriculum data, a voice-pool constant, a targets map, and two prompt-body edits only.
- **Type consistency:** `tr-a1-dictation`/`tr-a2-dictation` keys used identically across Tasks 1 + 2 + 3 tests; voice id `Burcu` in Task 2 prod + test; targets A1=10/A2=12 in Task 3 prod + test; version strings `dictation-generate@2026-06-16` / `dictation-validate@2026-06-16` set in the same commit as each prompt-body edit (Tasks 4, 5) — matching CLAUDE.md's prompt-version rule.
- **Prompt edits are body-only (no new `{{vars}}`)** so the existing template/vars-parity tests still hold; the manifest entries reference the version constants, so no manifest/count-test change.
