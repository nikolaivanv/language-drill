# Closing the open `qa:sample` prod findings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three untouched 2026-07-22 production `qa:sample` findings — re-measure them against today's prompts, stop the evaluator passing answers that omit an obligatory determiner, repair any surviving underdetermined cloze row in place, and make prod QA reports durable records.

**Architecture:** Measurement gates everything. Task 2 re-runs the flagged scopes at `--seed 1` against prod; only findings that reproduce get fixed. The evaluator fix is a paragraph appended to `EVALUATION_SYSTEM_PROMPT`, verified by a Langfuse dataset A/B (`pnpm eval --candidate file:…` injects a prompt body as `systemPromptOverride`, so no Langfuse write is needed to test it), then pushed per environment because it is a **system**-prompt edit. The cloze repair is a targeted `jsonb_set` on prod rows, not a demotion, because nightly generation is paused.

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Vitest, Neon Postgres (via Neon MCP), Anthropic SDK, Langfuse (prompt registry + datasets), `packages/ai` author-run CLIs (`qa:sample`, `eval:seed`, `eval`, `push-prompts`, `bootstrap-prompts`).

**Spec:** `docs/superpowers/specs/2026-08-11-qa-sample-findings-followup-design.md`

## Global Constraints

- **Workspace:** all work happens in the existing worktree `/Users/seal/dev/language-drill/.claude/worktrees/qa-sample-findings-followup` on branch `fix/qa-sample-findings-followup`. Assert the branch (`git branch --show-current`) before every commit — this workspace has been observed flipping to `main`. Never use main-checkout absolute paths (`/Users/seal/dev/language-drill/<path>`) for edits; always prefix with the worktree root.
- **`pnpm <script> -- --flag` is broken for every `packages/ai` CLI.** Pass flags without the `--` separator: `pnpm --filter @language-drill/ai qa:sample --language ES …`.
- **`qa:sample` casing:** `--language`/`--cefr` are normalized to uppercase by the CLI, but pass them uppercase anyway (`ES`, `A1`); `--type` stays lowercase (`cloze`).
- **The output-name flag is `--out`**, not `--name`. Reports land at `packages/ai/qa-runs/<out>.json`.
- **Prod credentials are never inlined into a Bash command** (the classifier blocks it). Write `DATABASE_URL` + `ANTHROPIC_API_KEY` to a scratchpad env file, invoke via `pnpm exec dotenv -e <file> --`, then delete the file.
- **Every prod AI run is backgrounded** (`run_in_background: true`) and carries `--max-cost-usd`. Sequential sampling exceeds the 2-minute foreground Bash timeout.
- **Prod DB coordinates:** project `twilight-smoke-01114337`, branch `br-green-waterfall-ancrvpr5`. The local `.env` `DATABASE_URL` points at the **dev** branch.
- **Prompt-edit protocol:** any semantic edit to `EVALUATION_SYSTEM_PROMPT` bumps `EVALUATION_SYSTEM_PROMPT_VERSION` to `evaluate@2026-08-11` in the **same commit**, and requires a Langfuse `push-prompts` per environment after merge — the in-repo constant is only the fallback body.
- **Pre-push gate:** `pnpm lint && pnpm typecheck && pnpm test` from the worktree root, zero failures. Symlink `esbuild` into root `node_modules` first if the CDK synth tests error with exit 254.
- **Do not run `demote:pool` or `backfill:mastery` anywhere in this plan.** The chosen repair is content-only; mastery and history stay untouched.

## File Structure

