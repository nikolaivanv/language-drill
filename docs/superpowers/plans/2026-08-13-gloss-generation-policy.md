# Gloss Generation Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two gloss-spoilage causes PR #642 could not fix by editing rows — the `contextSpoilsAnswer` veto that never named `glossEn`, and `de-a1-numbers-ordinals` never being flagged `digit-form` — and retire the stale TR ordinal pool.

**Architecture:** Four independent edits, each using a lever that already exists. Two prompt files (`generation-prompts.ts`, `validation-prompts.ts`) each get one edit cluster and one version bump; one curriculum entry gets the `digit-form` flag plus its required seed pool; one prod CLI run demotes the stale cell. No new curriculum field, no change to the A1–A2 gloss mandate.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces + Turborepo. Prompts are plain template strings in `packages/ai/src`; curriculum is plain TS data in `packages/db/src/curriculum`.

**Spec:** `docs/superpowers/specs/2026-08-13-gloss-generation-policy-design.md`

## Global Constraints

- **Worktree:** all work happens in `/Users/seal/dev/language-drill/.claude/worktrees/gloss-policy`, branch `fix/gloss-policy`. Prefix every absolute path with that root — a main-repo absolute path silently writes to the main checkout. Assert `git branch --show-current` returns `fix/gloss-policy` before every commit.
- **Prompt version bumps are mandatory.** Editing any `*_SYSTEM_PROMPT*` constant in `packages/ai/src/` requires bumping its `*_PROMPT_VERSION` to `@2026-08-13` in the same commit (CLAUDE.md → Prompt Editing). Version strings are also **pinned in tests** — grep for the old value and update every occurrence.
- **Generate↔validate contract:** a generation-side rule is nullified if the validator still rejects the shape it produces. Task 1 and Task 2 must both land before any `eval:gen` run is meaningful.
- **Do not touch:** the 54 Class A / 32 Class B row repairs, the 7-row parser gap, the 9 medium-confidence exclusions, the 56 empty-string glosses, the A1–A2 gloss mandate, or `infra/bin/app.ts` (the generation pause). All explicitly out of scope.
- **Setup already done in this worktree:** `pnpm install` and `pnpm build` have been run. If `packages/db` source is edited, re-run `pnpm build` before running Vitest — single-package tests resolve against `db/dist` and will otherwise read stale output.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/ai/src/validation-prompts.ts` | Validator system template + `VALIDATION_PROMPT_VERSION` | Modify: `contextSpoilsAnswer` field list (L170), new neutral-gloss sub-bullet after the gloss-consistency rule (L165), version bump (L120) |
| `packages/ai/src/validation-prompts.test.ts` | Validator prompt assertions | Modify: version pins at L193 and L928, new assertions |
| `packages/ai/src/generation-prompts.ts` | Generator system template + `GENERATION_PROMPT_VERSION` | Modify: anti-leak bullet (L444), version bump (L262), changelog comment |
| `packages/ai/src/generation-prompts.test.ts` | Generator prompt assertions | Modify: version pins at L350 and L443, new assertions |
| `packages/db/src/curriculum/de.ts` | German curriculum + `CURRICULUM_VERSION_DE` | Modify: `de-a1-numbers-ordinals` entry (L570), version bump (L107) |
| `packages/db/src/curriculum/curriculum.test.ts` | Curriculum invariants + flagged-entry assertions | Modify: add DE assertions to the `self-revealing elicitation — flagged entries` describe block (~L424) |
| `packages/ai/scripts/fixtures/cells-gloss-policy.json` | `eval:gen` cell dataset for the two affected cells | Create |

---

### Task 1: Validator — close the `contextSpoilsAnswer` field gap and mirror the neutral-gloss rule

The veto enumerates `instructions` or `context` and omits `glossEn`, so the gloss is rendered to the validator (since #639) but not covered by the rule that would reject it. Both validator edits land in one task so `VALIDATION_PROMPT_VERSION` is bumped once.

**Files:**
- Modify: `packages/ai/src/validation-prompts.ts:120` (version), `:165` (gloss-consistency block — append a sibling bullet), `:170` (`contextSpoilsAnswer` definition)
- Test: `packages/ai/src/validation-prompts.test.ts:193`, `:928` (version pins), plus new assertions

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `VALIDATION_PROMPT_VERSION === "validate@2026-08-13"`, consumed by Task 4's gate.

- [ ] **Step 1: Write the failing tests**

Add to `packages/ai/src/validation-prompts.test.ts`, inside the existing top-level `describe` that holds the L193 assertions (the "pins the prompt cluster" test's sibling — add as a new `it` in the same block):

```typescript
  it("contextSpoilsAnswer covers glossEn, not just instructions/context (2026-08-13)", async () => {
    const prompt = await buildValidationSystemPrompt(baseSpec);
    // #639 rendered `glossEn` to the validator; the veto's own field list was
    // never extended, so the one production catch was the model generalising.
    expect(prompt).toContain(
      "does the draft's `instructions`, `context`, or `glossEn`",
    );
  });

  it("carries the neutral-gloss rule for lexical-choice points (2026-08-13)", async () => {
    const prompt = await buildValidationSystemPrompt(baseSpec);
    expect(prompt).toContain("Neutral-gloss rule");
    expect(prompt).toContain("saber");
    expect(prompt).toContain("know how to");
    // The anti-rejection guard: a neutral gloss must NOT be flagged ambiguous
    // when the L2 sentence forces the reading, or the generator's new output
    // gets rejected by the validator and the change nets to zero.
    expect(prompt).toContain("is NOT `ambiguous` when the L2 sentence forces");
  });
