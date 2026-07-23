# Cloze Tense-Determinacy Rule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the generator from emitting tense-ambiguous cloze items (a finite-verb blank with no temporal anchor but a non-present `correctAnswer`), and make the validator reject them — so a learner's equally-valid present answer is no longer marked wrong.

**Architecture:** A shared generation prompt and a shared validation prompt each get one new rule stating that a finite-verb cloze blank whose tense isn't the drilled feature must have its tense forced by an in-stem temporal anchor, or default to present/habitual. Generation and validation are a contract pair — both rules and both version constants ship in one commit (a generation fix is nullified if the validator still rejects the new shape). The change is verified locally with `eval:gen` before merge, then synced to Langfuse and swept over the existing pool with `revalidate:cloze`.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces (`@language-drill/ai`), Anthropic Claude, Langfuse (prompt registry).

## Global Constraints

- Prompt-editing protocol (CLAUDE.md): editing a `*_SYSTEM_PROMPT`/`*_TEMPLATE` constant REQUIRES bumping the matching `*_PROMPT_VERSION` to `<surface>@YYYY-MM-DD` in the SAME commit. Today is `2026-07-23`.
- Contract-split rule: `GENERATION_PROMPT_VERSION` and `VALIDATION_PROMPT_VERSION` both bump in the same commit; both rules state the same anchor/cue lists.
- `packages/ai` MUST NOT import `@language-drill/db` (CI build cycle).
- Langfuse registers the `*_TEMPLATE` string; the runtime serves the OLD body until `push-prompts` syncs — so the merged edit is inert until Task 3 runs. Push from a FRESH main checkout (a stale worktree silently reverts other prompts).
- Pre-push gate (repo root): `pnpm lint && pnpm typecheck && pnpm test`, zero failures.
- Borderline items (`durante toda la noche`, `en el momento más emocionante`, `por primera vez hoy`) are PASS, not fail.

---

### Task 1: Coordinated prompt edit — generation + validation rule + version bumps + tests

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts` (new bullet after line 411; version at line 230)
- Modify: `packages/ai/src/validation-prompts.ts` (new sub-bullet after line 145; version at line 103)
- Test: `packages/ai/src/generation-prompts.test.ts` (line 319 + new assertion)
- Test: `packages/ai/src/validation-prompts.test.ts` (new assertion)

**Interfaces:**
- Consumes: nothing (self-contained prompt strings).
- Produces: `GENERATION_PROMPT_VERSION === "generate@2026-07-23"`, `VALIDATION_PROMPT_VERSION === "validate@2026-07-23"`; the pinned phrases `"Tense determinacy on finite-verb blanks"` (generation template) and `"Tense-determinacy (cloze)"` (validation template) — Task 2's fixture reasons key off the validator's `ambiguous` dimension, not these strings.

- [ ] **Step 1: Write the failing tests first**

In `packages/ai/src/generation-prompts.test.ts`, inside the `"carries a bumped, correctly-formatted GENERATION_PROMPT_VERSION"` test, change line 319 and add a template assertion. Replace:

```ts
    expect(GENERATION_PROMPT_VERSION).toBe("generate@2026-07-22");
```

with:

```ts
    // Bumped 2026-07-23 — tense-determinacy rule for finite-verb cloze blanks:
    // a non-present correctAnswer in an anchorless stem is a false-negative trap
    // (the present/habitual reading is equally valid). Fixes the systemic
    // es-b1-influence-verbs-infinitive failure (docs/.../2026-07-23-cloze-tense-determinacy).
    expect(GENERATION_PROMPT_VERSION).toBe("generate@2026-07-23");
    // Tense-determinacy rule pinned in the cached template prefix.
    expect(GENERATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      "Tense determinacy on finite-verb blanks",
    );
    expect(GENERATION_SYSTEM_PROMPT_TEMPLATE).toContain("todos los días");
```

In `packages/ai/src/validation-prompts.test.ts`, add a new test after the existing ambiguous-dimension assertions (near line 188, inside the same `describe`/`it` that builds a cloze `validatorPrompt` — reuse the existing `prompt`/`validatorPrompt` variable in scope; if none is in scope at file top-level, add it to the block that already asserts `"buffer-consonant ambiguous blank"` at line 174):

```ts
    // 2026-07-23 tense-determinacy: an anchorless non-present finite-verb blank
    // is same-lexeme tense ambiguity, cured by anchor-or-present (not enumeration).
    expect(prompt).toContain("Tense-determinacy (cloze)");
    expect(VALIDATION_PROMPT_VERSION).toBe("validate@2026-07-23");
