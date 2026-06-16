# Dictation Generation Diversity (TR A1/A2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop TR A1/A2 dictation from mode-collapsing (one scene → dedup give-ups) by giving each draft a distinct topic domain, and set reachable A1/A2 targets so the pool fills instead of grinding dedup.

**Architecture:** A per-ordinal domain rotation computed in the dictation **user** prompt (not the Langfuse-registered system prompt → no version bump, no prompt sync), mirroring `sentenceConstructionModeForOrdinal`. Plus a one-line `CELL_TARGET_DEFAULTS[DICTATION]` change (A1: 6, A2: 10) and a `CURRICULUM_VERSION_TR` bump to un-suppress the cell the failed run left saturated-dedup-suppressed.

**Tech Stack:** TypeScript, pnpm + Turborepo, Vitest. `packages/ai` (prompt builder), `infra/lambda` (cell targets), `packages/db` (curriculum version).

**Spec:** [`../specs/2026-06-16-dictation-generation-diversity-design.md`](../specs/2026-06-16-dictation-generation-diversity-design.md)

**Conventions:** Work in the worktree `/Users/seal/dev/language-drill/.claude/worktrees/feat-dictation-diversity` (run all commands from there). Real gate is `pnpm turbo run test --concurrency=1`. The dictation **user** prompt is built locally per-draft (NOT Langfuse-registered) — editing it needs **no** `*_PROMPT_VERSION` bump and **no** `push-prompts`, exactly like `seedWord`/`sentenceConstructionModeForOrdinal`. No DB/infra/migration change.

---

## Task 1: Per-ordinal domain rotation in the dictation user prompt

**Files:**
- Modify: `packages/ai/src/dictation-generation-prompts.ts`
- Modify: `packages/ai/src/generate.ts` (the `isDictation` branch of `generateOneDraft`)
- Test: `packages/ai/src/dictation-generation-prompts.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/ai/src/dictation-generation-prompts.test.ts`:

```ts
import {
  DICTATION_DOMAINS,
  dictationDomainForOrdinal,
  buildDictationGenerationUserPrompt,
} from './dictation-generation-prompts';
import { ExerciseType, Language } from '@language-drill/shared';

const inputs = {
  language: Language.TR, cefrLevel: 'A1', exerciseType: ExerciseType.DICTATION,
  grammarPoint: { key: 'tr-a1-dictation', kind: 'dictation', name: 'x', description: 'x',
    cefrLevel: 'A1', language: Language.TR, examplesPositive: ['a', 'b'], examplesNegative: ['*c'], commonErrors: ['d'] },
} as never;

it('rotates to a distinct domain on consecutive ordinals', () => {
  const seed = 'batch-1';
  expect(dictationDomainForOrdinal(0, seed)).not.toBe(dictationDomainForOrdinal(1, seed));
  // The first full cycle is all-distinct (one domain per ordinal).
  const cycle = Array.from({ length: DICTATION_DOMAINS.length }, (_, i) => dictationDomainForOrdinal(i, seed));
  expect(new Set(cycle).size).toBe(DICTATION_DOMAINS.length);
});

it('shifts the starting domain with the batch seed (cross-tick variety)', () => {
  const a = dictationDomainForOrdinal(0, 'scheduled-2026-06-17');
  const b = dictationDomainForOrdinal(0, 'scheduled-2026-06-18');
  expect(a).not.toBe(b);
});

it('user prompt pins a per-ordinal domain when topicDomain is null', () => {
  const p0 = buildDictationGenerationUserPrompt(inputs, 0, null, 'batch-1');
  const p1 = buildDictationGenerationUserPrompt(inputs, 1, null, 'batch-1');
  expect(p0).toContain(`Topic domain: ${dictationDomainForOrdinal(0, 'batch-1')}`);
  expect(p1).toContain(`Topic domain: ${dictationDomainForOrdinal(1, 'batch-1')}`);
  expect(p0).not.toBe(p1);
  expect(p0).toContain('submit_dictation_exercise');
});

it('an explicit topicDomain overrides the rotation for all ordinals', () => {
  const p0 = buildDictationGenerationUserPrompt(inputs, 0, 'travel', 'batch-1');
  const p1 = buildDictationGenerationUserPrompt(inputs, 1, 'travel', 'batch-1');
  expect(p0).toContain('Topic domain: travel');
  expect(p1).toContain('Topic domain: travel');
});
```

- [ ] **Step 2: Run them — expect FAIL** (`DICTATION_DOMAINS`/`dictationDomainForOrdinal` undefined; builder has a 3-arg signature).

Run: `pnpm --filter @language-drill/ai test -- dictation-generation-prompts.test.ts`

- [ ] **Step 3: Add the domain rotation + update the builder**

In `packages/ai/src/dictation-generation-prompts.ts`, add near the top (after the imports / `renderBulletList`):