```

`baseSpec` is the shared fixture already defined at the top of that file and used by every neighbouring test (e.g. `validation-prompts.test.ts:98`).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/gloss-policy
pnpm --filter @language-drill/ai test -- validation-prompts
```

Expected: the two new tests FAIL on the missing strings. The two version-pin assertions still PASS (not yet bumped).

- [ ] **Step 3: Extend the `contextSpoilsAnswer` field list**

In `packages/ai/src/validation-prompts.ts:170`, change the opening clause only — leave the rest of the bullet and all sub-bullets untouched:

```
3. **contextSpoilsAnswer** (boolean): does the draft's \`instructions\`, \`context\`, or \`glossEn\` (the learner-visible **Meaning** line) state the rule's outcome, name the required suffix/form, or otherwise let the learner write the answer without engaging with the blank?
```

Do **not** alter the existing carve-outs elsewhere in the file: `selfRevealingScoringNote` (`digit-form`, `base-word-cue`) and the `vocab_recall` note all deliberately narrow `contextSpoilsAnswer` for specific cells and must keep working.

- [ ] **Step 4: Add the neutral-gloss sub-bullet**

Immediately after the existing **Gloss consistency (cloze)** bullet (`validation-prompts.ts:165`), add a sibling bullet at the same indentation:

```
   - **Neutral-gloss rule (cloze, lexical-choice points):** where the target language lexicalises a distinction English collapses into ONE word — Spanish \`saber\`/\`poder\`, both glossed "can", where the blank tests which verb the meaning selects — the gloss MUST use the NEUTRAL English term and the L2 sentence MUST carry the contrast that forces the choice ("pero hoy no puede porque está cansada", "porque estudió mucho"). A gloss that reaches for the English lexical distinction ("know how to" for \`saber\`) or names the trigger ("(a learned skill)") is \`contextSpoilsAnswer = true\`. A neutral gloss is NOT \`ambiguous\` when the L2 sentence forces the reading — set \`ambiguous = true\` only when nothing in the L2 sentence disambiguates.
```

- [ ] **Step 5: Bump the version constant and its test pins**

`packages/ai/src/validation-prompts.ts:120`:

```typescript
export const VALIDATION_PROMPT_VERSION = "validate@2026-08-13";
```