| File | Responsibility |
|---|---|
| `docs/analysis/qa-run-2026-07-22-prod-*.json` (create ×3) | Durable copies of the original prod reports. |
| `docs/analysis/qa-sample-findings-2026-08-11.md` (create) | The re-measurement record: which findings survived, which closed, with evidence. |
| `.gitignore` (modify, ~line 64) | Ignore `packages/ai/qa-runs/` beside the existing `packages/ai/audit-runs/` entry. |
| `packages/ai/scripts/fixtures/eval-obligatory-determiners.json` (create) | Three hand-curated obligatory-determiner failure cases, each carrying its observed baseline output. |
| `packages/ai/scripts/eval-seed.test.ts` (modify, after the `fixtures/eval-hard-morphology.json` describe block ending ~line 107) | Assert the new fixture parses and covers its three cases. |
| `packages/ai/src/prompts.ts` (modify: the optional-elements paragraph in `buildTranslationUserPrompt`'s sibling — see Task 6 for the exact anchor; and `EVALUATION_SYSTEM_PROMPT_VERSION` ~line 76) | The obligatory-determiner rule + version bump + dated comment. |

---

### Task 1: Make the existing prod reports durable

No gate — do this first so the records survive `git clean` and worktree removal.

**Files:**
- Create: `docs/analysis/qa-run-2026-07-22-prod-smoke-es-a1.json`
- Create: `docs/analysis/qa-run-2026-07-22-prod-tr-b1-sc.json`
- Create: `docs/analysis/qa-run-2026-07-22-prod-es-b1-cloze.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the three reports already copied into `packages/ai/qa-runs/` in this worktree.
- Produces: committed report paths referenced by Task 2's findings note.

- [ ] **Step 1: Confirm the source reports are present in the worktree**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/qa-sample-findings-followup
ls -la packages/ai/qa-runs/
```

Expected: `prod-es-b1-cloze.json`, `prod-smoke-es-a1.json`, `prod-tr-b1-sc.json`. If any is missing, copy it from the main checkout: `cp /Users/seal/dev/language-drill/packages/ai/qa-runs/<file> packages/ai/qa-runs/`.

- [ ] **Step 2: Copy them into `docs/analysis/` with dated names**

```bash
cp packages/ai/qa-runs/prod-smoke-es-a1.json  docs/analysis/qa-run-2026-07-22-prod-smoke-es-a1.json
cp packages/ai/qa-runs/prod-tr-b1-sc.json     docs/analysis/qa-run-2026-07-22-prod-tr-b1-sc.json
cp packages/ai/qa-runs/prod-es-b1-cloze.json  docs/analysis/qa-run-2026-07-22-prod-es-b1-cloze.json
```

Content is copied verbatim — do not reformat or strip fields.

- [ ] **Step 3: Ignore the run-output directory**

In `.gitignore`, immediately after these existing lines:

```
# audit:collapse run output (commit interesting runs to docs/analysis/ instead)
packages/ai/audit-runs/
```

add:

```
# qa:sample run output (commit interesting runs to docs/analysis/ instead)
packages/ai/qa-runs/
```

- [ ] **Step 4: Verify the ignore takes effect and the copies are tracked**

```bash
git check-ignore -v packages/ai/qa-runs/prod-es-b1-cloze.json
git status --short
```

Expected: `check-ignore` prints the new `.gitignore` line; `git status` shows the three new `docs/analysis/` files and the modified `.gitignore`, and **no** `packages/ai/qa-runs/` entry.

- [ ] **Step 5: Commit**

```bash
test "$(git branch --show-current)" = "fix/qa-sample-findings-followup" || exit 1
git add .gitignore docs/analysis/qa-run-2026-07-22-prod-*.json
git commit -m "docs(qa): keep the 2026-07-22 prod qa:sample reports as records

The three production qa:sample runs lived only as untracked files in
packages/ai/qa-runs/. Commit them under docs/analysis/ and ignore the
run-output directory, matching the audit-runs convention.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Re-measure the findings at seed 1 against prod

**This task gates Tasks 3–10 (evaluator fix) and Task 11 (cloze repair).** Total budget ~$1.15.

**Files:**
- Create: `docs/analysis/qa-sample-findings-2026-08-11.md`
- Create (gitignored, not committed): `packages/ai/qa-runs/prod-*-2026-08-11-seed1.json`

**Interfaces:**
- Consumes: prod pool; the four flagged exercise ids from the 2026-07-22 reports.
- Produces: the survival verdict per finding, consumed by Task 3 (`gustar` survived?) and Task 11 (which cloze rows survived?).

- [ ] **Step 1: Fetch the prod connection string and write the scratchpad env file**

Use the Neon MCP `get_connection_string` tool with `projectId: twilight-smoke-01114337`, `branchId: br-green-waterfall-ancrvpr5`. Write the env file with the Write tool (never echo a credential through Bash):

Path: `/private/tmp/claude-502/-Users-seal-dev-language-drill/<session>/scratchpad/prod-qa.env`

```
DATABASE_URL=<connection string from Neon MCP>
ANTHROPIC_API_KEY=<value of ANTHROPIC_API_KEY from the worktree .env>
```

- [ ] **Step 2: Re-run the ES A1 smoke scope (the `gustar` finding)**

Run backgrounded from the worktree root:

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/qa-sample-findings-followup
pnpm exec dotenv -e /private/tmp/claude-502/-Users-seal-dev-language-drill/<session>/scratchpad/prod-qa.env -- \
  pnpm --filter @language-drill/ai qa:sample \
  --language ES --cefr A1 --per-point 1 --limit 5 --seed 1 \
  --max-cost-usd 0.5 --out prod-smoke-es-a1-2026-08-11-seed1
```

Expected: exits 0, writes `packages/ai/qa-runs/prod-smoke-es-a1-2026-08-11-seed1.json`, ~$0.25.

- [ ] **Step 3: Re-run the three ES B1 cloze points**

Three separate backgrounded runs (same `dotenv` prefix as Step 2, elided here for brevity — include it in each):

```bash
pnpm --filter @language-drill/ai qa:sample --language ES --cefr B1 --type cloze \
  --grammar-point es-b1-deber-obligation-probability --per-point 2 --seed 1 \
  --max-cost-usd 0.5 --out prod-deber-2026-08-11-seed1

pnpm --filter @language-drill/ai qa:sample --language ES --cefr B1 --type cloze \
  --grammar-point es-b1-collective-agreement --per-point 2 --seed 1 \
  --max-cost-usd 0.5 --out prod-collective-2026-08-11-seed1

pnpm --filter @language-drill/ai qa:sample --language ES --cefr B1 --type cloze \
  --grammar-point es-b1-adjective-de-infinitive --per-point 2 --seed 1 \
  --max-cost-usd 0.5 --out prod-adj-de-inf-2026-08-11-seed1
```

The third run exists only to confirm the crafter-error reading — a flag there is expected and will be dismissed, not fixed.

- [ ] **Step 4: Classify each finding**

For each of the four original flags, apply the decision rule: **survived** = the same `flags` reason fires on the **same `exerciseId`**. Compare against these originals:

| Exercise id | Point | Original reason |
|---|---|---|
| `09d08beb-fa80-5f79-907a-cd0541f7c874` | `es-a1-gustar-basic` | `false_positive` (wrong answer scored 0.85) |
| `1c8afa03-50f9-566b-9adc-f8578e7b606a` | `es-b1-deber-obligation-probability` | `acceptable_answers_gap` (alt `Debo` → 0.35) |
| `ca70d729-2619-5421-8c5f-16cdd77d4e60` | `es-b1-collective-agreement` | `acceptable_answers_gap` (alt `interpretó` → 0.3) |
| `42183fad-caa9-5d8d-b95f-c04104ca2f74` | `es-b1-adjective-de-infinitive` | `acceptable_answers_gap` (alt `(nothing)` → 0) |

Note: a re-run samples the point's approved rows deterministically for a given seed, but the pool may have changed since July. If a target id is **absent** from the new report, record it as "not re-sampled" — that is not the same as "cleared".

- [ ] **Step 5: Write the findings record**

Create `docs/analysis/qa-sample-findings-2026-08-11.md` containing, for each of the four flags: the exercise id, grammar point, original reason and scores, the new scores, the verdict (`survived` / `closed by #612` / `dismissed — crafter error` / `not re-sampled`), and the report filename it came from. Also record the total cost of the re-measurement and a one-line statement of the decision rule used.

- [ ] **Step 6: Delete the credential file**

```bash
rm -f /private/tmp/claude-502/-Users-seal-dev-language-drill/<session>/scratchpad/prod-qa.env
```

- [ ] **Step 7: Commit the record**

```bash
test "$(git branch --show-current)" = "fix/qa-sample-findings-followup" || exit 1
git add docs/analysis/qa-sample-findings-2026-08-11.md
git commit -m "docs(qa): record the seed-1 re-measurement of the prod qa:sample findings

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Report the gate outcome**

State explicitly which of Tasks 3–10 and Task 11 are in scope:
- `gustar` survived → Tasks 3–10 run. Cleared → **skip Tasks 3–10**, note the closure, and go to Task 11.
- Any cloze flag survived → Task 11 runs for those ids only. All cleared → skip Task 11.

---

### Task 3: Capture the true baseline outputs for the fixture

Runs only if the `gustar` finding survived Task 2. `eval:seed` is idempotent on `seedKey` and **skips** existing items, so a fixture seeded with a guessed baseline can never be corrected in place — the real baselines must be captured before seeding. `expectedOutput` is the baseline side of `pnpm eval`'s delta computation, so a wrong value silently corrupts the A/B.

**Files:**
- Create (scratchpad, not committed): `<scratchpad>/probe-baseline.ts`, `<scratchpad>/baseline.json`

**Interfaces:**
- Consumes: `evaluateAnswer(client: Anthropic, input: EvaluateAnswerInput)` from `@language-drill/ai`; `ANTHROPIC_API_KEY` from the worktree `.env`.
- Produces: `baseline.json` — an array of three `EvaluationResult` objects in the order (es-gustar-mass-noun, es-gustar-generic-plural, de-prepositional-phrase), pasted into Task 4's fixture.

- [ ] **Step 1: Write the probe script**

Create `<scratchpad>/probe-baseline.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "node:fs";
import { evaluateAnswer } from "@language-drill/ai";

const client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });

