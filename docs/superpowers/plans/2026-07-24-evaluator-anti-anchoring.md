# Evaluator Anti-Anchoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the answer evaluator from marking a learner's valid cloze/vocab answer wrong by anchoring on the stored reference and inventing unstated context — by telling it what the learner actually saw and to judge against that.

**Architecture:** Append an information-asymmetry + anti-anchoring block to the `buildClozeUserPrompt` and `buildVocabRecallUserPrompt` user-prompt builders (translation already has one). User-builder-only edit: the cached `EVALUATION_SYSTEM_PROMPT` is untouched, so it ships with the code deploy and needs NO Langfuse push. Verified by running crafted cases through the real `evaluateAnswer`.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces (`@language-drill/ai`), Anthropic Claude.

## Global Constraints

- Prompt-editing protocol (CLAUDE.md): a semantic edit near `EVALUATION_SYSTEM_PROMPT` REQUIRES bumping `EVALUATION_SYSTEM_PROMPT_VERSION` to `evaluate@YYYY-MM-DD` (today = 2026-07-24) in the same commit.
- This is a **user-builder-only** edit — the cached system template string is unchanged, so it ships with the code deploy and needs **NO** `push-prompts`/Langfuse sync. The version bump only cohorts traces.
- `packages/ai` MUST NOT import `@language-drill/db`.
- Over-correction risk here is over-*accepting* (marking a genuinely-wrong answer correct). The rule's guard is "valid given ONLY the visible sentence, and among the Options when options are shown."
- Pre-push gate (repo root): `pnpm lint && pnpm typecheck && pnpm test`, zero failures.

---

### Task 1: Anti-anchoring blocks + version bump + tests

**Files:**
- Modify: `packages/ai/src/prompts.ts` (`buildClozeUserPrompt` ~line 141; `buildVocabRecallUserPrompt` ~line 187; version at line 59)
- Test: `packages/ai/src/prompts.test.ts`

**Interfaces:**
- Consumes: nothing (self-contained prompt strings).
- Produces: `EVALUATION_SYSTEM_PROMPT_VERSION === "evaluate@2026-07-24"`; pinned phrases in the built prompts — cloze: `Judge the user's answer as a response to what they actually saw` and `both the present "deja"`; vocab: `judge it on whether it satisfies what the learner saw`.

- [ ] **Step 1: Write the failing tests first**

In `packages/ai/src/prompts.test.ts`: update the version assertion at line 29 from `"evaluate@2026-07-18"` to `"evaluate@2026-07-24"`. Then add a new `describe` block (fixtures follow the existing `buildUserPrompt(exercise, answer, lang, cefr)` pattern):

```ts
import type { ClozeContent, VocabRecallContent } from "@language-drill/shared";

describe("anti-anchoring blocks", () => {
  const cloze: ClozeContent = {
    type: ExerciseType.CLOZE,
    instructions: "Fill in the blank.",
    sentence: "El portero no ___ entrar al edificio sin identificación.",
    correctAnswer: "dejó",
  };
  const vocab: VocabRecallContent = {
    type: ExerciseType.VOCAB_RECALL,
    instructions: "Recall the word.",
    prompt: "the person who guards a door",
    expectedWord: "portero",
    hints: ["works at an entrance"],
    exampleSentence: "El ___ abrió la puerta.",
  };

  it("cloze prompt states what the learner saw and forbids inventing context", () => {
    const out = buildUserPrompt(cloze as any, "deja", "ES" as any, "B1" as any);
    expect(out).toContain("Judge the user's answer as a response to what they actually saw");
    expect(out).toContain('both the present "deja"');
    expect(out).toMatch(/Do NOT invent unstated context/);
  });

  it("vocab_recall prompt judges a valid synonym on the visible prompt, not the reference", () => {
    const out = buildUserPrompt(vocab as any, "guardia", "ES" as any, "B1" as any);
    expect(out).toContain("judge it on whether it satisfies what the learner saw");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/ai test -- prompts`
Expected: FAIL — version assertion (`evaluate@2026-07-18` ≠ `-24`) and the two new `toContain`/`toMatch` phrases (not yet in the builders).

- [ ] **Step 3: Append the cloze anti-anchoring block**

In `packages/ai/src/prompts.ts`, in `buildClozeUserPrompt`, the return string currently ends with:

```
Evaluate the user's answer. If it matches **Correct Answer** or any entry in **Acceptable Answers**, score 1.0 with no errors. Otherwise consider whether it is still grammatically and semantically valid in the sentence and award partial or full credit as appropriate.`;
```

Append one blank line then this paragraph, immediately before the closing `` `; ``:

```

The learner saw ONLY the **Sentence** (with the blank), the **Instructions**, and the **Options** if listed — NOT the **Correct Answer**, **Acceptable Answers**, or **Context**. Judge the user's answer as a response to what they actually saw. **Correct Answer** / **Acceptable Answers** are the intended fill and your reference, but not the only admissible answer: if the user's answer is grammatically and semantically valid in the visible sentence — and among the **Options** when options are shown — it is fully correct (score 1.0, no error), even when it differs from **Correct Answer**. Do NOT invent unstated context — a specific time, past event, place, or referent that is not present in the visible sentence — to justify marking a valid answer wrong. When the visible sentence does not itself fix the tense/aspect/number, any form the sentence licenses is correct: e.g. for "El portero no ___ entrar al edificio sin identificación" both the present "deja" (a standing rule) and the preterite "dejó" are correct, because nothing in the sentence forces one tense.
```

- [ ] **Step 4: Append the vocab_recall anti-anchoring block**

In `buildVocabRecallUserPrompt`, the return string currently ends with:

```
Evaluate the user's answer. If it matches **Expected Word** or any entry in **Acceptable Answers**, it is fully correct. Otherwise check whether it is a valid synonym used appropriately. Consider spelling accuracy.`;
```

Append one blank line then this paragraph, immediately before the closing `` `; ``:

```

The learner saw ONLY the **Prompt** and **Hints** — NOT the **Expected Word** or **Acceptable Answers**. A word the learner produces that genuinely fits the prompt/definition and is used appropriately is fully correct even if it is not the **Expected Word** and not listed in **Acceptable Answers**; judge it on whether it satisfies what the learner saw, not on whether it matches the reference. Do NOT mark a valid synonym wrong merely for differing from the **Expected Word**.
```

- [ ] **Step 5: Bump `EVALUATION_SYSTEM_PROMPT_VERSION`**

In `packages/ai/src/prompts.ts` line 59, change to:

```ts
export const EVALUATION_SYSTEM_PROMPT_VERSION = "evaluate@2026-07-24";
```

Add a dated comment above it in the existing version-history comment block (before line 59):

```ts
// 2026-07-24: cloze + vocab_recall USER prompts gained an information-asymmetry /
// anti-anchoring block (the learner never saw Correct Answer / Acceptable Answers /
// Context; judge the answer on the visible prompt, do not invent context to defend
// the reference). USER-prompt-only edit — cached system template unchanged, ships
// with the code deploy, NO Langfuse push; version bumped only to cohort traces.
```

- [ ] **Step 6: Run the prompts test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- prompts`
Expected: PASS.

- [ ] **Step 7: Full pre-push gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures. (A pre-existing `apps/web` `topic-switcher-sheet.test.tsx` / other web timeout flake under parallel load is the ONLY acceptable failure — confirm via an isolated `pnpm --filter @language-drill/web test` re-run; this branch touches no web code. If `@language-drill/ai` fails on stale `db/dist`, run `pnpm build` first.)

- [ ] **Step 8: Commit**

```bash
test "$(git rev-parse --abbrev-ref HEAD)" = "fix/evaluator-anti-anchoring" || { echo "WRONG BRANCH"; exit 1; }
git add packages/ai/src/prompts.ts packages/ai/src/prompts.test.ts
git commit -m "fix(evaluate): anti-anchoring for cloze + vocab_recall

Tell the evaluator what the learner actually saw (not Correct Answer /
Acceptable Answers / Context) and to judge the answer on the visible prompt,
never inventing unstated context to defend the reference. Mirrors the existing
translation anti-anchoring block. Fixes the reported tense false-negative where
a valid present answer was marked wrong on a fabricated 'specific past event'.
User-builder-only; ships with code deploy, no Langfuse push.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Verify direction + no over-accept (pre-merge gate, scratch harness ~$0.15)

**Files:**
- Create (temporary, delete after): `packages/ai/scripts/_tmp-eval-antianchor.ts`
- No source changes.