Then update **both** pins in `packages/ai/src/validation-prompts.test.ts` — L193 (`expect(VALIDATION_PROMPT_VERSION).toBe("validate@2026-08-12")`, double quotes) and L928 (`'validate@2026-08-12'`, single quotes) — to `2026-08-13`, preserving each line's existing quote style.

Also add a changelog comment above the constant, matching the style already used there:

```typescript
// Bumped 2026-08-13 — contextSpoilsAnswer now names `glossEn` alongside
// `instructions`/`context` (#639 rendered the gloss but never extended the
// veto's field list), plus the neutral-gloss rule for lexical-choice points
// (saber/poder) mirroring the generator-side clause.
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @language-drill/ai test -- validation-prompts
```

Expected: PASS, including both version pins. If a *raw template size* budget test fails, report the numbers rather than trimming the new prose silently — the file has an explicit size-cap test and it is a real constraint.

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # must print fix/gloss-policy
git add packages/ai/src/validation-prompts.ts packages/ai/src/validation-prompts.test.ts
git commit -m "fix(ai): contextSpoilsAnswer covers glossEn; neutral-gloss rule for lexical-choice points

The veto enumerated \`instructions\` or \`context\` and omitted \`glossEn\`.
PR #639 rendered the gloss to the validator and added a gloss-consistency
rule scoped to acceptableAnswers, but never extended the spoil veto's own
field list — so the one production row it caught was the model
generalising past the written rule, not the rule working.

Also mirrors the generator-side neutral-gloss clause, including the
anti-rejection guard: a neutral gloss is not ambiguous when the L2
sentence forces the reading.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Generator — neutral-gloss clause in the anti-leak rule

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts:262` (version + changelog comment block ~L288-312), `:444` (anti-leak bullet)
- Test: `packages/ai/src/generation-prompts.test.ts:350`, `:443` (version pins), plus a new assertion

**Interfaces:**
- Consumes: nothing from Task 1 at the code level; the two are mirror halves of one contract and must both ship.
- Produces: `GENERATION_PROMPT_VERSION === "generate@2026-08-13"`, consumed by Task 4's gate.

- [ ] **Step 1: Write the failing test**

Add to `packages/ai/src/generation-prompts.test.ts`, in the same describe block as the existing anti-leak assertions (near L246):

```typescript
  it("anti-leak carries the neutral-gloss clause for lexical-choice points (2026-08-13)", async () => {
    const prompt = await buildGenerationSystemPrompt(baseInputs, []);
    expect(prompt).toContain("NEUTRAL English term");
    expect(prompt).toContain("saber/poder");
    expect(prompt).toContain("know how to");
    // The escape hatch matters: without it the generator pads a gloss it
    // cannot make safe rather than dropping it.
    expect(prompt).toContain("OMIT the gloss rather than leak it");
  });
```

`baseInputs` is the shared fixture already defined at the top of that file and used by every neighbouring test (e.g. `generation-prompts.test.ts:87`); the second argument is the stems array, empty here.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @language-drill/ai test -- generation-prompts
```

Expected: FAIL on the missing strings.

- [ ] **Step 3: Extend the anti-leak bullet**

Append to the end of the existing anti-leak bullet at `packages/ai/src/generation-prompts.ts:444` (after the sentence ending "…which remains in force."):

```
 **Neutral gloss for lexical-choice points.** Where {{language}} lexicalises or grammaticalises a distinction English collapses into ONE word, do NOT reach for the English distinction in \`glossEn\` — gloss with the NEUTRAL English term and make the L2 sentence carry the contrast that forces the choice. Spanish saber/poder is the canonical case: English "can" covers both, so gloss "can" and force the reading in Spanish ("Mi abuela ___ contar historias muy bien, pero hoy no puede porque está cansada" → \`sabe\`; "Mi hermana ___ hablar italiano muy bien porque estudió mucho" → \`sabe\`). A gloss saying "know how to" names the answer, and a parenthetical naming the trigger ("(a learned skill)") is the same defect. If the L2 sentence cannot be made to force the choice, OMIT the gloss rather than leak it.
```

