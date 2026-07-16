# ES cloze generation fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the ES cloze generator from producing spoiled/off-register drafts, so the two dead cells (`es-a1-quantifiers-muy-mucho`, `es-a2-present-irregular-stem-changes`) — and cloze cells run-wide — start clearing the approval bar.

**Architecture:** Two independent code edits in `packages/ai`, shipped with the Lambda code deploy (NOT `push-prompts`): (A) delete the optional `context` field from the cloze generation **tool schema** so the model cannot emit the run's #1 reject cause (`context-spoils-answer`, 61% of rejects); (B) extend the injected-seed instruction in the code-built user prompt so the model swaps a register-specific / above-level frequency-band seed for an everyday level-appropriate word. A separate, gated follow-up PR bumps `CURRICULUM_VERSION_ES` to un-suppress the two `skip-low-yield` cells once the new code is live.

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Vitest, Anthropic tool-use generation, Neon Postgres (prod branch `br-green-waterfall-ancrvpr5`, project `twilight-smoke-01114337`).

## Global Constraints

- `context` field is **internal-only** for cloze — web never renders it; `ClozeContent.context` stays `?:` optional (back-compat for stored rows). Do NOT touch the parser, the shared type, the validator, or web.
- **CORRECTION (post final-review):** the schema removal alone is a no-op — the template still invited a `context` field and there was no `additionalProperties` guard, so a follow-up commit added `additionalProperties: false` to the cloze tool AND swept the two `context` field-references from `GENERATION_SYSTEM_PROMPT_TEMPLATE` (lines 375, 386). Because the template body changed, **`push-prompts` per env IS required post-merge** (from a fresh main checkout — [push-prompts-stale-worktree]); the runtime serves the Langfuse body. The seed edit (B) remains code-only. Also: `context` **is** learner-facing (rendered as an eyebrow tag by `ClozePrompt`, `apps/web/components/drill/cloze-prompt.tsx:88-94`); truly-omit means new cloze cards drop that tag (it was frequently the spoiler), while stored rows still render via the back-compat-optional `ClozeContent.context`.
- Bump `GENERATION_PROMPT_VERSION` to `generate@2026-07-12` (cohort tag for the behavior change).
- No `VALIDATION_PROMPT_VERSION` bump: non-structural change; the validator already vetoes `contextSpoilsAnswer` and is null-safe on `context`.
- Real gate is the full workspace suite: `pnpm turbo run test --concurrency=1` (a package `tsc` passes while `*.test.ts` reference removed symbols — [package-typecheck-excludes-tests]).
- Ship as **two PRs**: PR1 = code fix (Tasks 1–4); PR2 = `CURRICULUM_VERSION_ES` bump (Task 5), merged only after PR1's code is confirmed deployed/live.
- Work on branch `fix/es-cloze-generation-context-seed` (already created). Assert the branch before each commit — this workspace silently flips to `main` ([workspace-branch-flips-to-main]).

---

### Task 1: Remove the `context` field from the cloze generation tool schema (decision A)