```ts
/**
 * Curated everyday topic domains for dictation clips. A1-expressible (a learner
 * can hear a simple sentence on any of these). The generator gets a DISTINCT
 * domain per ordinal (see `dictationDomainForOrdinal`) so a batch spreads across
 * topics instead of collapsing on one scene — the dedup index (`_dedupKey` =
 * normalized referenceText) otherwise rejects the near-duplicates, starving the
 * pool at A1/A2 where the per-domain sentence space is small.
 */
export const DICTATION_DOMAINS: readonly string[] = [
  "home and family",
  "food and meals",
  "daily routine",
  "weather and seasons",
  "school and study",
  "shopping and the market",
  "free time and the weekend",
  "work and jobs",
  "travel and transport",
  "health and the body",
];

/**
 * Distinct topic domain for a draft. Rotates `DICTATION_DOMAINS` by `ordinal`,
 * offset by a deterministic hash of `batchSeed` so different batches (ticks)
 * start at a different domain — giving both in-batch spread and cross-tick
 * variety without any cross-batch DB lookup. Pure; mirrors
 * `sentenceConstructionModeForOrdinal`.
 */
export function dictationDomainForOrdinal(
  ordinal: number,
  batchSeed: string,
): string {
  let offset = 0;
  for (let i = 0; i < batchSeed.length; i++) {
    offset = (offset + batchSeed.charCodeAt(i)) % DICTATION_DOMAINS.length;
  }
  return DICTATION_DOMAINS[(ordinal + offset) % DICTATION_DOMAINS.length];
}
```

Replace `buildDictationGenerationUserPrompt` (it currently takes `(inputs, ordinal, topicDomain)` and tells the model to "vary the domain", which now fights the per-ordinal pinning):

```ts
export function buildDictationGenerationUserPrompt(
  inputs: GenerationPromptInputs,
  ordinal: number,
  topicDomain: string | null,
  batchSeed: string,
): string {
  // A caller-supplied topicDomain (CLI passthrough) pins all ordinals to one
  // domain; scheduled runs (null) get a distinct domain per ordinal so the batch
  // spreads across topics.
  const domain = topicDomain ?? dictationDomainForOrdinal(ordinal, batchSeed);
  return `Produce dictation clip #${ordinal + 1}.

Topic domain: ${domain}

Build the clip around this topic domain; vary the specific scene, sentence shapes, and vocabulary so it does not resemble other clips. Use the submit_dictation_exercise tool.`;
}
```

In `packages/ai/src/generate.ts`, the `isDictation` branch of `generateOneDraft` currently calls `buildDictationGenerationUserPrompt(promptInputs, ordinal, spec.topicDomain)`. Add `spec.batchSeed`:

```ts
  const userText = isDictation
    ? buildDictationGenerationUserPrompt(promptInputs, ordinal, spec.topicDomain, spec.batchSeed)
    : isFreeWriting
      ? buildFreeWritingGenerationUserPrompt(promptInputs, ordinal)
      : buildGenerationUserPrompt(
          promptInputs,
          ordinal,
          spec.topicDomain,
          spec.seedWords?.[ordinal] ?? null,
          spec.coverageTargets,
        );
```

(`spec.batchSeed` is a required `GenerationSpec` field, always set.)

- [ ] **Step 4: Run them — expect PASS.** `pnpm --filter @language-drill/ai test -- dictation-generation-prompts.test.ts`

- [ ] **Step 5: Typecheck + lint** — `pnpm --filter @language-drill/ai typecheck && pnpm --filter @language-drill/ai lint`. (No `*_PROMPT_VERSION` bump — the system prompt is unchanged.)

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/dictation-generation-prompts.ts packages/ai/src/generate.ts packages/ai/src/dictation-generation-prompts.test.ts
git commit -m "feat(ai): per-ordinal topic-domain rotation for dictation generation"
```

---

## Task 2: Reachable A1/A2 dictation targets

**Files:**
- Modify: `infra/lambda/src/generation/cell-targets.ts`
- Test: `infra/lambda/src/generation/cell-targets.test.ts`

- [ ] **Step 1: Update the failing test**

In `infra/lambda/src/generation/cell-targets.test.ts`, change the TR A1/A2 dictation assertion (currently expects 10/12) to 6/10:

```ts
it('resolves TR dictation A1/A2 targets to 6/10 (reachable with domain rotation)', () => {
  const make = (cefrLevel: 'A1' | 'A2') => ({
    language: 'TR', cefrLevel, exerciseType: ExerciseType.DICTATION,
    grammarPoint: { key: `tr-${cefrLevel.toLowerCase()}-dictation`, kind: 'dictation' },
    cellKey: `TR:${cefrLevel}:dictation:tr-${cefrLevel.toLowerCase()}-dictation`,
  } as never);
  expect(resolveCellTarget(make('A1'))).toBe(6);
  expect(resolveCellTarget(make('A2'))).toBe(10);
});
```

(Keep the existing dictation B1/B2 → 15 test.)

- [ ] **Step 2: Run it — expect FAIL** (still 10/12).

Run: `pnpm --filter @language-drill/lambda test -- cell-targets.test.ts`

- [ ] **Step 3: Lower the A1/A2 defaults**

In `infra/lambda/src/generation/cell-targets.ts`, change the `DICTATION` line and its comment:

```ts
  // B1/B2: 15. A1/A2: 6/10 — the distinct-clip surface is small at low levels
  // (short clips), so a high target just grinds the dedup index; the per-ordinal
  // domain rotation (dictation-generation-prompts.ts) makes these reachable.
  [ExerciseType.DICTATION]: { A1: 6, A2: 10, B1: 15, B2: 15 },