- [ ] **Step 4: Bump the version constant and its test pins**

`packages/ai/src/generation-prompts.ts:262`:

```typescript
export const GENERATION_PROMPT_VERSION = "generate@2026-08-13";
```

Append to the existing dated changelog comment block (which runs to ~L312), matching its style:

```typescript
    // Bumped 2026-08-13 — anti-leak grew a neutral-gloss clause for points
    // where the L2 lexicalises a distinction English collapses into one word
    // (saber/poder): gloss with the neutral English term, force the contrast
    // in the L2 sentence, omit the gloss if it cannot be forced.
```

Update **both** pins in `packages/ai/src/generation-prompts.test.ts` — L350 and L443 — from `"generate@2026-08-11"` to `"generate@2026-08-13"`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @language-drill/ai test -- generation-prompts
```

Expected: PASS, including both version pins.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print fix/gloss-policy
git add packages/ai/src/generation-prompts.ts packages/ai/src/generation-prompts.test.ts
git commit -m "feat(ai): neutral-gloss clause in the generator anti-leak rule

Where the L2 lexicalises a distinction English collapses into one word,
a faithful gloss names the answer. es-a2-saber-poder-ability is the
canonical case: 'Do you know how to play the guitar?' hands over Sabes.

The fix is not to stop glossing. Half the existing pool already does it
right — neutral 'can' in the gloss, with the contrast forced inside the
Spanish ('pero hoy no puede porque está cansada'). This states that
shape as a rule, with an omit-the-gloss escape hatch when the L2
sentence cannot carry the contrast.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Flag `de-a1-numbers-ordinals` as `digit-form` with a curated seed pool

The only *live* ordinal leak. TR and ES carry this flag; DE never got it (1/17 approved rows use a digit cue, vs ES 19/19 post-directive).

**Files:**
- Modify: `packages/db/src/curriculum/de.ts:107` (version), `:570-590` (the `de-a1-numbers-ordinals` entry)
- Test: `packages/db/src/curriculum/curriculum.test.ts` — the `self-revealing elicitation — flagged entries` describe block (~L424)

**Interfaces:**
- Consumes: nothing.
- Produces: `getGrammarPoint('de-a1-numbers-ordinals').selfRevealingElicitation === 'digit-form'` with a non-empty `elicitationSeedValues`; `CURRICULUM_VERSION_DE === '2026-08-13'`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/db/src/curriculum/curriculum.test.ts` inside the existing `describe('self-revealing elicitation — flagged entries', …)` block:

```typescript
  // de-a1-numbers-ordinals was never flagged while TR and ES were, so it kept
  // generating written-word cues: 1/17 approved cloze rows carried a digit
  // cue, against 19/19 for es-a1-numbers-ordinals post-directive.
  it('de-a1-numbers-ordinals uses digit-form with a curated pool', () => {
    const entry = getGrammarPoint('de-a1-numbers-ordinals');
    expect(entry?.selfRevealingElicitation).toBe('digit-form');
    // Floor matches the existing digit-form pools (ES 28, TR 24).
    expect(entry?.elicitationSeedValues?.length ?? 0).toBeGreaterThanOrEqual(24);
  });

  it('the German pool seeds the forms the point actually gets wrong', () => {
    const entry = getGrammarPoint('de-a1-numbers-ordinals');
    const pool = entry?.elicitationSeedValues ?? [];
    // Irregular ordinals and the -te/-ste boundary at 20 (commonErrors 1).
    for (const hard of ['dritte', 'siebte', 'zwanzigste']) {
      expect(pool).toContain(hard);
    }
    // Units-before-tens compounds written as one word (commonErrors 2).
    expect(pool).toContain('einundzwanzig');
    // The declined date form, am + ordinal (commonErrors 3).
    expect(pool).toContain('achten');
    // Hundred-based year-reading, not tausend (commonErrors 4).
    expect(pool).toContain('neunzehnhundertachtundneunzig');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/gloss-policy
pnpm --filter @language-drill/db test -- curriculum
```