**Files:**
- Modify: `packages/ai/src/generate.ts:145-149` (delete the `context` property block) and `:158` (reword the `glossEn` description's dangling `context` cross-reference)
- Modify: `packages/ai/src/generation-prompts.ts:209` (bump version constant)
- Test: `packages/ai/src/generate.test.ts`

**Interfaces:**
- Consumes: `CLOZE_GENERATION_TOOL` (exported `Anthropic.Tool`), `parseGeneratedClozeDraft` (unchanged — still tolerates a `context` input for back-compat)
- Produces: a cloze tool schema whose `input_schema.properties` has **no** `context` key; `GENERATION_PROMPT_VERSION === "generate@2026-07-12"`

- [ ] **Step 1: Write the failing test**

Add to `packages/ai/src/generate.test.ts` inside the existing `describe("parseGeneratedClozeDraft glossEn", …)` block (after the `exposes glossEn` test, ~line 174):

```typescript
  it("no longer offers a context field on the cloze tool schema (anti-spoil, 2026-07-12)", () => {
    const props = CLOZE_GENERATION_TOOL.input_schema.properties as Record<
      string,
      unknown
    >;
    expect(props.context).toBeUndefined();
    // glossEn description must not dangle a reference to the removed field.
    expect((props.glossEn as { description: string }).description).not.toContain(
      "`context`",
    );
  });

  it("still parses a stray context input for back-compat (stored rows)", () => {
    const content = parseGeneratedClozeDraft(
      { ...validClozeInput, context: "legacy framing" },
      baseSpec,
    );
    expect(content.context).toBe("legacy framing");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- generate.test.ts -t "no longer offers a context field"`
Expected: FAIL — `props.context` is currently defined (the property block still exists).

- [ ] **Step 3: Delete the schema block and reword glossEn**

In `packages/ai/src/generate.ts`, delete this block (lines 145-149):

```typescript
      context: {
        type: "string",
        description:
          "Optional one-line framing shown above the sentence. May name the grammar category being tested (e.g. 'vowel harmony', 'noun-numeral agreement') but MUST NOT state the rule's outcome or otherwise reveal the answer. 'Vowel harmony: front vowel (e) requires -ler suffix' is forbidden — it tells the learner the answer. 'Plural agreement after a numeral' is acceptable. Same constraint applies to `instructions`.",
      },
```

Then in the `glossEn` description (line ~158), replace the trailing cross-reference:

```
… 'use the accusative -yi' is forbidden (same anti-spoil constraint as `context`)."
```

with:

```
… 'use the accusative -yi' is forbidden (it must not state the rule's outcome or name the required form)."
```

- [ ] **Step 4: Bump the prompt version**

In `packages/ai/src/generation-prompts.ts:209`, change:

```typescript
export const GENERATION_PROMPT_VERSION = "generate@2026-07-10";
```

to:

```typescript
export const GENERATION_PROMPT_VERSION = "generate@2026-07-12";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- generate.test.ts`
Expected: PASS (new assertions green; existing glossEn/parse tests unaffected).

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # MUST print fix/es-cloze-generation-context-seed
git add packages/ai/src/generate.ts packages/ai/src/generation-prompts.ts packages/ai/src/generate.test.ts
git commit -m "fix(gen): drop context field from cloze tool schema (kills context-spoils-answer)"
```

---

### Task 2: Register/level self-filter on the injected seed (decision B)

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts:753` (the seed instruction inside `buildGenerationUserPrompt`)
- Test: `packages/ai/src/generation-prompts.test.ts:704-709`

**Interfaces:**
- Consumes: `buildGenerationUserPrompt(inputs, ordinal, topicDomain, seedWord?)`; `inputs.cefrLevel: CefrLevel` (generation-prompts.ts:74), `inputs.grammarPoint.name`
- Produces: when seeded, a user prompt that still contains `Build this exercise around the word "<seed>".` plus an explicit register/level substitution clause

- [ ] **Step 1: Update the test to expect the new clause (failing)**

In `packages/ai/src/generation-prompts.test.ts`, replace the body of the test at line ~703 (`appends the loose seed instruction only when a seed is supplied (R5.5)`):

```typescript
  it("appends the loose seed instruction only when a seed is supplied (R5.5)", () => {
    const seeded = buildGenerationUserPrompt(baseInputs, 0, null, "viajar");
    expect(seeded).toContain('Build this exercise around the word "viajar".');
    // Loose: names the grammar point and offers a similar-frequency substitute.
    expect(seeded).toContain(baseInputs.grammarPoint.name);
    expect(seeded).toContain("of similar frequency");
    // 2026-07-12: register/level self-filter for off-band frequency seeds.
    expect(seeded).toContain("register-specific");
    expect(seeded).toContain(baseInputs.cefrLevel);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts.test.ts -t "appends the loose seed instruction"`
Expected: FAIL — output does not yet contain `"register-specific"`.

- [ ] **Step 3: Edit the seed instruction**

In `packages/ai/src/generation-prompts.ts:753`, replace:

```typescript
            : `Build this exercise around the word "${seedWord}". If "${seedWord}" does not fit ${inputs.grammarPoint.name} naturally, choose a related content word of similar frequency instead.\n\n`
```

with:

```typescript
            : `Build this exercise around the word "${seedWord}". If "${seedWord}" does not fit ${inputs.grammarPoint.name} naturally, or is register-specific (military, legal, medical, administrative, or literary), or sits above CEFR ${inputs.cefrLevel}, choose an everyday, level-appropriate content word of similar frequency instead. The word you use and the whole sentence must stay within the CEFR ${inputs.cefrLevel} vocabulary band.\n\n`
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts.test.ts -t "seed"`
Expected: PASS. Confirm the negative tests (`omits the seed line…`, `treats an empty-string seed as unseeded`, lines ~713/720/818/1246 asserting `not.toContain("Build this exercise around")`) still pass — they are unaffected (the phrase still opens the clause).

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # MUST print fix/es-cloze-generation-context-seed
git add packages/ai/src/generation-prompts.ts packages/ai/src/generation-prompts.test.ts
git commit -m "fix(gen): seed self-filter drops register-specific/above-level frequency words"
```

---

### Task 3: Full-suite green + open PR1

**Files:** none (verification + PR)

- [ ] **Step 1: Lint + typecheck + full test**

Run from repo root:
```bash
pnpm lint
pnpm typecheck
pnpm turbo run test --concurrency=1
```
Expected: all zero failures. (If `infra/lambda/dist/**/*.test.js` produces phantom failures, `rm -rf infra/lambda/dist` and rerun — [lambda-stale-dist-test-files].)

- [ ] **Step 2: Push and open PR1**

```bash
git push -u origin fix/es-cloze-generation-context-seed
ghp pr create --title "fix(gen): kill cloze context-spoiler + register-filter the frequency seed" \
  --body "$(cat <<'EOF'
Two independent generation fixes surfaced by the 2026-07-12 run analysis
(design: docs/superpowers/specs/2026-07-12-es-cloze-generation-fix-design.md).

- **A** — remove the optional `context` field from the cloze tool schema. It is
  internal-only (web never renders it) yet was the #1 reject cause
  (`context-spoils-answer`, 61% of the run's rejects; 4/4 wipeout on
  es-a1-quantifiers-muy-mucho).
- **B** — extend the injected-seed instruction so the model swaps a
  register-specific / above-level frequency-band seed (comandante, tribunal,
  amanecer) for an everyday level-appropriate word.

Ships with the code deploy — no `push-prompts` needed. `GENERATION_PROMPT_VERSION`
bumped to `generate@2026-07-12`. Empirical proof attached below (Task 4).

Follow-up PR2 bumps `CURRICULUM_VERSION_ES` to un-suppress the two dead cells,
merged only after this code is live.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Use the `ghp` alias — this repo's gh account is `nikolaivanv` — [github-account-is-nikolaivanv].)

---

### Task 4: Empirical proof — cross-checkout `eval:gen` on the failing cells

**Why cross-checkout:** the change is in code (tool schema + user-prompt builder), which `eval:gen`'s `--baseline/--candidate` prompt-source swap does NOT vary. So run the **same** `eval:gen` command on `main` (old code) and on the branch (new code) over the **same** dataset, then diff the two run JSONs. Bound cost with `--max-cost-usd`.

- [ ] **Step 1: Build the cell dataset from the branch**

```bash
pnpm eval:gen:export --help   # confirm flag names before running
pnpm eval:gen:export --language es --cefr a2 --sample 8 --out eval-runs/es-cloze-fix.dataset.json --allow-prod
```
Then verify the dataset includes both dead cells:
```bash
grep -c "es-a1-quantifiers-muy-mucho\|es-a2-present-irregular-stem-changes" eval-runs/es-cloze-fix.dataset.json
```
Expected: ≥ 1 for stem-changes (a2). If `es-a1-quantifiers-muy-mucho` is absent, run a second export with `--cefr a1` and merge, or hand-add its cell entry to the JSON (copy an existing entry's shape, swap `cellKey`/`grammarPointKey`/`cefrLevel`).

- [ ] **Step 2: Run the NEW-code arm (on the branch)**

```bash
git branch --show-current   # fix/es-cloze-generation-context-seed
pnpm eval:gen --baseline repo --candidate repo \
  --dataset-file eval-runs/es-cloze-fix.dataset.json \
  --drafts-per-cell 4 --max-cost-usd 5 --allow-prod --runName es-cloze-fix-NEW
```
(The two arms are identical by design — this run measures the new code's absolute approval rate; the two arms double as a within-run noise check.)
Output: `./eval-runs/es-cloze-fix-NEW.json`.

- [ ] **Step 3: Run the OLD-code arm (on main), same dataset**

```bash
git stash --include-untracked   # keep eval-runs/*.json — stash only tracked edits if any; the dataset file is untracked, so copy it aside first:
cp eval-runs/es-cloze-fix.dataset.json /tmp/es-cloze-fix.dataset.json
git checkout main
cp /tmp/es-cloze-fix.dataset.json eval-runs/es-cloze-fix.dataset.json
pnpm eval:gen --baseline repo --candidate repo \
  --dataset-file eval-runs/es-cloze-fix.dataset.json \
  --drafts-per-cell 4 --max-cost-usd 5 --allow-prod --runName es-cloze-fix-OLD
git checkout fix/es-cloze-generation-context-seed
```
Output: `./eval-runs/es-cloze-fix-OLD.json`.

- [ ] **Step 4: Compare and record the delta**

Read both JSONs; compare `approvalRate` and `rejectionReasonCounts` (expect `context-spoils-answer` → ~0 and `level-mismatch` down in NEW). Paste the before/after table into the PR1 thread.
Expected: NEW approval rate materially higher than OLD, with `context-spoils-answer` eliminated on the cloze cells.

- [ ] **Step 5: Gate decision**

If NEW ≥ OLD with the reason improvements, PR1 is validated — request review/merge. If NOT, stop and revisit the seed wording / whether the `context` removal alone suffices before merging.

> Alternative empirical path (if `eval:gen` cross-checkout is impractical): merge PR1 to **dev** only, let CDK deploy the dev Lambda, manually trigger the two cells via the admin generation route against the dev env, and inspect approval in the dev pool. Use whichever is cheaper.

---

### Task 5 (PR2 — gated): bump `CURRICULUM_VERSION_ES` to un-suppress the dead cells

**Precondition:** PR1 is merged AND its code is confirmed **deployed/live** (the tool schema no longer offers `context` in the running Lambda). Do NOT merge PR2 before this — the two cells are `skip-low-yield`-suppressed and a curriculum bump re-enables them; if the old code were still live they would burn a cycle re-failing.

**Files:**
- Modify: `packages/db/src/curriculum/es.ts:117`

- [ ] **Step 1: Branch from fresh main**

```bash
git checkout main && git pull
git checkout -b chore/es-curriculum-bump-uncork-cloze
```

- [ ] **Step 2: Bump the constant**

In `packages/db/src/curriculum/es.ts:117`, change:
```typescript
export const CURRICULUM_VERSION_ES = '2026-07-11b';
```
to a new value dated today, e.g.:
```typescript
export const CURRICULUM_VERSION_ES = '2026-07-12a';
```

- [ ] **Step 3: Build db + full suite**

```bash
pnpm build            # turbo — refresh db/dist so vitest resolves the new constant ([vitex-workspace-dist-resolution])
pnpm turbo run test --concurrency=1
```
Expected: green. A curriculum count/floor test may assert the version string — update it to match if it fails.

- [ ] **Step 4: Commit, push, PR2**

```bash
git add packages/db/src/curriculum/es.ts
git commit -m "chore(curriculum): bump CURRICULUM_VERSION_ES to re-enable suppressed ES cloze cells"
git push -u origin chore/es-curriculum-bump-uncork-cloze
ghp pr create --title "chore(curriculum): un-suppress ES cloze cells after context/seed fix" \
  --body "Bumps CURRICULUM_VERSION_ES so scheduler-decision clears skip-low-yield on es-a1-quantifiers-muy-mucho and es-a2-present-irregular-stem-changes (and other below-target ES cells), letting the next 04:00 UTC run re-attempt them on the fixed generation code. Merged only after #<PR1> is live. Expect a larger/costlier next ES run — intended.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 5: Verify recovery after 1–2 scheduled runs**

Query the prod branch (`br-green-waterfall-ancrvpr5`, project `twilight-smoke-01114337` — local `.env` is the stale dev branch, [local-env-db-is-dev-branch]):
```sql
SELECT grammar_point_key,
  count(*) FILTER (WHERE review_status='approved') AS approved
FROM exercises
WHERE grammar_point_key IN ('es-a1-quantifiers-muy-mucho','es-a2-present-irregular-stem-changes')
  AND type='cloze'
GROUP BY 1;
```
Expected: both `approved ≥ 3` (clear of the low-yield floor).

---

## Self-review notes

- **Spec coverage:** A (context) → Task 1; B (seed register) → Task 2; version bump → Task 1 Step 4; eval:gen gate → Task 4; split PRs → Tasks 1–4 (PR1) / Task 5 (PR2); curriculum bump + suppression → Task 5; success criteria (approved ≥ 3, context-spoils down) → Task 4 Step 4 + Task 5 Step 5. Non-goals (no validator/schema-type/window/vocab_lemma change) honored — no task touches them.
- **Deviation from spec (improvement):** enforcement moved from the system-prompt template to the tool schema + code user-prompt, so PR1 ships with the code deploy and needs **no `push-prompts`** (removes a manual step and the stale-worktree revert risk). Same learner-facing outcome.
- **Type consistency:** `CLOZE_GENERATION_TOOL`, `parseGeneratedClozeDraft`, `buildGenerationUserPrompt`, `GenerationPromptInputs.cefrLevel`, `GENERATION_PROMPT_VERSION`, `CURRICULUM_VERSION_ES` all match their definitions.
