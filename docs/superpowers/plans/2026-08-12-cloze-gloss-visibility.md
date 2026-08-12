# Cloze `glossEn` Blind Spot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a cloze exercise's `glossEn` visible to the two prompts that need it — the evaluator (so a grammatical answer contradicting the gloss stops scoring 1.0) and the validator (so it can reject a row whose `acceptableAnswers` contradict its own gloss) — then repair the 20 contradictory rows already in the pool.

**Architecture:** One missing field, three call sites. `glossEn` is written by the generator, rendered to the learner at `apps/web/components/drill/cloze-prompt.tsx:112`, and rendered by neither `buildClozeUserPrompt` (`packages/ai/src/prompts.ts`) nor `buildClozeValidationUserPrompt` (`packages/ai/src/validation-prompts.ts`). Tasks 1–2 add the render to both user prompts (ships with the code deploy, **no Langfuse push**). Task 3 adds the enforcing rule to `VALIDATION_SYSTEM_PROMPT_TEMPLATE` (the cached template — **needs a push**, Task 8). Tasks 4–5 verify each half against the live API before anything ships. Task 9 repairs prod rows with targeted `jsonb_set` writes, never a demotion.

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Vitest, Anthropic SDK, Langfuse (prompt registry + datasets), Neon Postgres via Neon MCP, `packages/ai` author-run CLIs (`eval:seed`, `eval`, `qa:sample`, `push-prompts`, `bootstrap-prompts`).

**Spec:** `docs/superpowers/specs/2026-08-12-cloze-gloss-visibility-design.md` — read its appendix before Task 9; it carries the per-row verdict for all 39 audited rows.

## Global Constraints