Expected: FAIL — `selfRevealingElicitation` is `undefined`.

- [ ] **Step 3: Add the flag and the pool**

In `packages/db/src/curriculum/de.ts`, in the `de-a1-numbers-ordinals` entry, add after the closing `]` of `commonErrors` (the entry has no `prerequisiteKeys`, so this goes last):

```typescript
    selfRevealingElicitation: 'digit-form',
    elicitationSeedValues: [
      // Irregular ordinals + the -te/-ste boundary at 20.
      'erste', 'dritte', 'siebte', 'achte', 'neunzehnte',
      'zwanzigste', 'einundzwanzigste', 'dreißigste', 'hundertste',
      // Declined date form (am + ordinal, weak -en).
      'ersten', 'dritten', 'siebten', 'achten', 'zwanzigsten',
      // Units-before-tens cardinal compounds, written as one word.
      'einundzwanzig', 'zweiundvierzig', 'siebenundsiebzig',
      'neunundneunzig', 'zweihundertdreißig', 'tausendzweihundert',
      // Year-reading: hundred-based, not tausend.
      'neunzehnhundertachtundneunzig', 'neunzehnhundertsiebzig',
      'zweitausendsechsundzwanzig',
      // -mal adverbs.
      'einmal', 'zweimal', 'dreimal', 'viermal',
      // eins vs ein/eine before a noun.
      'ein', 'eine',
    ],
```

29 values. The curriculum invariant at `packages/db/src/curriculum/index.ts:286` throws if the flag is set without a non-empty pool, and at `:292` if a pool is set without the flag — both must be satisfied together.

- [ ] **Step 4: Bump `CURRICULUM_VERSION_DE`**

`packages/db/src/curriculum/de.ts:107`:

```typescript
export const CURRICULUM_VERSION_DE = '2026-08-13';
```

Add a comment above it in the file's existing changelog style, noting the side effect:

```typescript
// 2026-08-13: de-a1-numbers-ordinals gains selfRevealingElicitation
// 'digit-form' + a curated pool — it was the only numbers/ordinals point
// never flagged, so it kept cueing the written word and leaking the answer
// through glossEn. Bump also clears skip-low-yield suppression, so other DE
// cells re-enqueue on the next generation run.
```

`curriculum.test.ts:983` asserts only a date-shaped regex, so no pin update is needed there.

- [ ] **Step 5: Rebuild and run the tests**

`packages/db` source changed, so `db/dist` must be rebuilt before Vitest resolves against it:

```bash
pnpm build
pnpm --filter @language-drill/db test -- curriculum
```

Expected: PASS.

- [ ] **Step 6: Run the generation tests that consume elicitation seeds**

Adding a flagged point changes which cells seed from a pool, so run the suites that exercise that path:

```bash
pnpm --filter @language-drill/db test -- run-one-cell-elicitation-seeds run-one-cell seed-picker cells
```

Expected: PASS. If a test enumerates flagged points or counts them, update it to include the DE point and report what you changed.

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # must print fix/gloss-policy
git add packages/db/src/curriculum/de.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "fix(db): flag de-a1-numbers-ordinals as digit-form

The only numbers/ordinals point never flagged. TR and ES both carry
selfRevealingElicitation 'digit-form'; DE did not, so it kept cueing the
written word and letting glossEn hand over the ordinal — 1/17 approved
cloze rows carried a digit cue, against 19/19 for es-a1-numbers-ordinals
after the 2026-07-08 directive landed.

The paired elicitationSeedValues pool (required by the curriculum
invariant) seeds the forms the point's own commonErrors name: irregular
ordinals, the -te/-ste boundary, the declined am + ordinal date form,
units-before-tens compounds and hundred-based year-reading.