const CASES = [
  {
    exercise: {
      type: "translation" as const,
      instructions: "Translate the sentence into Spanish, using a gustar-type construction.",
      sourceText: "I don't like beer.",
      sourceLanguage: "EN" as const,
      targetLanguage: "ES" as const,
      referenceTranslation: "No me gusta la cerveza.",
    },
    userAnswer: "No me gusta cerveza.",
    language: "ES" as const,
    difficulty: "A1" as const,
  },
  {
    exercise: {
      type: "translation" as const,
      instructions: "Translate the sentence into Spanish, using a gustar-type construction.",
      sourceText: "I don't like horror films.",
      sourceLanguage: "EN" as const,
      targetLanguage: "ES" as const,
      referenceTranslation: "No me gustan las películas de terror.",
    },
    userAnswer: "No me gustan películas de terror.",
    language: "ES" as const,
    difficulty: "A2" as const,
  },
  {
    exercise: {
      type: "translation" as const,
      instructions: "Translate the sentence into German.",
      sourceText: "I go to work by bus.",
      sourceLanguage: "EN" as const,
      targetLanguage: "DE" as const,
      referenceTranslation: "Ich fahre mit dem Bus zur Arbeit.",
    },
    userAnswer: "Ich fahre mit Bus zur Arbeit.",
    language: "DE" as const,
    difficulty: "A2" as const,
  },
];