- **Workspace:** all work happens in the worktree `/Users/seal/dev/language-drill/.claude/worktrees/cloze-gloss-visibility` on branch `fix/cloze-gloss-visibility`. Assert the branch before every commit: `test "$(git branch --show-current)" = "fix/cloze-gloss-visibility" || exit 1`. Never edit a `/Users/seal/dev/language-drill/<path>` that is not under the worktree — those write to the MAIN checkout.
- **Exact label string** for both renders, byte-identical: `**Meaning (shown to the learner):** ` followed by the gloss. Render the line **only** when `content.glossEn` is a non-empty string.
- **`pnpm <script> -- --flag` is broken for every `packages/ai` CLI.** Pass flags with no `--` separator.
- **Version bumps, in the same commit as the prompt edit:** `EVALUATION_SYSTEM_PROMPT_VERSION` → `"evaluate@2026-08-12"` (Task 1); `VALIDATION_PROMPT_VERSION` → `"validate@2026-08-12"` (Task 2, comment extended in Task 3).
- **Push classification — do not confuse these.** `buildClozeUserPrompt` and `buildClozeValidationUserPrompt` are **user** prompts: they ship with the code deploy and need **no** Langfuse push (same class as #612/#620). `VALIDATION_SYSTEM_PROMPT_TEMPLATE` is the **cached template**: Task 3's edit is inert in production until Task 8 pushes it.
- **Prod DB:** project `twilight-smoke-01114337`, branch `br-green-waterfall-ancrvpr5`. The worktree `.env` `DATABASE_URL` points at the **dev** branch.
- **Credentials are never inlined into a Bash command** (the classifier blocks it). Write them to a scratchpad env file, invoke via `pnpm exec dotenv -e <file> --`, delete the file after. Never `cat`/`echo`/`grep` the file's contents.
- **Every live-API run is backgrounded** (`run_in_background: true`) and carries a cost cap where the CLI supports one.
- **No `demote:pool` and no `backfill:mastery` anywhere in this plan.** Task 9 is a content repair; `review_status`, `demotion_reason`, mastery and history stay untouched.
- **Pre-push gate:** `pnpm lint && pnpm typecheck && pnpm test` from the worktree root, zero failures. If CDK synth tests fail with exit 254, symlink `esbuild` into root `node_modules`. If `infra/lambda/dist/**/*.test.js` produces phantom failures, `rm -rf infra/lambda/dist`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/ai/src/prompts.ts` (modify: `buildClozeUserPrompt`, lines ~134-178; `EVALUATION_SYSTEM_PROMPT_VERSION`, line ~76) | Render the gloss to the evaluator; make it binding; version bump + dated comment. |
| `packages/ai/src/prompts.test.ts` (modify: add a describe block after `cloze options visibility`, which ends ~line 175) | Pin the render, the omission when absent, and the binding clause. |
| `packages/ai/src/validation-prompts.ts` (modify: `buildClozeValidationUserPrompt` ~line 350; `VALIDATION_SYSTEM_PROMPT_TEMPLATE` `ambiguous` block, line ~153; `VALIDATION_PROMPT_VERSION`, line 112) | Render the gloss to the validator; add the gloss-consistency rule; version bump. |
| `packages/ai/src/validation-prompts.test.ts` (modify: add describe blocks; byte-parity block is at ~line 315) | Pin the validator render and the new rule text. |
| `packages/ai/scripts/fixtures/eval-cloze-gloss-binding.json` (create) | Two real prod rows as eval items, each with its observed pre-fix baseline. |
| `packages/ai/scripts/eval-seed.test.ts` (modify: append a describe after the `eval-obligatory-determiners` / `eval-hard-morphology` blocks) | Assert the new fixture parses and covers its two cases. |
| `docs/analysis/cloze-gloss-visibility-verification-2026-08-12.md` (create) | The evidence record: eval A/B, validator probe, prod repair, post-fix replay. |

---

### Task 1: Render the gloss to the evaluator, and make it binding

**Files:**
- Modify: `packages/ai/src/prompts.ts`
- Test: `packages/ai/src/prompts.test.ts`

**Interfaces:**
- Consumes: `ClozeContent.glossEn?: string` (already on the type, `packages/shared/src/index.ts:116`). No signature change — `buildClozeUserPrompt(content, userAnswer, language, difficulty, optionsRevealed)` keeps its five parameters, and `buildUserPrompt`'s `visibility?: { optionsRevealed?: boolean }` is untouched.
- Produces: the exact string `**Meaning (shown to the learner):**` in the cloze user prompt, asserted by Tasks 4 and 9.

- [ ] **Step 1: Write the failing tests**

Append to `packages/ai/src/prompts.test.ts`, after the `describe("cloze options visibility", …)` block:

```ts
// A cloze may carry `glossEn` — an English gloss of the sentence's meaning that
// the generator is told to add at A1/A2 as a disambiguation device, and that the
// UI shows the learner (apps/web/components/drill/cloze-prompt.tsx). It was
// rendered to NOBODY downstream, so the evaluator judged a person/tense/referent
// choice the gloss had already fixed, and #612's "any form the sentence licenses
// is correct" rule made that a full-credit answer.
describe("cloze meaning gloss", () => {
  const glossed: ClozeContent = {
    type: ExerciseType.CLOZE,
    instructions: "Fill in the blank with the correct form of the verb.",
    sentence: "No ___ comer la sopa sin sal.",
    correctAnswer: "puedo",
    glossEn: "I can't eat the soup without salt.",
  };

  it("renders the gloss and labels it as learner-visible", () => {
    const out = buildUserPrompt(glossed as any, "puedes", "ES" as any, "A1" as any);
    expect(out).toContain(
      "**Meaning (shown to the learner):** I can't eat the soup without salt.",
    );
  });

  it("names the Meaning line in the visibility clause and makes it binding", () => {
    const out = buildUserPrompt(glossed as any, "puedes", "ES" as any, "A1" as any);
    expect(out).toContain("the **Meaning** line");
    expect(out).toMatch(/contradicts the stated meaning is NOT correct/);
  });

  it("omits the Meaning line and its binding clause for an unglossed cloze", () => {
    const bare: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "Fill in the blank.",
      sentence: "El portero no ___ entrar.",
      correctAnswer: "dejó",
    };
    const out = buildUserPrompt(bare as any, "deja", "ES" as any, "B1" as any);
    expect(out).not.toContain("**Meaning");
    expect(out).not.toContain("contradicts the stated meaning");
  });

  it("treats an empty-string gloss as absent", () => {
    const out = buildUserPrompt(
      { ...glossed, glossEn: "" } as any,
      "puedes",
      "ES" as any,
      "A1" as any,
    );
    expect(out).not.toContain("**Meaning");
  });

  it("keeps the #612 tense-licensing example for an unglossed cloze", () => {
    const bare: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "Fill in the blank.",
      sentence: "El portero no ___ entrar al edificio sin identificación.",
      correctAnswer: "dejó",
    };
    const out = buildUserPrompt(bare as any, "deja", "ES" as any, "B1" as any);
    expect(out).toContain('both the present "deja"');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/cloze-gloss-visibility
pnpm --filter @language-drill/ai test prompts
```

Expected: the first two and the binding assertions FAIL (no `**Meaning`, no binding clause). The "omits…", "empty-string", and "#612 example" tests PASS already — they are regression guards.

- [ ] **Step 3: Render the gloss**

In `buildClozeUserPrompt`, add above the `showOptions` const:

```ts
  // `glossEn` is an English gloss of the sentence's meaning. The generator adds
  // it at A1/A2 to pin a reading a short L2 sentence cannot force, and the UI
  // shows it to the learner — so it is part of what they saw and it constrains
  // the answer. It was previously rendered to neither this prompt nor the
  // validator's, which is how a row glossed "I can't…" came to accept "quiero".
  const gloss =
    typeof content.glossEn === "string" && content.glossEn.length > 0
      ? content.glossEn
      : undefined;
```

Then in the returned template literal, insert this line immediately after the `**Sentence:**` line:

```ts
${gloss ? `**Meaning (shown to the learner):** ${gloss}` : ""}
```

- [ ] **Step 4: Make it binding in the visibility and admissibility clauses**

Replace the two-branch `visibilityClause` with a form that includes the gloss. Keep both existing branches' wording byte-identical apart from the inserted gloss mention, because `prompts.test.ts` pins several of those phrases:

```ts
  const sawGloss = gloss ? " and the **Meaning** line" : "";
  const visibilityClause = showOptions
    ? `The learner saw ONLY the **Sentence** (with the blank), the **Instructions**, and the **Options** listed above${sawGloss} — NOT the **Correct Answer**, **Acceptable Answers**, or **Context**.`
    : `The learner saw ONLY the **Sentence** (with the blank) and the **Instructions**${sawGloss} — NOT the **Correct Answer**, **Acceptable Answers**, or **Context**. This was free production: the learner was NOT shown any list of candidate options, so never fault them for answering "outside" a set of choices, and never tell the learner they should have picked from provided options.`;
```

Then add the binding sentence to the end of the returned prompt's final paragraph, appended **after** the existing `"El portero no ___ entrar…"` example sentence and rendered only when a gloss is present:

```ts
${gloss ? ` When a **Meaning** line is present, it is part of what the learner saw and it constrains the answer: a fill that is grammatical in the sentence but contradicts the stated meaning is NOT correct — the Meaning is not "unstated context", it is context the learner was given.` : ""}
```

This narrows #612's tense-licensing rule only when a gloss exists; an unglossed cloze keeps #612's behaviour exactly.

- [ ] **Step 5: Bump the version constant and document the edit**

Set `EVALUATION_SYSTEM_PROMPT_VERSION = "evaluate@2026-08-12"` and add to the dated comment block above it:

```ts
// 2026-08-12: the cloze USER prompt now renders `glossEn` as a
// "**Meaning (shown to the learner):**" line and treats it as binding — a fill
// that is grammatical but contradicts the gloss is not correct. The gloss is
// shown to the learner (cloze-prompt.tsx) but was rendered to no downstream
// prompt, so #612's "any form the sentence licenses is correct" rule awarded
// full credit to a wrong person/referent (qa:sample 2026-08-12: "puedes"
// scored 1.0 against a gloss reading "I can't eat…"). USER-prompt-only edit —
// cached system template unchanged, ships with the code deploy, NO Langfuse push.
```

- [ ] **Step 6: Run the tests to confirm they pass**

```bash
pnpm --filter @language-drill/ai test prompts
```

Expected: PASS, including every pre-existing `anti-anchoring blocks` and `cloze options visibility` test. If an existing assertion broke, the visibility-clause wording drifted — restore it byte-for-byte rather than editing the test.

- [ ] **Step 7: Commit**

```bash
test "$(git branch --show-current)" = "fix/cloze-gloss-visibility" || exit 1
git add packages/ai/src/prompts.ts packages/ai/src/prompts.test.ts
git commit -m "fix(evaluate): render the cloze meaning gloss and treat it as binding

A cloze glossEn is shown to the learner but was rendered to no downstream
prompt, so the evaluator judged person/tense/referent choices the gloss had
already fixed. Bumps EVALUATION_SYSTEM_PROMPT_VERSION to evaluate@2026-08-12.
USER-prompt-only: ships with the code deploy, no Langfuse push.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Render the gloss to the validator

**Files:**
- Modify: `packages/ai/src/validation-prompts.ts`
- Test: `packages/ai/src/validation-prompts.test.ts`

**Interfaces:**
- Consumes: `ClozeContent.glossEn`; `buildClozeValidationUserPrompt(content: ClozeContent, spec: GenerationSpec)` keeps its signature.
- Produces: the same `**Meaning (shown to the learner):**` label in the validator user prompt — Task 3's rule refers to it, and Task 5 asserts on it.

- [ ] **Step 1: Write the failing tests**

Append to `packages/ai/src/validation-prompts.test.ts`. Reuse whatever `GenerationSpec` fixture that file already builds for cloze cases — read the file's existing cloze describes and use the same helper rather than hand-rolling a spec:

```ts
// The validator could not see `glossEn` either, which is how a row glossed
// "The park is near the school." shipped declaring the antonym "lejos" an
// acceptable answer: the contradiction was invisible at validation time.
describe("cloze validation prompt — meaning gloss", () => {
  it("renders the gloss so the validator can check it against acceptableAnswers", () => {
    const out = buildValidationUserPrompt(
      {
        contentJson: {
          type: ExerciseType.CLOZE,
          instructions: "Fill in the blank with the correct compound preposition.",
          sentence: "El parque está ___ del colegio.",
          correctAnswer: "cerca",
          acceptableAnswers: ["lejos"],
          glossEn: "The park is near the school.",
        },
      } as any,
      clozeSpec,
    );
    expect(out).toContain(
      "**Meaning (shown to the learner):** The park is near the school.",
    );
    expect(out).toContain("**Acceptable Answers (also accepted):** lejos");
  });

  it("omits the Meaning line for an unglossed draft", () => {
    const out = buildValidationUserPrompt(
      {
        contentJson: {
          type: ExerciseType.CLOZE,
          instructions: "Fill in the blank.",
          sentence: "El portero no ___ entrar.",
          correctAnswer: "dejó",
        },
      } as any,
      clozeSpec,
    );
    expect(out).not.toContain("**Meaning");
  });
});
```

`clozeSpec` is the existing cloze `GenerationSpec` fixture in that file; if it is defined inside another `describe`, hoist it to module scope in this task rather than duplicating it.

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @language-drill/ai test validation-prompts
```

Expected: FAIL on the missing `**Meaning` line.

- [ ] **Step 3: Render the gloss in the validator user prompt**

In `buildClozeValidationUserPrompt`, insert immediately after the `**Sentence:**` line:

```ts
${typeof content.glossEn === "string" && content.glossEn.length > 0 ? `**Meaning (shown to the learner):** ${content.glossEn}` : ""}
```

- [ ] **Step 4: Bump the version constant**

Set `VALIDATION_PROMPT_VERSION = "validate@2026-08-12"` and add to its comment block:

```ts
// 2026-08-12: the cloze validation USER prompt now renders `glossEn` as a
// "**Meaning (shown to the learner):**" line, so the validator can check
// `acceptableAnswers` against the gloss. USER-prompt-only in this commit —
// the cached template gains the enforcing rule in the next commit, which DOES
// need a Langfuse push.
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @language-drill/ai test validation-prompts
```

Expected: PASS, including the `VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity` block (untouched this task).

- [ ] **Step 6: Commit**

```bash
test "$(git branch --show-current)" = "fix/cloze-gloss-visibility" || exit 1
git add packages/ai/src/validation-prompts.ts packages/ai/src/validation-prompts.test.ts
git commit -m "fix(validate): render the cloze meaning gloss to the validator

The validator could not see glossEn, so a row glossed 'near' shipped declaring
the antonym 'lejos' acceptable. Bumps VALIDATION_PROMPT_VERSION to
validate@2026-08-12. USER-prompt-only in this commit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Validator rule — a gloss and its acceptable answers must agree

**Files:**
- Modify: `packages/ai/src/validation-prompts.ts` (the `ambiguous` dimension inside `VALIDATION_SYSTEM_PROMPT_TEMPLATE`, at line ~153; extend the `VALIDATION_PROMPT_VERSION` comment from Task 2)
- Test: `packages/ai/src/validation-prompts.test.ts`

**Interfaces:**
- Consumes: the `**Meaning (shown to the learner):**` label from Task 2 — the rule text references it, so Task 2 must land first or the rule points at a line that is not rendered.
- Produces: the rule text asserted by Task 5's live probe.

- [ ] **Step 1: Write the failing test**

Append to `packages/ai/src/validation-prompts.test.ts`:

```ts
describe("validation template — gloss consistency rule", () => {
  it("tells the validator a gloss-contradicting acceptableAnswer is ambiguous, with both cures", () => {
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain("Gloss consistency (cloze)");
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toMatch(/true \*under that gloss\*/);
    // Both cures must be stated, or the validator flags without a fix path.
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain("widen the gloss");
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain("I want/can walk");
    // The form-vs-lexeme carve-out keeps de-a1-zero-article legitimate.
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toMatch(/zero article before a profession/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @language-drill/ai test validation-prompts
```

Expected: FAIL — the template has no `Gloss consistency (cloze)` text.

- [ ] **Step 3: Add the rule as a sub-bullet of the `ambiguous` dimension**

Insert as a new sub-bullet immediately after the existing `**Polarity-determinacy (cloze):**` sub-bullet, matching its `   - **Name (cloze):**` indentation and style:

```
   - **Gloss consistency (cloze):** when the draft carries a `glossEn` (rendered above as **Meaning (shown to the learner)**), every entry in `acceptableAnswers` must be true *under that gloss* — the learner reads the gloss, so it constrains the answer. An entry that changes the meaning the gloss states — a different hour than the one glossed, an antonym (`cerca` glossed "near" with `lejos` accepted), a different person (`puedo` glossed "I can't" with `quiero` accepted), a different referent or possessor — is a defect, not an alternant: set `ambiguous = true`. Two cures, and a clean draft picks one: **widen the gloss** so it covers every listed answer (`"I want/can walk to the park every day"` for `quiero`/`puedo`; `"This / That planet is very big"` for `Este`/`Ese`/`Aquel`), or **drop** the entries the gloss excludes. When the grammar point is a FORM rather than a lexeme — the zero article before a profession, an adjective's declension ending — and the alternates are different lexemes that all realize that form, the alternates are legitimate: prefer widening or omitting the gloss instead of trimming them.
```

- [ ] **Step 4: Extend the version comment to record the push requirement**

Append to the `VALIDATION_PROMPT_VERSION` comment added in Task 2:

```ts
// The gloss-consistency rule added to VALIDATION_SYSTEM_PROMPT_TEMPLATE in this
// commit IS a cached-template edit: it is inert in production until
// `push-prompts` runs per environment (see the plan's Task 8).
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @language-drill/ai test validation-prompts
```

Expected: PASS, and the `VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity` block must still pass — it asserts `applyTemplate(TEMPLATE, computeVars(spec)).text === buildValidationSystemPrompt(spec)`. Adding literal prose keeps parity; introducing a new `{{placeholder}}` would break it. Do not add placeholders.

- [ ] **Step 6: Commit**

```bash
test "$(git branch --show-current)" = "fix/cloze-gloss-visibility" || exit 1
git add packages/ai/src/validation-prompts.ts packages/ai/src/validation-prompts.test.ts
git commit -m "fix(validate): reject cloze acceptableAnswers that contradict the gloss

Extends the ambiguous dimension with a gloss-consistency sub-bullet, beside the
existing antonym precedent for comparative polarity. Cached-template edit —
needs a push-prompts per environment to take effect.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Verify the evaluator fix against the live API

**Files:**
- Create: `packages/ai/scripts/fixtures/eval-cloze-gloss-binding.json`
- Modify: `packages/ai/scripts/eval-seed.test.ts`
- Create (scratchpad, not committed): a baseline-capture script

**Interfaces:**
- Consumes: `parseSeedFixture` (exported from `packages/ai/scripts/eval-seed.ts`); `evaluateAnswer(client, input)` from `@language-drill/ai`.
- Produces: Langfuse dataset `eval-cloze-gloss-binding` with seed keys `es-querer-poder-person-gloss` and `es-locative-antonym-gloss`; an `eval-runs/` JSON consumed by Task 6's record.

**Why baselines are captured first:** `eval:seed` dedupes on `seedKey` and **skips** items that already exist, so a fixture seeded with a guessed `expectedOutput` can never be corrected in place — and `expectedOutput` is the baseline side of `pnpm eval`'s delta computation.

- [ ] **Step 1: Take the pre-fix baselines from the committed report**

Do **not** try to re-probe the pre-fix behaviour. The defect lives in the **user** prompt, and `evaluateAnswer`'s only prompt escape hatch is `systemPromptOverride`, which replaces the *system* prompt — there is no way to restore a pre-fix *user* prompt through the public API. The baselines are already measured and committed, so use them verbatim:

| seedKey | exercise | userAnswer | observed pre-fix score |
|---|---|---|---|
| `es-querer-poder-person-gloss` | `8a84bbba-7ef0-5d3a-918c-fcf68d19a97b` | `puedes` | **1.0** (`docs/analysis/qa-run-2026-08-12-prod-es-a1-cloze.json`, flag `false_positive`) |
| `es-locative-antonym-gloss` | `f587a1fe-8372-5642-a5d2-f7fecf875093` | `lejos` | **1.0** (same report, flag `false_positive`) |

Record in the fixture's `description` that these baselines come from that committed report rather than from a fresh probe, and why.

- [ ] **Step 2: Write the failing fixture test**

Append to `packages/ai/scripts/eval-seed.test.ts`:

```ts
describe("fixtures/eval-cloze-gloss-binding.json", () => {
  it("parses and covers both gloss-binding cases", () => {
    const raw = JSON.parse(
      readFileSync(
        path.join(here, "fixtures", "eval-cloze-gloss-binding.json"),
        "utf8",
      ),
    );
    const fixture = parseSeedFixture(raw);
    expect(fixture.dataset).toBe("eval-cloze-gloss-binding");
    const keys = fixture.items.map((i) => i.seedKey);
    expect(keys).toContain("es-querer-poder-person-gloss");
    expect(keys).toContain("es-locative-antonym-gloss");
    // Every item must carry the gloss under test — without it the fixture
    // measures nothing.
    for (const item of fixture.items) {
      expect((item.input as any).exercise.glossEn).toBeTruthy();
      expect(item.expectedOutput).toHaveProperty("score", 1);
    }
  });
});
```

- [ ] **Step 3: Run to confirm it fails**

```bash
pnpm --filter @language-drill/ai test eval-seed
```

Expected: FAIL with `ENOENT` on the fixture.

- [ ] **Step 4: Write the fixture**

Create `packages/ai/scripts/fixtures/eval-cloze-gloss-binding.json`. The `exercise` blocks are the two rows' real `content_json`, copied verbatim from the spec appendix / the committed report:

```json
{
  "dataset": "eval-cloze-gloss-binding",
  "description": "Two real prod cloze rows whose learner-visible glossEn contradicts what the evaluator accepted, because the gloss was rendered to the learner but not to the evaluator. expectedOutput is the OBSERVED pre-fix verdict (score 1.0) taken from docs/analysis/qa-run-2026-08-12-prod-es-a1-cloze.json — not a fresh probe: the defect is in the USER prompt, and `systemPromptOverride` cannot restore a pre-fix user prompt, so the committed report is the baseline of record. A good evaluation scores both below PASS_THRESHOLD 0.8 once the gloss is rendered.",
  "items": [
    {
      "seedKey": "es-querer-poder-person-gloss",
      "note": "Prod row 8a84bbba-7ef0-5d3a-918c-fcf68d19a97b. The learner reads 'I can't eat the soup without salt'; the Spanish alone does not fix the person, so 'puedes' (2nd person) is grammatical and scored 1.0. With the gloss visible it must fail.",
      "input": {
        "exercise": {
          "type": "cloze",
          "instructions": "Fill in the blank with the correct form of the verb.",
          "sentence": "No ___ comer la sopa sin sal.",
          "correctAnswer": "puedo",
          "acceptableAnswers": ["quiero"],
          "options": ["puedo", "quiero", "puedes", "quiere"],
          "context": "Querer and poder with the infinitive",
          "glossEn": "I can't eat the soup without salt."
        },
        "userAnswer": "puedes",
        "language": "ES",
        "difficulty": "A1"
      },
      "expectedOutput": {
        "score": 1,
        "grammarAccuracy": 1,
        "errors": [],
        "feedback": "Observed pre-fix baseline: full credit, no errors reported.",
        "vocabularyRange": "A1",
        "taskAchievement": 1,
        "estimatedCefrEvidence": "A1"
      }
    },
    {
      "seedKey": "es-locative-antonym-gloss",
      "note": "Prod row f587a1fe-8372-5642-a5d2-f7fecf875093. Glossed 'The park is near the school.' yet acceptableAnswers declares the antonym 'lejos'. Note this row's acceptableAnswers is itself the defect Task 9 repairs — the eval item keeps it as-shipped so the fixture measures the evaluator's behaviour against the row as it existed.",
      "input": {
        "exercise": {
          "type": "cloze",
          "instructions": "Fill in the blank with the correct compound preposition to complete the location phrase.",
          "sentence": "El parque está ___ del colegio.",
          "correctAnswer": "cerca",
          "acceptableAnswers": ["lejos"],
          "options": ["cerca", "lejos", "debajo", "encima"],
          "context": "Locative prepositional phrases",
          "glossEn": "The park is near the school."
        },
        "userAnswer": "lejos",
        "language": "ES",
        "difficulty": "A1"
      },
      "expectedOutput": {
        "score": 1,
        "grammarAccuracy": 1,
        "errors": [],
        "feedback": "Observed pre-fix baseline: full credit via the declared acceptableAnswer.",
        "vocabularyRange": "A1",
        "taskAchievement": 1,
        "estimatedCefrEvidence": "A1"
      }
    }
  ]
}
```

**Expected asymmetry, and it is the point:** item 1 should move below 0.8 from the prompt fix alone. Item 2 may stay at 1.0 even after Task 1, because `lejos` is an exact match on a declared `acceptableAnswers` entry and the evaluator's exact-match rule fires before any judgement. That item is fixed by Task 9's data repair, not by the prompt. Record both outcomes; do not treat item 2 staying high as a failed fix.

- [ ] **Step 5: Run the fixture test**

```bash
pnpm --filter @language-drill/ai test eval-seed
```

Expected: PASS, plus the pre-existing `eval-hard-morphology` and `seedDatasetFromFixture` blocks.

- [ ] **Step 6: Seed the dataset (dev Langfuse)**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/cloze-gloss-visibility/packages/ai
pnpm exec dotenv -e ../../.env -- pnpm exec tsx scripts/eval-seed.ts --file scripts/fixtures/eval-cloze-gloss-binding.json
```

Expected: `created=2 skipped=0`. Do **not** pass `--allow-prod`. Re-run once to confirm `created=0 skipped=2`.

- [ ] **Step 7: Run the eval arm, backgrounded**

```bash
pnpm exec tsx -e 'import {EVALUATION_SYSTEM_PROMPT} from "./src/index.js"; process.stdout.write(EVALUATION_SYSTEM_PROMPT)' > <scratchpad>/eval-system.txt
pnpm exec dotenv -e ../../.env -- pnpm exec tsx scripts/eval-run.ts \
  --dataset eval-cloze-gloss-binding \
  --candidate file:<scratchpad>/eval-system.txt \
  --run-name cloze-gloss-binding-2026-08-12
```

The system prompt is unchanged by this plan, so `--candidate` here simply supplies the current system body; what is under test is the **user** prompt, which `evaluateAnswer` builds internally from the fixture's `exercise` (now including `glossEn`).

- [ ] **Step 8: Read the per-item results and record them**

Read `packages/ai/eval-runs/cloze-gloss-binding-2026-08-12.json`. Success criterion: **item 1 (`es-querer-poder-person-gloss`) scores below 0.8** and reports an error identifying the person mismatch. Note item 2's score without judging it (see Step 4).

If item 1 does **not** drop below 0.8, stop and report before continuing — the binding clause is not landing, and Tasks 8–9 should not proceed on an unverified fix.

- [ ] **Step 9: Commit the fixture and its test**

```bash
test "$(git branch --show-current)" = "fix/cloze-gloss-visibility" || exit 1
git add packages/ai/scripts/fixtures/eval-cloze-gloss-binding.json packages/ai/scripts/eval-seed.test.ts
git commit -m "test(eval): fixture for cloze gloss-binding at answer time

Two real prod rows whose learner-visible gloss contradicts what the evaluator
accepted. Baselines are the observed pre-fix verdicts from the committed
2026-08-12 qa:sample report.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Verify the validator rule against the live API

`eval:gen` cannot do this job: it A/Bs **generation** prompt sources and validates both arms with the same validator, so a validation-prompt change moves both arms identically. Instead, invoke the real validator directly. `validateDraft` has no `systemPromptOverride`, but `buildValidationSystemPrompt` falls back to the **in-repo** template when `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` are unset — which is exactly the edited body.

**Files:**
- Create (scratchpad, not committed): `packages/ai/scripts/tmp-gloss-validator-probe.mjs` — delete after use.

**Interfaces:**
- Consumes: `validateDraft(client, draft, spec, signal?)` from `packages/ai/src/validate.js`; a cloze `GenerationSpec` built the same way `validation-prompts.test.ts` builds one.
- Produces: a pass/fail verdict recorded in Task 6's record.

- [ ] **Step 1: Write the probe**

Create `packages/ai/scripts/tmp-gloss-validator-probe.mjs` (in `scripts/` so its relative imports resolve):

```js
// Scratchpad-only, never committed. Runs the REAL validator against three
// hand-built cloze drafts with LANGFUSE keys unset, so buildValidationSystemPrompt
// falls back to the in-repo (edited) template.
import Anthropic from "@anthropic-ai/sdk";
import { validateDraft } from "../src/validate.js";

const client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });

// Build the spec the same shape validation-prompts.test.ts uses; read that file
// and mirror its cloze GenerationSpec fixture exactly rather than inventing one.
const spec = /* cloze GenerationSpec: language ES, cefrLevel A1, grammarPoint es-a1-locative-prepositions */ null;

const CASES = [
  {
    name: "contradictory-antonym (expect ambiguous=true)",
    contentJson: {
      type: "cloze",
      instructions: "Fill in the blank with the correct compound preposition to complete the location phrase.",
      sentence: "El parque está ___ del colegio.",
      correctAnswer: "cerca",
      acceptableAnswers: ["lejos"],
      glossEn: "The park is near the school.",
    },
  },
  {
    name: "inclusive-gloss control (expect ambiguous=false)",
    contentJson: {
      type: "cloze",
      instructions: "Fill in the blank with the correct form of the verb.",
      sentence: "Yo ___ caminar al parque todos los días.",
      correctAnswer: "quiero",
      acceptableAnswers: ["puedo"],
      glossEn: "I want/can walk to the park every day.",
    },
  },
  {
    name: "unglossed control (expect ambiguous unchanged by this rule)",
    contentJson: {
      type: "cloze",
      instructions: "Fill in the blank with the correct compound preposition.",
      sentence: "El parque está ___ del colegio.",
      correctAnswer: "cerca",
    },
  },
];

for (const c of CASES) {
  const res = await validateDraft(client, { contentJson: c.contentJson }, spec);
  console.log(JSON.stringify({ case: c.name, ambiguous: res.result?.ambiguous, qualityScore: res.result?.qualityScore, flagReasons: res.result?.flagReasons }));
}
```

Before running, replace the `spec` placeholder with the real fixture: open `packages/ai/src/validation-prompts.test.ts`, copy its cloze `GenerationSpec` literal, and adapt `grammarPoint` to `es-a1-locative-prepositions` for case 1/3 and `es-a1-querer-poder-infinitive` for case 2. The probe must not run with `spec = null`.

- [ ] **Step 2: Run it with Langfuse keys unset, backgrounded**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/cloze-gloss-visibility/packages/ai
env -u LANGFUSE_PUBLIC_KEY -u LANGFUSE_SECRET_KEY \
  pnpm exec dotenv -e ../../.env -- \
  env -u LANGFUSE_PUBLIC_KEY -u LANGFUSE_SECRET_KEY \
  pnpm exec tsx ./tmp-gloss-validator-probe.mjs
```

The doubled `env -u` is deliberate: `dotenv -e ../../.env` re-injects whatever the file defines, so the keys must be stripped again on the inner command.

- [ ] **Step 3: Check the verdicts**

Pass requires: case 1 `ambiguous: true`; case 2 `ambiguous: false`; case 3 unchanged behaviour (no gloss → this rule cannot fire). Run each case 3 times — the validator is a nondeterministic LLM call, and the `gustar` episode established that a single draw near a decision boundary proves nothing. Report the per-draw verdicts, not just a summary.

- [ ] **Step 4: Delete the probe**

```bash
rm -f packages/ai/scripts/tmp-gloss-validator-probe.mjs
git status --short
```

Expected: clean — the probe must not appear as untracked when Task 6 runs.

---

### Task 6: Record the verification evidence

**Files:**
- Create: `docs/analysis/cloze-gloss-visibility-verification-2026-08-12.md`

- [ ] **Step 1: Write the record**

Include: the eval run name and per-item baseline→candidate scores from Task 4 (with the expected item-2 asymmetry explained); the three-draw validator verdicts per case from Task 5; the exact commands used; total AI spend; and, for each, whether the success criterion was met. State plainly if any criterion was missed.

- [ ] **Step 2: Commit**

```bash
test "$(git branch --show-current)" = "fix/cloze-gloss-visibility" || exit 1
git add docs/analysis/cloze-gloss-visibility-verification-2026-08-12.md
git commit -m "docs(qa): verification evidence for the cloze gloss fix

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Full gate, push, PR

- [ ] **Step 1: Ensure esbuild resolves for the CDK synth tests**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/cloze-gloss-visibility
ls node_modules/esbuild >/dev/null 2>&1 || ln -s "$(pwd)/node_modules/.pnpm/$(ls node_modules/.pnpm | grep -m1 '^esbuild@')/node_modules/esbuild" node_modules/esbuild
```

- [ ] **Step 2: Clear stale lambda dist and run the full gate**

```bash
rm -rf infra/lambda/dist
pnpm lint && pnpm typecheck && pnpm test
```

Expected: zero failures. Report the test counts.

- [ ] **Step 3: Rebase and push**

```bash
git fetch origin main && git rebase origin/main
git push -u origin fix/cloze-gloss-visibility
```

- [ ] **Step 4: Open the PR with the personal gh account**

This repo rejects the default `gh` account — use the personal config directory:

```bash
export GH_CONFIG_DIR="$HOME/.config/gh-personal"
gh pr create --title "fix(cloze): the glossEn blind spot — render the meaning gloss to the validator and evaluator" --body "<summary>"
```

The body must state: the root cause (one field, three call sites); that Tasks 1–2 are user-prompt-only while Task 3's template edit needs a post-merge `push-prompts`; the verification results from Task 6; and that 20 prod rows are repaired separately (Task 9) with no demotion. Squash-merge, replacing the auto bullet list with the summary.

---

### Task 8: Post-merge — push the validation template to both environments

Runs **after** merge, from a **fresh `main` checkout** (not this worktree): `push-prompts` pushes every drifted prompt, so a stale tree reverts unrelated ones.

- [ ] **Step 1: Prod — preview, push, verify**

```bash
PK=$(aws --region eu-central-1 secretsmanager get-secret-value --secret-id language-drill/LANGFUSE_PUBLIC_KEY --query SecretString --output text)
SK=$(aws --region eu-central-1 secretsmanager get-secret-value --secret-id language-drill/LANGFUSE_SECRET_KEY --query SecretString --output text)
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com pnpm --filter @language-drill/ai push-prompts --dry-run
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com pnpm --filter @language-drill/ai push-prompts
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com pnpm --filter @language-drill/ai bootstrap-prompts --check
```

Expected: the dry run lists **only** the validation prompt as drifted. If it lists others, stop — the tree is stale. Record the prior version `push-prompts` logs as the revert target. `--check` exits 0.

- [ ] **Step 2: Dev — the same three commands with the `language-drill-dev/` secret prefix**

Record dev's revert version too.

---

### Task 9: Repair the 20 contradictory prod rows

Read the spec appendix first — it carries the per-row verdict for all 39 audited rows. Only the 18 Class A and 2 Class B rows are touched.

- [ ] **Step 1: Confirm with the user before the first write**

These are production writes. Present the row count and the two write shapes, and get explicit go-ahead.

- [ ] **Step 2: Capture the current content for rollback**

Via Neon MCP `run_sql` (project `twilight-smoke-01114337`, branch `br-green-waterfall-ancrvpr5`), select `id, content_json` for all 20 ids and paste the results into the Task 6 record before writing anything.

- [ ] **Step 3: Class A — trim the gloss-contradicting entries**

One statement per id. Example for `f587a1fe` (whose only entry is contradictory, so the key is removed):

```sql
update exercises
set content_json = content_json - 'acceptableAnswers'
where id = 'f587a1fe-8372-5642-a5d2-f7fecf875093'
  and content_json->'acceptableAnswers' = '["lejos"]'::jsonb;
```

Example for a row where some entries survive (`67006ee0`, keeping `saat sekizde`):

```sql
update exercises
set content_json = jsonb_set(content_json, '{acceptableAnswers}', '["saat sekizde"]'::jsonb, false)
where id = '67006ee0-743f-508c-926a-bcc04c7aa63d'
  and content_json ? 'acceptableAnswers';
```

Every statement carries a guard on the current value so a re-run is a no-op and a surprise value aborts rather than overwrites. Derive each row's surviving list from the spec appendix's "contradicting entries" column — the entries **not** listed there survive.

- [ ] **Step 4: Class B — drop the over-specified gloss**

```sql
update exercises
set content_json = content_json - 'glossEn'
where id in (
  '7858b64e-7e2b-5a86-b903-31da8ca8540f',
  '09acd36d-4210-5021-b0ee-925dc6052058'
)
  and content_json ? 'glossEn';
```

- [ ] **Step 5: Verify the writes**

```sql
select id, content_json->'acceptableAnswers' as acceptable, content_json->>'glossEn' as gloss,
       review_status, demotion_reason
from exercises where id in (<the 20 ids>);
```

Expected: trimmed arrays / removed keys as planned; `review_status` unchanged; `demotion_reason` still NULL on every row.

- [ ] **Step 6: Re-run the audit query to confirm the class is empty**

```sql
select count(*) from exercises
where type='cloze' and review_status in ('auto-approved','manual-approved')
  and content_json ? 'glossEn'
  and jsonb_array_length(coalesce(content_json->'acceptableAnswers','[]'::jsonb)) > 0;
```

Expected: 19 — the legitimate rows from the appendix, none of the repaired ones.

---

### Task 10: Confirm end to end, then update memory

- [ ] **Step 1: Wait for the Lambda module-scope cache**

At least 5 minutes after Task 8's push.

- [ ] **Step 2: Replay the two recorded probes, n=10 each**

Do **not** judge this by a fresh `qa:sample` run: the answer crafter is unseeded, so a clean re-sample invents fresh probes and proves nothing (the lesson from `docs/analysis/qa-sample-findings-2026-08-11.md`). Replay the exact strings — `puedes` against `8a84bbba`, `lejos` against `f587a1fe` — through `evaluateAnswer` against each row's post-repair `content_json`, 10 draws each, matching `qa-sample-run.ts:scoreAnswer`'s call shape (`exercise`, `userAnswer`, `language`, `difficulty`, `grammarGuidance`, `attributionKeys`; `optionsRevealed` omitted). ~$0.02/call.

Expected: `puedes` below 0.8 on all 10 draws (the gloss now forbids it); `lejos` below 0.8 on all 10 (its `acceptableAnswers` entry is gone). Report the distributions, not just the means.

- [ ] **Step 3: Append the outcome to the verification record**

Commit on a follow-up branch off updated `main`.

- [ ] **Step 4: Update project memory**

Add a `project` memory for the gloss blind spot: `glossEn` is learner-visible and must be rendered to any prompt that judges a cloze answer or draft; the three call sites; that the evaluator/validator user prompts ship with code while the validation template needs a push; and the 39-row audit query, which is the reusable diagnostic. Link `[[qa-sample-tool]]` and `[[evaluator-prompt-asserts-ui-visibility]]`. Add the one-line pointer to `MEMORY.md`.

---

## Self-Review

**Spec coverage:** Fix 1 → Tasks 1, 2. Fix 2 → Task 1 (steps 4–5). Fix 3 → Task 3. Fix 4 → Task 9. Verification §1 → Tasks 1–3 tests; §2 → Task 4; §3 → Task 5; §4 → Task 10; §5 → Task 7. Rollback → Task 8 (label revert) and Task 9 step 2 (captured `content_json`). Out-of-scope items stay out and remain recorded in the spec.

**Deviations from the spec, deliberate:**
1. The spec proposed `eval:gen` for the validator rule. **It cannot work** — `eval:gen` A/Bs generation prompts and validates both arms with the same validator. Task 5 replaces it with a direct `validateDraft` probe run with `LANGFUSE_*` unset so the in-repo template is used.
2. The spec implied a fresh pre-fix baseline capture for the eval fixture. **Not possible** — the defect is in the *user* prompt and `systemPromptOverride` only replaces the *system* prompt. Task 4 uses the observed baselines from the committed `qa:sample` report instead, and says so in the fixture description.
3. Task 4 adds an explicit warning that fixture item 2 (`lejos`) may stay at 1.0 after the prompt fix, because exact-match on a declared `acceptableAnswers` entry precedes judgement. That item is closed by Task 9's data repair. Without this note an implementer would read a correct result as a failed fix.
4. Task 5 requires 3 draws per case and Task 10 requires 10, rather than one — carrying forward the `gustar` lesson that a single draw near a boundary is not evidence.

**Type consistency:** `ClozeContent.glossEn?: string`, `buildClozeUserPrompt(content, userAnswer, language, difficulty, optionsRevealed)`, `buildUserPrompt(exercise, userAnswer, language, difficulty, grammarGuidance?, attributionKeys?, visibility?)`, `buildValidationUserPrompt(draft, spec)`, `buildClozeValidationUserPrompt(content, spec)`, `validateDraft(client, draft, spec, signal?)`, `parseSeedFixture`, `VALIDATION_SYSTEM_PROMPT_TEMPLATE`, `EVALUATION_SYSTEM_PROMPT_VERSION`, `VALIDATION_PROMPT_VERSION` — all match their sources as read on 2026-08-12. The label string `**Meaning (shown to the learner):**` is identical in Tasks 1, 2, 3, and 5.