**Interfaces:**
- Consumes: the edited builders from Task 1 (in-repo). Uses `evaluateAnswer` + `createClaudeClient` from `@language-drill/ai`, `ANTHROPIC_API_KEY` from env. No Langfuse creds needed (the change is in the user builder; the system prompt resolves via in-repo fallback).
- Produces: a printed pass/fail table; evidence for the PR.

- [ ] **Step 1: Write the harness**

Create `packages/ai/scripts/_tmp-eval-antianchor.ts` that builds a small `EvaluateAnswerInput` per case and calls `evaluateAnswer(client, input)`, printing `score` and whether it met expectation. Cases:

- Flip-to-correct (expect `score === 1.0`, no error):
  - CLOZE sentence `El portero no ___ entrar al edificio sin identificación.`, correctAnswer `dejó`, user `deja`.
  - CLOZE sentence `Los celos le ___ actuar de una manera muy extraña.`, correctAnswer `hicieron`, user `hacen`.
  - VOCAB_RECALL prompt `the person who guards a door / lets people in`, expectedWord `portero`, user `guardia`.
- Must-stay-wrong (expect `score < 1.0` or a recorded error):
  - CLOZE sentence `Cuando llegué tarde a la reunión, mi jefe no me ___ disculparme ante el cliente.`, correctAnswer `dejó`, user `deja` (in-stem `llegué` forces past → present is wrong).
  - CLOZE sentence `El portero no ___ entrar al edificio sin identificación.`, correctAnswer `dejó`, user `comer` (semantically invalid).
  - CLOZE with `options: ["dejó","dejó a","permitió a","dejó que entraba"]`, user `dejó a` (ungrammatical distractor).
  - VOCAB_RECALL prompt `the person who guards a door`, expectedWord `portero`, user `mesa` (outside the definition).

Use the same `EvaluateAnswerInput` shape as `packages/ai/src/evaluate.test.ts` (read it for the exact fixture fields: `exercise`, `userAnswer`, `language`, `difficulty`).

- [ ] **Step 2: Run the harness**

Run (from repo root, loading `.env` for `ANTHROPIC_API_KEY`):
```bash
dotenv -e .env -- npx tsx packages/ai/scripts/_tmp-eval-antianchor.ts
```
(If `dotenv` is not directly invokable, source the key inline: `ANTHROPIC_API_KEY=$(grep -E '^ANTHROPIC_API_KEY=' .env | cut -d= -f2-) npx tsx packages/ai/scripts/_tmp-eval-antianchor.ts`.)
Expected: every flip-to-correct case scores 1.0 with no error; every must-stay-wrong case scores < 1.0 or records an error.

- [ ] **Step 3: Assess**

If all cases meet expectation → verification passes; capture the table for the PR description. If a must-stay-wrong case flipped to 1.0, the rule over-accepts — return to Task 1, tighten the "valid given ONLY the visible sentence / among the Options" guard, re-run. If a flip-to-correct case stayed wrong, the rule is too weak — strengthen it and re-run.

- [ ] **Step 4: Delete the harness**

```bash
rm -f packages/ai/scripts/_tmp-eval-antianchor.ts
git status --short   # confirm no _tmp file lingers
```

---

## Self-Review

**Spec coverage:** Rule text (cloze + vocab) → Task 1 Steps 3-4. Placement in the two user builders → Steps 3-4. Version bump + dated comment → Step 5. No Langfuse push (user-builder-only) → Global Constraints + Step 5 comment. Tests → Steps 1+6. Verification with both directions (flip-to-correct + must-stay-wrong controls) → Task 2. `context` field left as-is → not touched (no step edits it). Over-accept guard → Global Constraints + Task 2 Step 3. All spec sections covered.

**Placeholder scan:** No TBD/TODO. Exact rule text, exact version string, exact anchors ("Evaluate the user's answer…" tail of each builder), exact commit. Task 2 Step 1 points at `evaluate.test.ts` for the fixture shape rather than inventing field names — a concrete reference, not a placeholder.

**Type consistency:** Version string `evaluate@2026-07-24` consistent across Steps 1, 5, and the Interfaces block. Pinned test phrases (`Judge the user's answer as a response to what they actually saw`, `both the present "deja"`, `judge it on whether it satisfies what the learner saw`) match the inserted rule text verbatim. Branch `fix/evaluator-anti-anchoring` consistent.