const results = [];
for (const input of CASES) {
  results.push(await evaluateAnswer(client, input));
}
writeFileSync("baseline.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
```

- [ ] **Step 2: Run it against the current prompt**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/qa-sample-findings-followup/packages/ai
pnpm exec dotenv -e ../../.env -- pnpm exec tsx <scratchpad>/probe-baseline.ts
```

Expected: three JSON objects, each with `score`, `grammarAccuracy`, `errors`, `feedback`, `vocabularyRange`, `estimatedCefrEvidence`. The first should reproduce the finding — `score` ≥ 0.8 and/or no grammar error naming the missing article. Note: this call resolves the system prompt from **Langfuse** (the in-repo constant is only the fallback), which is exactly the body we are about to change, so this is the correct baseline.

- [ ] **Step 3: Record what the baseline actually showed**

If the first case does **not** reproduce (score < 0.8 with a grammar error on the article), stop and report: the live Langfuse body may already differ from the in-repo fallback. Do not proceed to Task 4 without confirming with the user — the premise of the fix would be gone.

No commit (scratchpad only).

---

### Task 4: Add the obligatory-determiner fixture and its test

**Files:**
- Create: `packages/ai/scripts/fixtures/eval-obligatory-determiners.json`
- Modify: `packages/ai/scripts/eval-seed.test.ts` (append a describe block after the existing `fixtures/eval-hard-morphology.json` block, which ends ~line 107)

**Interfaces:**
- Consumes: `parseSeedFixture` (already exported from `packages/ai/scripts/eval-seed.ts`); the `baseline.json` values from Task 3.
- Produces: dataset name `eval-obligatory-determiners` and seed keys `es-gustar-mass-noun-missing-article`, `es-gustar-generic-plural-missing-article`, `de-prepositional-phrase-missing-article`, consumed by Tasks 5 and 7.

- [ ] **Step 1: Write the failing test**

Append to `packages/ai/scripts/eval-seed.test.ts`:

```ts
describe("fixtures/eval-obligatory-determiners.json", () => {
  it("parses and covers the three obligatory-determiner cases", () => {
    const raw = JSON.parse(
      readFileSync(
        path.join(here, "fixtures", "eval-obligatory-determiners.json"),
        "utf8",
      ),
    );
    const fixture = parseSeedFixture(raw);
    expect(fixture.dataset).toBe("eval-obligatory-determiners");
    const keys = fixture.items.map((i) => i.seedKey);
    expect(keys).toContain("es-gustar-mass-noun-missing-article");
    expect(keys).toContain("es-gustar-generic-plural-missing-article");
    expect(keys).toContain("de-prepositional-phrase-missing-article");
    // Each baseline is the observed over-lenient output, so the eval diff
    // shows movement against the recorded failure — not a hand-idealized target.
    for (const item of fixture.items) {
      expect(item.expectedOutput).toHaveProperty("score");
      expect(item.expectedOutput).toHaveProperty("grammarAccuracy");
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/qa-sample-findings-followup
pnpm --filter @language-drill/ai test -- eval-seed
```

Expected: FAIL — `ENOENT` on `fixtures/eval-obligatory-determiners.json`.

- [ ] **Step 3: Write the fixture**

Create `packages/ai/scripts/fixtures/eval-obligatory-determiners.json`. The three `input` blocks are exactly the `CASES` from Task 3's probe. Each `expectedOutput` is the **corresponding object from `baseline.json`, verbatim** (all of `score`, `grammarAccuracy`, `errors`, `feedback`, `vocabularyRange`, `estimatedCefrEvidence`) — do not hand-write or round these values.

```json
{
  "dataset": "eval-obligatory-determiners",
  "description": "Hand-curated cases where the production evaluator accepted a translation that omits a determiner the target grammar requires. Item 1 is the real prod exercise 09d08beb-fa80-5f79-907a-cd0541f7c874 (es-a1-gustar-basic) flagged false_positive at 0.85 by qa:sample on 2026-07-22. expectedOutput is the OBSERVED over-lenient baseline, captured 2026-08-11 against the live Langfuse body — not the ideal answer. Seeded by scripts/eval-seed.ts.",
  "items": [
    {
      "seedKey": "es-gustar-mass-noun-missing-article",
      "note": "MISSED ERROR. 'No me gusta cerveza' omits the obligatory definite article before a mass-noun gustar subject; correct is 'No me gusta la cerveza'. qa:sample scored this 0.85 — above PASS_THRESHOLD (0.8) — so an ungrammatical answer earned mastery credit. A good evaluation reports a grammar error on the missing article and scores below 0.8.",
      "input": { "exercise": { "type": "translation", "instructions": "Translate the sentence into Spanish, using a gustar-type construction.", "sourceText": "I don't like beer.", "sourceLanguage": "EN", "targetLanguage": "ES", "referenceTranslation": "No me gusta la cerveza." }, "userAnswer": "No me gusta cerveza.", "language": "ES", "difficulty": "A1" },
      "expectedOutput": { "...": "baseline.json[0] verbatim" }
    },
    {
      "seedKey": "es-gustar-generic-plural-missing-article",
      "note": "Same class, generic plural: 'No me gustan películas de terror' needs 'las'. Included so the rule is exercised beyond the single mass-noun surface.",
      "input": { "exercise": { "type": "translation", "instructions": "Translate the sentence into Spanish, using a gustar-type construction.", "sourceText": "I don't like horror films.", "sourceLanguage": "EN", "targetLanguage": "ES", "referenceTranslation": "No me gustan las películas de terror." }, "userAnswer": "No me gustan películas de terror.", "language": "ES", "difficulty": "A2" },
      "expectedOutput": { "...": "baseline.json[1] verbatim" }
    },
    {
      "seedKey": "de-prepositional-phrase-missing-article",
      "note": "German counterpart: 'mit Bus' omits the obligatory dative article ('mit dem Bus'). Guards the cross-language half of the rule.",
      "input": { "exercise": { "type": "translation", "instructions": "Translate the sentence into German.", "sourceText": "I go to work by bus.", "sourceLanguage": "EN", "targetLanguage": "DE", "referenceTranslation": "Ich fahre mit dem Bus zur Arbeit." }, "userAnswer": "Ich fahre mit Bus zur Arbeit.", "language": "DE", "difficulty": "A2" },
      "expectedOutput": { "...": "baseline.json[2] verbatim" }
    }
  ]
}
```

The `"...": "baseline.json[N] verbatim"` entries are instructions, not literal content: replace each whole `expectedOutput` object with the captured result. The fixture must contain no such marker when committed.

- [ ] **Step 4: Run the test to confirm it passes**

```bash
pnpm --filter @language-drill/ai test -- eval-seed
```

Expected: PASS, including the pre-existing `eval-hard-morphology` and `seedDatasetFromFixture` blocks.

- [ ] **Step 5: Commit**

```bash
test "$(git branch --show-current)" = "fix/qa-sample-findings-followup" || exit 1
git add packages/ai/scripts/fixtures/eval-obligatory-determiners.json packages/ai/scripts/eval-seed.test.ts
git commit -m "test(eval): fixture for obligatory-determiner over-acceptance

Three cases where the evaluator accepted a translation missing a determiner
the target grammar requires, led by the real prod es-a1-gustar-basic row that
qa:sample flagged false_positive at 0.85. Baselines captured against the live
prompt on 2026-08-11.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Seed the dataset into Langfuse (dev)

**Files:** none (writes to Langfuse only).

**Interfaces:**
- Consumes: the fixture from Task 4; `LANGFUSE_*` keys from the worktree `.env`.
- Produces: Langfuse dataset `eval-obligatory-determiners` with three items, consumed by Task 7.

- [ ] **Step 1: Seed**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/qa-sample-findings-followup/packages/ai
pnpm exec dotenv -e ../../.env -- pnpm exec tsx scripts/eval-seed.ts --file scripts/fixtures/eval-obligatory-determiners.json
```

Expected: `[eval-seed] dataset='eval-obligatory-determiners' created=3 skipped=0`. The script refuses to write when `LANGFUSE_ENV=prod` without `--allow-prod`; do **not** pass `--allow-prod` — dev is the correct target for an eval dataset.

- [ ] **Step 2: Verify idempotency**

Re-run the identical command. Expected: `created=0 skipped=3`.

No commit.

---

### Task 6: Add the obligatory-determiner rule to the evaluator system prompt

**Files:**
- Modify: `packages/ai/src/prompts.ts` — the optional-elements paragraph at the end of `buildTranslationUserPrompt`'s template literal, and `EVALUATION_SYSTEM_PROMPT_VERSION` (~line 76) with its comment block.

**Interfaces:**
- Consumes: nothing from earlier tasks except the Task 2 gate.
- Produces: the edited prompt body, dumped to a file for Task 7's `--candidate`; `EVALUATION_SYSTEM_PROMPT_VERSION === "evaluate@2026-08-11"`.

**Note on placement.** The optional-elements paragraph currently lives in the **translation user prompt** builder (`buildTranslationUserPrompt`), not in `EVALUATION_SYSTEM_PROMPT`. Verify this before editing:

```bash
grep -n "Grammatically OPTIONAL elements" packages/ai/src/prompts.ts
```

The rule goes in the **same string as that paragraph**, so the contrast reads as one unit. This has a consequence the spec's wording glossed: if the paragraph is user-prompt-only, the edit ships with the **code deploy** and needs **no** Langfuse push — Task 9 then reduces to a version-bump note. Record which case holds and say so explicitly when reporting this task; do not assume.

- [ ] **Step 1: Dump the current prompt body as the A/B baseline arm**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/qa-sample-findings-followup/packages/ai
pnpm exec tsx -e 'import {EVALUATION_SYSTEM_PROMPT} from "./src/index.js"; process.stdout.write(EVALUATION_SYSTEM_PROMPT)' > <scratchpad>/prompt-baseline.txt
wc -c <scratchpad>/prompt-baseline.txt
```

Expected: a non-empty file (several KB).

- [ ] **Step 2: Append the rule to the optional-elements paragraph**

Immediately after the paragraph's final sentence ("…Treat these elements as wrong only when the exercise instructions explicitly drill the distinction or their presence/absence genuinely changes the meaning."), add:

```
The converse also holds: elements the target grammar REQUIRES are not in this optional class. A Spanish definite article before a generic or mass noun ("No me gusta la cerveza", not "…gusta cerveza") and a German article where the noun phrase demands one are obligatory; omitting one is a grammatical error — record it and lower grammarAccuracy and score. Do not treat an obligatory omission as a stylistic or dialectal variant.
```

Keep it inside the same template literal, as one paragraph continuation. Escape nothing beyond what the surrounding string already escapes (note the existing `\`` escaping convention in that file).