Bumps CURRICULUM_VERSION_DE, which also clears skip-low-yield
suppression for other DE cells.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Full gate + `eval:gen` A/B — the decision point for the neutral-gloss clause

The spec flags Task 2's clause as the only change carrying real risk: it asserts a neutral-"can" gloss is non-ambiguous *when* the Spanish forces the contrast, read off ~12 existing rows rather than measured. **This task is what tests it, and it can send Task 2 back.**

**Files:**
- Create: `packages/ai/scripts/fixtures/cells-gloss-policy.json`

**Interfaces:**
- Consumes: `GENERATION_PROMPT_VERSION` and `VALIDATION_PROMPT_VERSION` from Tasks 1–2; the DE flag from Task 3.
- Produces: a run report under `packages/ai/eval-runs/gloss-policy-2026-08-13.json`.

- [ ] **Step 1: Create the cell dataset**

`packages/ai/scripts/fixtures/cells-gloss-policy.json`, following the shape of the existing `cells-self-revealing.json`:

```json
[
  { "language": "ES", "cefrLevel": "A2", "exerciseType": "cloze", "grammarPointKey": "es-a2-saber-poder-ability" },
  { "language": "DE", "cefrLevel": "A1", "exerciseType": "cloze", "grammarPointKey": "de-a1-numbers-ordinals" },
  { "language": "DE", "cefrLevel": "A1", "exerciseType": "translation", "grammarPointKey": "de-a1-numbers-ordinals" }
]
```

- [ ] **Step 2: Run the full gate**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/gloss-policy
pnpm lint && pnpm typecheck
pnpm test
```

Expected: lint and typecheck clean. `pnpm test` has a known parallel-contention failure on `infra/lambda` (~120,800 ms, varying victim test) documented in PR #642 — if it appears, re-run with the config's own control and report both results:

```bash
pnpm test -- --concurrency=1
```

Do not claim the suite is green on the serial run alone without saying so explicitly.

- [ ] **Step 3: Run the `eval:gen` A/B**

Baseline is the currently-live Langfuse body (a prompt push only affects future runs, so `repo` is the only way to test the edit pre-merge):

```bash
pnpm eval:gen \
  --baseline langfuse:generate-system-prompt@production \
  --candidate repo \
  --dataset-file ./packages/ai/scripts/fixtures/cells-gloss-policy.json \
  --drafts-per-cell 5 \
  --max-cost-usd 5 \
  --run-name gloss-policy-2026-08-13
```

Confirm the exact flag spellings against the script header at `packages/ai/scripts/eval-gen-run.ts:9-20` before running, and note that `pnpm <script> -- --flag` throws for `packages/ai` CLIs — pass flags directly as above. If the run needs `--allow-prod` to read against the prod DB, stop and ask before adding it.

- [ ] **Step 4: Read the result and decide**

The run writes `./eval-runs/<runName>.json` relative to its own working directory (`packages/ai` under the workspace filter) and prints the path — open the path it printed and compare candidate vs baseline on the `es-a2-saber-poder-ability` cell specifically:

- **Approval rate up or flat, `ambiguous` flags flat or down** → the clause holds. Proceed.
- **`ambiguous` flags up on that cell** → the clause is wrong as written. Narrow it to banning only the trigger-naming parenthetical ("(a learned skill)"), drop the positive "gloss neutrally, force in-L2" guidance from both Task 1 and Task 2 prose, re-run this step, and report the before/after numbers.

Report the actual numbers either way — approval rate, rejection reasons, flag tags per arm. Do not report a verdict without them.

- [ ] **Step 5: Commit the dataset and a findings note**

```bash
git branch --show-current   # must print fix/gloss-policy
git add packages/ai/scripts/fixtures/cells-gloss-policy.json
git commit -m "test(ai): eval:gen cell dataset for the gloss-policy change

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Then write the run's numbers into `docs/analysis/gloss-policy-evalgen-2026-08-13.md` (approval rate and flag-tag deltas per arm per cell, plus the decision taken in Step 4) and commit it separately. `eval-runs/` is gitignored — the committed note is the only durable record, and PR #642's sweep artifact was lost exactly this way.