```

If `VALIDATION_PROMPT_VERSION` is not yet imported in that test file, add it to the existing import from `./validation-prompts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts validation-prompts`
Expected: FAIL — generation test fails on `toBe("generate@2026-07-23")` (still `-22`) and the missing `"Tense determinacy on finite-verb blanks"` string; validation test fails on the missing `"Tense-determinacy (cloze)"` string / version.

- [ ] **Step 3: Add the generation-prompt rule**

In `packages/ai/src/generation-prompts.ts`, insert a new bullet immediately BEFORE the `- **Form-contrast clozes — force one alternant via context; never enumerate both.**` bullet (line 412). Anchor the edit on that bullet's opening text and prepend:

```
- **Tense determinacy on finite-verb blanks.** When the blank is a FINITE VERB and tense/aspect is NOT the feature this grammar point drills (e.g. causative/permissive dejar/permitir/hacer + infinitive, ser/estar, por/para — the verb's tense is incidental, not the target contrast), the visible sentence MUST admit exactly ONE tense. Either (a) put a temporal anchor IN the stem that forces it — a preterite/imperfect/pluperfect verb elsewhere in the sentence (\`Cuando llegué tarde…\`, \`El viento era tan fuerte…\`, \`habíamos logrado…\`) or an explicit past adverbial (\`ayer\`, \`anoche\`, \`esa noche\`, \`la semana pasada\`, \`mientras\`, \`de repente\`) — OR (b) target the PRESENT/habitual, the default reading of an anchorless generic statement. A non-present \`correctAnswer\` in an anchorless stem is FORBIDDEN: \`El portero no ___ entrar al mensajero sin identificación.\` → \`dejó\` is a false-negative trap, because \`deja\` (a standing rule) is equally correct given only the visible text. Habitual/iterative cues — \`siempre\`, \`cada vez que\`, \`todos los días\`, \`por las noches\`, \`normalmente\`, \`a menudo\` — force present/habitual and FORBID the preterite: \`El entrenador nos ___ correr diez kilómetros todos los días.\` must be \`hace\`, never \`hizo\`. This is same-lexeme tense ambiguity, reinforcing the **Ambiguous blank** and **One correct fill** rules above; the cure is anchor-or-present, NEVER enumerating tense variants in \`acceptableAnswers\` (listing \`deja, dejó\` teaches they are interchangeable, which they are not — same logic as the Form-contrast rule below).
```

(Keep it as a single line in the source, matching the surrounding bullets' formatting. The `\`` sequences are literal backticks inside the template literal.)

- [ ] **Step 4: Bump `GENERATION_PROMPT_VERSION`**

In `packages/ai/src/generation-prompts.ts` line 230:

```ts
export const GENERATION_PROMPT_VERSION = "generate@2026-07-23";
```

- [ ] **Step 5: Add the validation-prompt rule**

In `packages/ai/src/validation-prompts.ts`, insert a new sub-bullet immediately AFTER the `- **Form-contrast exception (cloze):**` sub-bullet (line 145) and BEFORE the `- "Sınıfta sekiz ___ var."` example (line 146). Anchor on the `Sınıfta sekiz` line and prepend:

```
   - **Tense-determinacy (cloze):** when the blank is a finite verb and tense/aspect is NOT what this point drills, a NON-PRESENT \`correctAnswer\` (preterite/imperfect/perfect) is \`ambiguous = true\` UNLESS the visible sentence contains a temporal anchor that forces the past — a preterite/imperfect/pluperfect verb elsewhere in the stem (\`llegué\`, \`era\`, \`habíamos logrado\`) or an explicit past adverbial (\`ayer\`, \`anoche\`, \`esa noche\`, \`la semana pasada\`). This is same-lexeme tense ambiguity (\`deja\` vs \`dejó\`); enumeration does NOT cure it (listing both teaches they are interchangeable) — a clean draft forces the past via an in-stem anchor or targets the present/habitual. Habitual/iterative cues (\`siempre\`, \`cada vez que\`, \`todos los días\`, \`por las noches\`) force present and make a preterite \`correctAnswer\` \`ambiguous\`. Do NOT flag an anchorless PRESENT/habitual answer, nor a preterite answer that DOES carry an in-stem past anchor. Example: \`El portero no ___ entrar al mensajero sin identificación.\` / \`correctAnswer: "dejó"\` — ambiguous (present \`deja\` equally valid, no anchor); \`Cuando llegué tarde, mi jefe no me ___ disculparme.\` / \`"dejó"\` — NOT ambiguous (the preterite \`llegué\` forces the past).
```

- [ ] **Step 6: Bump `VALIDATION_PROMPT_VERSION`**

In `packages/ai/src/validation-prompts.ts` line 103:

```ts
export const VALIDATION_PROMPT_VERSION = "validate@2026-07-23";
```

- [ ] **Step 7: Run the target tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts validation-prompts`
Expected: PASS (both files green).

- [ ] **Step 8: Run the full pre-push gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures across all packages. (If `@language-drill/ai` tests read a stale `db/dist`, run `pnpm build` first per the vitest-workspace-dist gotcha.)

- [ ] **Step 9: Commit**

```bash
test "$(git rev-parse --abbrev-ref HEAD)" = "fix/cloze-tense-determinacy" || { echo "WRONG BRANCH"; exit 1; }
git add packages/ai/src/generation-prompts.ts packages/ai/src/validation-prompts.ts \
        packages/ai/src/generation-prompts.test.ts packages/ai/src/validation-prompts.test.ts
git commit -m "fix(generation): require tense-forcing anchor on finite-verb cloze blanks

A finite-verb cloze blank whose tense is not the drilled feature must have
its tense forced by an in-stem temporal anchor, else default to present/
habitual. Mirror the rule in the validator's ambiguous dimension and bump
both prompt versions (contract pair). Fixes the systemic false-negative trap
on es-b1-influence-verbs-infinitive where an anchorless preterite target
marked the equally-valid present answer wrong.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Verify no over-correction with `eval:gen` (pre-merge gate)

**Files:**
- Create: `packages/ai/scripts/fixtures/eval-cloze-tense-determinacy.json` (or the path `eval:gen:export` / `eval:gen` expects — confirm from `pnpm eval:gen --help` and the existing `scripts/fixtures/` convention)
- No source changes.

**Interfaces:**
- Consumes: the edited prompts from Task 1 (via `--candidate file:<path>` or `--candidate repo` after commit).
- Produces: an `./eval-runs/<runName>.json` summary showing approval-rate deltas; evidence attached to the PR.

- [ ] **Step 1: Confirm the `eval:gen` dataset shape and flags**

Run: `pnpm eval:gen --help` (and skim `docs`/the CLI source for `--dataset-file`, `--baseline`, `--candidate`, `--drafts-per-cell`, `--max-cost-usd`).
Expected: confirm the dataset-file schema (cell descriptors) so the fixture below matches it. If the tool only samples cells from `generation_jobs`, use `pnpm eval:gen:export --grammar-point es-b1-influence-verbs-infinitive` to build the dataset instead of hand-authoring.

- [ ] **Step 2: Build the evaluation dataset**

Prefer: `pnpm eval:gen:export --language es --cefr B1 --sample <n> --out packages/ai/eval-datasets/cloze-tense-es-b1.json` scoped to (or filtered for) `es-b1-influence-verbs-infinitive`, so the dataset is grounded in the real failing cell.
Expected: a dataset file containing the influence-verbs cell(s).