- [ ] **Step 3: Bump the version constant and document the edit**

Change `EVALUATION_SYSTEM_PROMPT_VERSION` to `"evaluate@2026-08-11"` and add to the comment block above it, following the existing dated-entry style:

```
// 2026-08-11: the optional-elements paragraph gained its converse — determiners
// the target grammar REQUIRES (ES definite article on a generic/mass gustar
// subject, DE article in a prepositional phrase) are not optional, and omitting
// one is a grammatical error. Closes the qa:sample prod false_positive where
// "No me gusta cerveza" scored 0.85, above the 0.8 pass threshold.
```

- [ ] **Step 4: Dump the candidate body and confirm the diff is exactly the new paragraph**

```bash
pnpm exec tsx -e 'import {EVALUATION_SYSTEM_PROMPT} from "./src/index.js"; process.stdout.write(EVALUATION_SYSTEM_PROMPT)' > <scratchpad>/prompt-candidate.txt
diff <scratchpad>/prompt-baseline.txt <scratchpad>/prompt-candidate.txt
```

If the paragraph turned out to live in the user prompt (see the note above), the two dumps are **identical** — that is expected, and Task 7 must then A/B via the user-prompt path instead: skip `--candidate` and run the probe script from Task 3 against the edited code, comparing to `baseline.json`. Report which route you took.