---

### Task 5: Demote the stale TR ordinal cell

**Prod write. Requires explicit user confirmation before `--apply`.**

All 20 approved `tr-a1-numbers-ordinals` cloze rows were generated 2026-05-30 → 06-16, weeks before the `digit-form` directive; 0/20 carry a digit cue. `pool-hygiene` leaves learner scores untouched (unlike `quality` / `learner-flag`), which is correct: the rows are stale relative to a directive, not defective enough to revoke credit for.

**Accepted trade (spec):** nightly pre-generation is paused in prod (`infra/bin/app.ts:54`), so the cell sits thin until generation resumes.

**Files:** none — CLI only.

**Interfaces:** consumes the `digit-form` behaviour confirmed in Task 4.

- [ ] **Step 1: Dry-run**

`packages/db/scripts/demote-cell-pool.ts:68` requires all four cell filters:

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/gloss-policy
pnpm demote:pool --language TR --cefr A1 --type cloze \
  --grammar-point tr-a1-numbers-ordinals --reason pool-hygiene
```

The script's header comments show a `pnpm demote:pool -- --flag` form; if the invocation above errors on argument parsing, retry with the `--` separator and record which form worked.

Expected: a dry-run report naming ~20 rows and no writes.

- [ ] **Step 2: Confirm the target database**

The local `.env` points at the Neon **dev** branch by default; prod is project `twilight-smoke-01114337`, branch `br-green-waterfall-ancrvpr5`. Print which database the dry-run hit and confirm it is the intended one **before** applying. Demoting the dev branch achieves nothing; demoting prod unintentionally is worse.

- [ ] **Step 3: Stop and ask**

Report the dry-run row count and target database to the user and request explicit approval to run with `--apply`. Do not apply without it.

- [ ] **Step 4: Apply (only after approval)**

```bash
pnpm demote:pool --language TR --cefr A1 --type cloze \
  --grammar-point tr-a1-numbers-ordinals --reason pool-hygiene --apply
```

Expected: ~20 rows demoted, `demotion_reason = 'pool-hygiene'`, no mastery reminder printed (that reminder appears only for `quality` / `learner-flag`). If a mastery-stale reminder *does* appear, stop — the wrong reason was passed.

- [ ] **Step 5: Record the result**

Append the applied row count and timestamp to `docs/analysis/gloss-policy-evalgen-2026-08-13.md` and commit.

---

## Post-merge (not part of any task — do after the PR lands)

Both prompt bodies changed, so Langfuse must be synced or production keeps serving the old text:

```bash
# From a FRESH main checkout — push-prompts syncs ALL drifted prompts, so
# pushing from a stale worktree reverts unrelated ones.
PK=$(aws --region eu-central-1 secretsmanager get-secret-value \
  --secret-id language-drill/LANGFUSE_PUBLIC_KEY --query SecretString --output text)
SK=$(aws --region eu-central-1 secretsmanager get-secret-value \
  --secret-id language-drill/LANGFUSE_SECRET_KEY --query SecretString --output text)
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai push-prompts --dry-run
```

Then apply, then repeat the whole block for dev (`language-drill-dev/` prefix). Record the prior version numbers `push-prompts` logs — they are the revert target. Confirm with `bootstrap-prompts --check` (exit 0 = no drift).

---

## Out of scope (do not drift into these)

- The 54 Class A row repairs and 32 Class B rows — their row IDs need a sweep re-run first, the #642 artifact is gone.
- The 7 rows lost to the parser rejecting `loadBearing: true` + `proposedGloss: null`.
- The 9 medium-confidence point exclusions; the 56 `glossEn: ""` rows.
- Narrowing the A1–A2 gloss mandate generally.
- Resuming exercise generation (`infra/bin/app.ts:54`).