- [ ] **Step 3: Run the A/B — baseline repo vs candidate (this branch's prompts)**

Because Task 1 already edited the in-repo prompts, compare the PRE-edit prompt against the committed one. Run:

```bash
pnpm eval:gen \
  --baseline langfuse:generation-system-prompt@production \
  --candidate repo \
  --dataset-file packages/ai/eval-datasets/cloze-tense-es-b1.json \
  --drafts-per-cell 8 \
  --max-cost-usd 3 \
  --allow-prod
```

(`--baseline langfuse:…@production` is the currently-serving old body; `--candidate repo` is the edited body on this branch. If the runner cannot read Langfuse, stash the edit, capture `--baseline repo`, unstash, and rerun `--candidate repo` into a second run.)
Expected: a run summary at `./eval-runs/<runName>.json`.

- [ ] **Step 4: Assert the two required outcomes from the summary**

Read `./eval-runs/<runName>.json` and confirm:
1. **Traps now rejected:** anchorless non-present influence-verb drafts are rejected with an `ambiguous` rejection reason (approval-rate for those drops on the candidate arm).
2. **No over-correction:** overall approval-rate for the cell does NOT collapse — well-anchored preterite drafts (`Cuando llegué…`, `El viento era…`) and legitimate present/habitual drafts still approve. If approval-rate craters (validator now flags anchored-past items too), the rule over-reaches — return to Task 1, narrow the anchor definition, re-run.
Expected: candidate arm shows fewer anchorless-preterite approvals and a stable approval rate on anchored/present items.

- [ ] **Step 5: Commit the dataset + a short results note**

```bash
git add packages/ai/eval-datasets/cloze-tense-es-b1.json
git commit -m "test(eval): eval:gen dataset for cloze tense-determinacy verification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Record the run summary numbers (baseline vs candidate approval-rate, ambiguous-flag delta) in the PR description as evidence.

---

### Task 3: Post-merge — sync Langfuse (prod + dev)

**Files:** none (operational). Run only AFTER the PR merges to `main`, from a FRESH `main` checkout (not a worktree — a stale worktree's `push-prompts` reverts unrelated prompts).

- [ ] **Step 1: Pull Langfuse creds and preview the push (prod)**

```bash
PK=$(aws --region eu-central-1 secretsmanager get-secret-value --secret-id language-drill/LANGFUSE_PUBLIC_KEY --query SecretString --output text)
SK=$(aws --region eu-central-1 secretsmanager get-secret-value --secret-id language-drill/LANGFUSE_SECRET_KEY --query SecretString --output text)
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai push-prompts --dry-run
```
Expected: ONLY `generation-system-prompt` and `validation-system-prompt` shown as drifted. If any OTHER prompt appears drifted, STOP — the checkout is stale; do not push.

- [ ] **Step 2: Apply the push (prod), then confirm in sync**

```bash
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai push-prompts
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai bootstrap-prompts --check
```
Expected: push logs the prior version as revert target; `--check` exits 0.

- [ ] **Step 3: Repeat Steps 1–2 for dev**

Use the `language-drill-dev/` secret prefix. Expected: same — only the two prompts drift, `--check` exits 0.

---

### Task 4: Post-sync — sweep the existing pool with `revalidate:cloze`

**Files:** none (operational). Run AFTER Task 3 (the validator must be serving the new body — allow ~5 min for the Lambda module-scope cache TTL if revalidating against the deployed validator; the CLI uses the in-repo/Langfuse body per its own resolution).

- [ ] **Step 1: Dry-run the re-pass scoped to the point**

```bash
pnpm revalidate:cloze --language es --cefr B1 --limit 100
```
Expected (dry-run is the default): a report listing which stored clozes the new validator now demotes. Confirm the ~6 anchorless-preterite traps (`El portero no ___ entrar…` → `dejó`, `El entrenador nos ___ correr… todos los días` → `hizo`, `Los celos le ___ actuar…` → `hicieron`, `La profesora nos ___ aprender…` → `hizo`, `Las imágenes… me ___ llorar…` → `hicieron`, `Llevar tanto equipaje me ___ caminar…` → `hizo`) appear, and the 9 well-anchored + 3 borderline do NOT.

- [ ] **Step 2: If the dry-run matches expectations, apply**

```bash
pnpm revalidate:cloze --language es --cefr B1 --limit 100 --apply
```
Expected: the traps demote (flagged); anchored/present items untouched. If the dry-run demotes anchored items too, DO NOT apply — the rule over-reaches; reopen Task 1.

- [ ] **Step 2 (verify): confirm the pool state**

Query prod (Neon project `twilight-smoke-01114337`, branch `br-green-waterfall-ancrvpr5`) for approved-count and the tense spread of surviving influence-verb blanks; confirm the traps are no longer `auto-approved`/`manual-approved`. Nightly regen (~04:00 UTC) refills under the new generation rule; small single-point ES-B1 deficit — no water-fill starvation risk.

---

## Self-Review

**Spec coverage:** Rule statement → Task 1 Steps 3+5. Generation insertion (gen-prompts:397/411) → Step 3 (folded the "Ambiguous blank" 397 clause into the new bullet's cross-reference, avoiding a risky edit of that 900-char line; the standalone bullet is the parallel of the existing Form-contrast bullet). Validation `ambiguous` extension → Step 5. Version bumps → Steps 4+6. Tests → Steps 1+7. eval:gen A/B → Task 2. Langfuse sync → Task 3. Pool re-pass → Task 4. Over-correction guard → Task 2 Step 4 + Task 4 Step 1. Borderline-3 PASS → Task 4 Step 1. Anchor/cue lists → Steps 3+5 (past: llegué/era/habíamos/ayer/anoche/esa noche/la semana pasada/mientras/de repente; habitual: siempre/cada vez que/todos los días/por las noches/normalmente/a menudo). All covered.

**Placeholder scan:** No TBD/TODO. Exact insertion anchors, exact version strings, exact rule text, exact commands. Task 2 Step 1 is a genuine confirm-the-CLI-shape step (the runner's dataset schema is not pinned in this plan) — kept explicit, not a placeholder.

**Type consistency:** Version strings consistent (`generate@2026-07-23`, `validate@2026-07-23`). Pinned test phrases match the inserted rule text exactly (`"Tense determinacy on finite-verb blanks"`, `"Tense-determinacy (cloze)"`, `"todos los días"`). Branch name consistent (`fix/cloze-tense-determinacy`).