- [ ] **Step 5: Typecheck and test**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/qa-sample-findings-followup
pnpm --filter @language-drill/ai typecheck && pnpm --filter @language-drill/ai test
```

Expected: both pass. Any prompt-snapshot test that pins the old body must be updated to the new text in this same commit.

- [ ] **Step 6: Commit**

```bash
test "$(git branch --show-current)" = "fix/qa-sample-findings-followup" || exit 1
git add packages/ai/src/prompts.ts
git commit -m "fix(evaluate): obligatory determiners are not optional elements

The optional-elements rule (pro-drop pronouns, doubled possessives, TR 'bir')
had no stated converse, and the evaluator scored 'No me gusta cerveza' — a
missing obligatory article — at 0.85, above the pass threshold, so an
ungrammatical answer earned mastery credit for es-a1-gustar-basic.

Bumps EVALUATION_SYSTEM_PROMPT_VERSION to evaluate@2026-08-11.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: A/B the fix and record the result

**Files:**
- Create: `docs/analysis/eval-obligatory-determiners-2026-08-11.md`
- Create (gitignored): `packages/ai/eval-runs/obligatory-determiners-candidate-2026-08-11.json`

**Interfaces:**
- Consumes: the Langfuse dataset from Task 5; `<scratchpad>/prompt-candidate.txt` from Task 6.
- Produces: the go/no-go verdict for Task 8.

- [ ] **Step 1: Run the candidate arm**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/qa-sample-findings-followup/packages/ai
pnpm exec dotenv -e ../../.env -- pnpm exec tsx scripts/eval-run.ts \
  --dataset eval-obligatory-determiners \
  --candidate file:<scratchpad>/prompt-candidate.txt \
  --run-name obligatory-determiners-candidate-2026-08-11
```

Expected: exits 0, writes `./eval-runs/obligatory-determiners-candidate-2026-08-11.json`. Each item's delta is computed against the fixture's `expectedOutput` (the recorded baseline), so this single arm is the A/B.

- [ ] **Step 2: Check the success criteria against the per-item output**

Read the JSON's `perItem` entries. Pass requires, for `es-gustar-mass-noun-missing-article`:
- `actual.score` < 0.8, **and**
- `actual.errors` contains at least one entry of type `grammar` whose `correction` or `explanation` names the missing article.

And for the other two items: `actual.score` below its baseline, with a grammar error on the omitted determiner. Report any item that fails.

- [ ] **Step 3: Regression-check the optional-elements rule**

The new paragraph sits next to the rule that makes pro-drop pronouns and Turkish `bir` optional; an over-broad reading would start penalizing those. Run the existing hard-morphology dataset with the same candidate:

```bash
pnpm exec dotenv -e ../../.env -- pnpm exec tsx scripts/eval-run.ts \
  --dataset eval-hard-morphology \
  --candidate file:<scratchpad>/prompt-candidate.txt \
  --run-name hard-morphology-obligatory-determiners-check-2026-08-11