```

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/lambda test -- cell-targets.test.ts`

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/generation/cell-targets.ts infra/lambda/src/generation/cell-targets.test.ts
git commit -m "feat(lambda): lower A1/A2 dictation targets to 6/10"
```

---

## Task 3: Bump `CURRICULUM_VERSION_TR` to un-suppress the A1 cell

**Files:**
- Modify: `packages/db/src/curriculum/tr.ts`
- Test: `packages/db/src/curriculum/curriculum.test.ts` (existing version-format test must stay green)

- [ ] **Step 1: Bump the version**

In `packages/db/src/curriculum/tr.ts`, change `export const CURRICULUM_VERSION_TR = '2026-06-16';` to:

```ts
export const CURRICULUM_VERSION_TR = '2026-06-16b';
```

Add a one-line note to its doc-comment, e.g.: `// 2026-06-16b: clears the saturated-dedup suppression on tr-a1-dictation after the` `// generation-diversity fix (domain rotation + lower targets); curriculum entries unchanged.`

(The format regex `/^\d{4}-\d{2}-\d{2}[a-z]?$/` in `curriculum.test.ts:374-376` admits the `b` suffix — ES already ships `'2026-06-15b'`. The TR curriculum entries do not change; the bump exists only so `decideEnqueue` clears the suppression the 2026-06-16 run set on `tr-a1-dictation`.)

- [ ] **Step 2: Run the version-format + curriculum tests — expect PASS.**

Run: `pnpm --filter @language-drill/db test -- curriculum.test.ts`
Expected: PASS (the `CURRICULUM_VERSION_<LANG> constants` describe block matches `'2026-06-16b'`).

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/curriculum/tr.ts
git commit -m "chore(db): bump CURRICULUM_VERSION_TR to clear tr-a1-dictation suppression"
```

---

## Task 4: Full-suite gate + rollout note

- [ ] **Step 1: Run the pre-push gate**

```bash
pnpm lint
pnpm typecheck
pnpm turbo run test --concurrency=1
```

Expected: zero failures across all packages. No prompt-manifest / bootstrap-prompts change is involved (the system prompts are untouched; the rotation lives in the user prompt). If a stale-dist "Cannot find module '@language-drill/...'" appears, `pnpm turbo run build` then re-run.

- [ ] **Step 2: Document the rollout + verification in the PR description**

No DB migration, no infra change, **no `push-prompts`** (user-prompt-only edit). After merge + CDK deploy, the next 04:00 UTC scheduler tick — un-suppressed by the `CURRICULUM_VERSION_TR` bump — refills `tr:a1:dictation` + `tr:a2:dictation`. Verify in `generation_jobs` (prod Neon branch `br-green-waterfall-ancrvpr5`, project `twilight-smoke-01114337`): expect `dedup_given_up` to drop sharply and `approved` to reach 6 (A1) / 10 (A2) at much lower `produced_count` and cost than the 2026-06-16 run (TR A1 was 28 produced → 1 approved). `eval:gen` cannot validate this (it does not dedup against the pool), so the scheduler run is the proof; a manual scheduler invoke can confirm sooner.

- [ ] **Step 3: Commit any gate fixes** (only if needed)

```bash
git add -A
git commit -m "chore(dictation-diversity): fix full-suite gate issues"
```

---

## Self-review

- **Spec coverage:** §1 domain rotation → Task 1 (DICTATION_DOMAINS + dictationDomainForOrdinal + builder signature + generateOneDraft call site); §2 targets → Task 2, version bump → Task 3; §3 tests + rollout → Tasks 1–4.
- **No system-prompt edit / no version bump / no push-prompts** — the rotation is in the per-draft user prompt (verified: only `DICTATION_GENERATION_SYSTEM_PROMPT` is Langfuse-registered; the user-prompt builder is local).
- **Type consistency:** `dictationDomainForOrdinal(ordinal, batchSeed)` and `DICTATION_DOMAINS` used identically across Task 1 prod + test; `buildDictationGenerationUserPrompt(inputs, ordinal, topicDomain, batchSeed)` 4-arg signature matches the `generateOneDraft` call site; targets A1:6/A2:10 in Task 2 prod + test; `CURRICULUM_VERSION_TR = '2026-06-16b'` matches the `[a-z]?` regex.
- **No DB/infra/migration change.** Tasks 2 + 3 are config + a version constant.