```

Expected: no item newly reports an error about an omitted optional element (a Turkish `bir`, a dropped subject pronoun). Those baselines are recorded *failures*, so scores moving down is fine — what must not appear is a new optional-element complaint. Report the check either way.

- [ ] **Step 4: Write the record and commit**

Create `docs/analysis/eval-obligatory-determiners-2026-08-11.md` with: the two run names, per-item baseline → candidate scores, whether each success criterion was met, the regression-check outcome, and the total run cost.

```bash
test "$(git branch --show-current)" = "fix/qa-sample-findings-followup" || exit 1
git add docs/analysis/eval-obligatory-determiners-2026-08-11.md
git commit -m "docs(eval): record the obligatory-determiner prompt A/B

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Gate**

If the `gustar` item did not move below 0.8, **stop and report** rather than pushing a prompt change that does not fix the finding. Options to bring back to the user: strengthen the rule with an explicit score ceiling (the option deferred during design), or move it into the `### Spanish (ES)` language-notes section.

---

### Task 8: Full gate, push, PR

**Files:** none (CI + review).

- [ ] **Step 1: Symlink esbuild so the CDK synth tests can run**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/qa-sample-findings-followup
ls node_modules/esbuild >/dev/null 2>&1 || ln -s "$(pwd)/node_modules/.pnpm/$(ls node_modules/.pnpm | grep -m1 '^esbuild@')/node_modules/esbuild" node_modules/esbuild
```

- [ ] **Step 2: Run the full gate**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: zero failures. Report counts. If `infra/lambda/dist/**/*.test.js` produces phantom failures, `rm -rf infra/lambda/dist` and re-run.

- [ ] **Step 3: Rebase on main and push**

```bash
git fetch origin main && git rebase origin/main
git push -u origin fix/qa-sample-findings-followup
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "fix(evaluate): obligatory determiners are not optional elements" --body "$(cat <<'EOF'
## Summary

Closes the three untouched production `qa:sample` findings from 2026-07-22.

- Re-measured all four flags at `--seed 1` against prod; see `docs/analysis/qa-sample-findings-2026-08-11.md` for which survived and which #612 had already closed.
- `EVALUATION_SYSTEM_PROMPT` gains the converse of its optional-elements rule: determiners the target grammar requires are not optional, and omitting one is a grammatical error. This closes the `es-a1-gustar-basic` false-positive where `No me gusta cerveza` scored 0.85 — above the 0.8 pass threshold — and so earned mastery credit.
- Verified by a new Langfuse dataset (`eval-obligatory-determiners`, 3 hand-curated cases with observed baselines) plus a regression check against `eval-hard-morphology`; results in `docs/analysis/eval-obligatory-determiners-2026-08-11.md`.
- The 2026-07-22 prod reports are now committed under `docs/analysis/`, and `packages/ai/qa-runs/` is gitignored like `audit-runs/`.

## Post-merge

Requires a Langfuse `push-prompts` per environment (prod + dev) — the in-repo constant is only the fallback body. Revert path: re-point the `production` label at the version `push-prompts` logs.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Squash-merge, replacing the auto-generated bullet list with the PR summary.

---

### Task 9: Sync Langfuse (post-merge, both environments)

Runs only if Task 6 established that the edit touched the **cached system template**. If the paragraph was user-prompt-only, this task is skipped — record that instead.

**Files:** none.

- [ ] **Step 1: Work from a fresh main checkout**

`push-prompts` pushes **every** drifted prompt, so a stale tree reverts unrelated ones. Pull `main` in the main checkout after the merge and run from there.

- [ ] **Step 2: Prod — preview, push, verify**

```bash
PK=$(aws --region eu-central-1 secretsmanager get-secret-value --secret-id language-drill/LANGFUSE_PUBLIC_KEY --query SecretString --output text)
SK=$(aws --region eu-central-1 secretsmanager get-secret-value --secret-id language-drill/LANGFUSE_SECRET_KEY --query SecretString --output text)
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com pnpm --filter @language-drill/ai push-prompts --dry-run
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com pnpm --filter @language-drill/ai push-prompts
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com pnpm --filter @language-drill/ai bootstrap-prompts --check
```

Expected: the dry run lists **only** the evaluation prompt as drifted. If it lists others, stop — the tree is stale. Record the prior version number that `push-prompts` logs as the revert target. `--check` exits 0.

- [ ] **Step 3: Dev — same three commands with the `language-drill-dev/` secret prefix**

Record dev's revert version too.

---

### Task 10: End-to-end confirmation against the live prompt

- [ ] **Step 1: Wait for the Lambda module-scope cache**

At least 5 minutes after the push.

- [ ] **Step 2: Re-run the ES A1 seed-1 sample**

Same command as Task 2 Step 2, with `--out prod-smoke-es-a1-2026-08-11-postfix`.

- [ ] **Step 3: Confirm and record**

Expected: no `false_positive` on `09d08beb-fa80-5f79-907a-cd0541f7c874`. Append the outcome (and the report filename) to `docs/analysis/qa-sample-findings-2026-08-11.md` on a follow-up branch, then delete the credential file.

---

### Task 11: Repair surviving underdetermined cloze rows on prod

Runs only for cloze ids that survived Task 2. Content-only repair; `review_status`, `demotion_reason`, mastery, and history are untouched.

**Files:** none in the repo — prod data only, via Neon MCP.

**Interfaces:**
- Consumes: the surviving ids from Task 2.
- Produces: rows whose `content_json.acceptableAnswers` includes the licensed alternative.

- [ ] **Step 1: Capture the current content for rollback**

Neon MCP `run_sql` (project `twilight-smoke-01114337`, branch `br-green-waterfall-ancrvpr5`):

```sql
select id, content_json from exercises
where id in ('1c8afa03-50f9-566b-9adc-f8578e7b606a', 'ca70d729-2619-5421-8c5f-16cdd77d4e60');
```

Paste both objects into the findings record before writing anything.

- [ ] **Step 2: Add the licensed alternative to each surviving row**

One statement per id, only for ids that survived. The deber row (`Debo tener más cuidado la próxima vez` is valid; mood is unconstrained):

```sql
update exercises
set content_json = jsonb_set(content_json, '{acceptableAnswers}', '["Debo"]'::jsonb, true)
where id = '1c8afa03-50f9-566b-9adc-f8578e7b606a'
  and content_json->'acceptableAnswers' is null;
```

The collective-agreement row (no tense anchor licenses the present over the preterite; singular `interpretó` still demonstrates the point):

```sql
update exercises
set content_json = jsonb_set(content_json, '{acceptableAnswers}', '["interpretó"]'::jsonb, true)
where id = 'ca70d729-2619-5421-8c5f-16cdd77d4e60'
  and content_json->'acceptableAnswers' is null;
```

The `and … is null` guard makes each statement a no-op if the field already exists — in that case stop and merge by hand rather than overwriting. These are single-row, id-scoped writes; confirm with the user before running them.

- [ ] **Step 3: Verify the write**

```sql
select id, content_json->'acceptableAnswers' as acceptable, review_status, demotion_reason
from exercises
where id in ('1c8afa03-50f9-566b-9adc-f8578e7b606a', 'ca70d729-2619-5421-8c5f-16cdd77d4e60');
```

Expected: the new array present; `review_status` unchanged (`auto-approved`); `demotion_reason` still NULL.

- [ ] **Step 4: Confirm the flag clears**

Re-run that grammar point's seed-1 sample from Task 2 Step 3 with `--out <point>-2026-08-11-postfix`. Expected: no `acceptable_answers_gap` on the repaired id. Append the outcome to the findings record.

---

### Task 12: Update the memory record

**Files:** `/Users/seal/.claude-personal/projects/-Users-seal-dev-language-drill/memory/qa-sample-tool.md` and `MEMORY.md`.

- [ ] **Step 1: Correct and extend `qa-sample-tool.md`**

Fix three things: the claim that `qa-runs/` is gitignored (it was not until Task 1 — now it is, with reports committed to `docs/analysis/`), the output-name flag (`--out`, not `--name`), and the findings' status (which survived, which #612 closed, what shipped). Link `[[cloze-tense-determinacy-shipped]]` and the new evaluator-fix facts.

- [ ] **Step 2: Add a memory for the obligatory-determiner rule if it shipped**

Only if Task 6 merged: a short `project` memory naming the rule, its version tag (`evaluate@2026-08-11`), whether a Langfuse push was needed, and the revert versions per environment. Add the one-line pointer to `MEMORY.md`.

---

## Self-Review

**Spec coverage:** §A → Task 2. §B → Tasks 3–7 (fixture, seed, prompt edit, A/B), 9 (sync), 10 (confirm). §C → Task 11. §D → Tasks 1 and 12. Out-of-scope items stay out; both remain logged in the spec.

**Deviations from the spec, deliberate:**
1. The spec said the fix lands in `EVALUATION_SYSTEM_PROMPT`, but the optional-elements paragraph it extends actually lives in the translation **user**-prompt builder. Task 6 verifies which before editing and branches, because it decides whether a Langfuse push (Task 9) is needed at all.
2. The spec named `--name` for report naming; the CLI flag is `--out`. Corrected throughout.
3. Baseline capture (Task 3) is new: `eval:seed` skips existing seed keys, so a provisional `expectedOutput` could never be corrected, and `expectedOutput` is the baseline side of the delta computation.
4. A regression run against `eval-hard-morphology` (Task 7 Step 3) is new — the three-item dataset cannot detect over-strictness on the optional elements the new paragraph sits beside.

**Type consistency:** `parseSeedFixture`, `evaluateAnswer(client, input)`, `EvaluateAnswerInput` fields (`exercise`, `userAnswer`, `language`, `difficulty`, `systemPromptOverride`), `EVALUATION_SYSTEM_PROMPT`, `EVALUATION_SYSTEM_PROMPT_VERSION`, and the dataset/seed-key strings match across Tasks 3–7 and their sources.
