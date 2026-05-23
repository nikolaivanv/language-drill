# Runbook — Fix a generation/validation issue, then re-route the existing pool

Last updated: 2026-05-20. Owner: see git blame.

## When to use this

You spot exercises in the pool that the validator should have caught but
didn't. Two recurring shapes:

- **Generator-side bug** — the model is producing exercises that violate a
  rule the prompts don't yet articulate (e.g. ambiguous cloze blanks where
  many lexemes fit, or `context` strings that literally state the answer).
- **Validator-side bug** — the validator is letting through a pattern that
  should be rejected (e.g. it scores `ambiguous=false` for "Sınıfta sekiz
  ___ var" because grammatically only one suffix shape fits, even though
  semantically many nouns do).

The fix usually involves prompt edits, sometimes a new validator scoring
dimension, and almost always a one-off pass over the existing pool to
demote rows that were validated under the old rules. This runbook covers
the full loop end-to-end.

For a worked example, see PRs [#146](https://github.com/nikolaivanv/language-drill/pull/146)
(prompt + validator dimension) and [#147](https://github.com/nikolaivanv/language-drill/pull/147)
(revalidation CLI).

---

## 1. Diagnose

Pin down **exactly** what's wrong before touching anything. The
characteristics of the failure determine which path you take in §2.

1. Grab one bad example end-to-end. Note the language, CEFR level, exercise
   type, the rendered exercise body (sentence, instructions, context,
   options), the user's answer, and the evaluator's response.
2. Decide which surface is at fault:
   - **The generator wrote a bad exercise** → fix in `generate-system-prompt`.
   - **The validator approved a bad exercise** → fix in
     `validate-system-prompt` (and possibly add a new scoring dimension).
   - **The evaluator scored a good answer wrong** → fix in
     `evaluate-system-prompt`. This runbook still applies but the pool-
     revalidation step in §4 is usually skipped.
3. Decide the scope of the fix:
   - **Pure wording change** — no new fields, no new validator dimensions,
     just a clearer rule. Skip to [§2A — Prompt-only path](#2a-prompt-only-path).
   - **Schema or scoring change** — you need a new field on the exercise
     body (e.g. `acceptableAnswers`), a new validator dimension (e.g.
     `contextSpoilsAnswer`), or a routing-rule change (e.g. a new hard
     veto). Skip to [§2B — Schema-change path](#2b-schema-change-path).

Don't guess; if it could be either, start with prompt-only and only escalate
to a code PR if the validator can't be steered by wording alone.

---

## 2A. Prompt-only path

Use this when the fix is wording-only. The runtime fetches every prompt body
from Langfuse with a 5-minute cache (see `packages/ai/src/prompts-registry.ts`
and §7a.3 of `docs/llm-observability.md`), so you can roll out a new prompt
without a deploy.

### A1. Edit in the Langfuse dashboard

This is the source of truth — **not** the in-repo template constant.
`pnpm bootstrap-prompts` only creates a prompt the first time;
re-running it does **not** push edits.

1. Open the Langfuse dashboard → Prompts → pick the prompt name from this
   table:

   | Surface | Langfuse prompt name | In-repo fallback constant |
   |---|---|---|
   | Answer evaluation | `evaluate-system-prompt` | `EVALUATION_SYSTEM_PROMPT` |
   | Reading annotation | `annotate-system-prompt` | `ANNOTATE_SYSTEM_PROMPT` |
   | Exercise generation | `generate-system-prompt` | `GENERATION_SYSTEM_PROMPT_TEMPLATE` |
   | Exercise validation | `validate-system-prompt` | `VALIDATION_SYSTEM_PROMPT_TEMPLATE` |
   | Theory generation | `theory-generate-system-prompt` | `THEORY_SYSTEM_PROMPT_TEMPLATE` |
   | Theory validation | `theory-validate-system-prompt` | `THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE` |

2. Click **New version**, paste the edited body.
3. Add a `candidate-<slug>` label (free-form, dashboard-readable —
   e.g. `candidate-2026-05-20-no-spoilers`). Do **not** move
   `production` yet.

If the in-repo fallback uses `{{flatVar}}` placeholders (the four
`*_TEMPLATE` prompts), keep the placeholder set identical. Langfuse compiles
with Mustache.js; the registry will fall back to the in-repo template if a
`{{var}}` is left unresolved (`prompts-registry.ts`'s fail-soft path).

### A2. Eval the candidate against a dataset

Skip only if the fix is too narrow to matter on aggregate metrics
(e.g. a one-word typo fix). Otherwise:

```bash
# 1. Pull a fresh sample of traces (last 14 days, 50 items) into a dataset.
pnpm eval:export --from 2026-05-06 --to 2026-05-20 --sample 50 \
  --dataset evaluate-spoiler-fix-2026-05-20

# 2. Run baseline (current production prompt).
pnpm eval --dataset evaluate-spoiler-fix-2026-05-20 \
  --candidate langfuse:evaluate-system-prompt@production \
  --run-name baseline

# 3. Run the candidate.
pnpm eval --dataset evaluate-spoiler-fix-2026-05-20 \
  --candidate langfuse:evaluate-system-prompt@candidate-2026-05-20-no-spoilers \
  --run-name candidate
```

Read `eval-runs/*.json` for the cost / latency / quality diff. The Langfuse
dashboard shows the two runs side-by-side on the dataset.

### A3. Promote to production

In the Langfuse dashboard, move the `production` label to the candidate
version. The runtime picks it up within 5 minutes (Lambda module-scope cache
TTL); new cold-start invocations see it sooner.

Verify the rollout:

```bash
# Drift check — fails CI if the production body in Langfuse doesn't byte-match
# the in-repo fallback. Expect a diff right now — that's the point of A4.
pnpm bootstrap-prompts --check
```

### A4. Backport the new body to the in-repo fallback

Open a code PR that:

1. Updates the matching `*_SYSTEM_PROMPT` / `*_SYSTEM_PROMPT_TEMPLATE`
   constant in `packages/ai/src/` to byte-match the new Langfuse body.
2. Bumps the matching `*_PROMPT_VERSION` constant to today's date
   (`<surface>@YYYY-MM-DD`) — drives the Langfuse trace cohort tag so
   dashboards split old/new traces (see `CLAUDE.md` "Prompt Editing").
3. Updates any byte-parity / contains-substring tests in
   `packages/ai/src/*-prompts.test.ts`.

Without this, a Langfuse outage will silently roll the runtime back to the
old prompt and you won't notice until the dashboards drift.

After merge, `pnpm bootstrap-prompts --check` should pass again.

### A5. Revalidate the existing pool

Most prompt edits change the validator's verdict on at least some existing
rows. Jump to [§4 — Revalidate the pool](#4-revalidate-the-pool).

---

## 2B. Schema-change path

Use this when you need a new field, a new validator dimension, a new routing
rule, or a tightened JSON schema. Wording alone won't get you there —
Langfuse can't add a required field to the validator's tool input_schema.

### B1. Land the code changes in a PR

What typically changes (see PR #146 for a worked diff):

- **`packages/shared/src/index.ts`** — content-type field additions
  (e.g. `ClozeContent.acceptableAnswers?: string[]`).
- **`packages/ai/src/generate.ts`** — the per-type generator tool
  (`CLOZE_GENERATION_TOOL` / `TRANSLATION_GENERATION_TOOL` /
  `VOCAB_RECALL_GENERATION_TOOL`) input_schema + the per-type parser
  (`parseGeneratedClozeDraft` etc.).
- **`packages/ai/src/validate.ts`** — `VALIDATION_TOOL` schema, the
  `ValidationResult` type, and `parseValidationResult`.
- **`packages/ai/src/validation-prompts.ts`** — the
  `VALIDATION_SYSTEM_PROMPT_TEMPLATE` body referencing the new dimension,
  and the per-type user-prompt builders if they need to surface the new
  field on a draft.
- **`packages/ai/src/generation-prompts.ts`** — same template-edit for the
  generator if generation rules change.
- **`packages/ai/src/prompts.ts`** — `EVALUATION_SYSTEM_PROMPT` if the
  evaluator needs to read a new field (e.g. accept any entry in
  `acceptableAnswers`).
- **`packages/db/src/generation/routing.ts`** — `routeValidationResult` to
  honour the new dimension (e.g. a new hard veto, or a new auto-approval
  conjunct). Update `packages/db/scripts/generate-exercises-validate.test.ts`
  in lockstep.
- **Bump every prompt version constant you touched** — see the table in
  `CLAUDE.md` "Prompt Editing".

Tests must still go green:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Add regression tests with the **exact** failing exercises pasted in as
fixtures — that's the only way to prove the new code rejects them.

Open the PR. Reviewers can run the eval-export/eval loop from §A2 in
parallel.

### B2. Mirror the new prompt body into Langfuse

The code PR ships an updated in-repo fallback, but the runtime fetches from
Langfuse. Until you mirror the new body to the `production` label in
Langfuse, the runtime keeps using the **old** body — the new code paths
will see fewer of the new dimensions than they should, and `pnpm
bootstrap-prompts --check` will show drift.

Sequence:

1. Merge the code PR.
2. Open the Langfuse dashboard.
3. For each prompt you edited in the PR, create a new version with the body
   from the in-repo template, attach a `candidate-*` label, and run §A2
   evals against it if the change is significant.
4. Move the `production` label to the new version.
5. Confirm with `pnpm bootstrap-prompts --check`.

#### Programmatic alternative — `pnpm push-prompts`

When you've decided the merged in-repo body should go straight to
`production` (eval already done, or the change is low-risk), `pnpm
push-prompts` does steps 3–4 for **every drifted prompt at once** instead of
hand-editing each in the dashboard. It detects drift exactly as
`--check` does, logs each prompt's prior `production` version (your revert
target), then mints a new `production`-labeled version from the in-repo body.
In-sync prompts are skipped, and it aborts without writing if drift detection
errors — so it's safe on an env that's only partially behind.

It writes straight to the `production` label (no `candidate-*` / eval gate),
so only use it once you're comfortable promoting. Target the env via its
`LANGFUSE_*` keys and **run once per environment**:

```bash
PK=$(aws --region eu-central-1 secretsmanager get-secret-value \
  --secret-id language-drill/LANGFUSE_PUBLIC_KEY --query SecretString --output text)
SK=$(aws --region eu-central-1 secretsmanager get-secret-value \
  --secret-id language-drill/LANGFUSE_SECRET_KEY --query SecretString --output text)

# Preview, then apply, then confirm. Inline creds bypass `.env`.
for flag in "--dry-run" ""; do
  LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
    pnpm --filter @language-drill/ai push-prompts $flag
done
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai bootstrap-prompts --check
```

Swap the secret prefix to `language-drill-dev/` for the dev project. To
revert, re-point the `production` label at the logged prior version in the
dashboard.

Wait at least 5 min after the label flip before §3, so the runtime cache is
guaranteed to have picked up the new body.

### B3. Revalidate the existing pool

Jump to [§4 — Revalidate the pool](#4-revalidate-the-pool).

---

## 3. Confirm the fix in prod traces

Before running the pool-wide revalidation, sanity-check that the runtime is
actually using the new prompt:

1. In Langfuse, filter recent traces by `promptVersion = <new-version>`
   (the bumped `*_PROMPT_VERSION` constant from §A4/§B1).
2. Spot-check a handful of fresh generations or validations — does the
   `submit_validation_result` tool input now carry the new dimension? Does
   the body match the new rule wording?
3. If you still see `promptVersion = <old>` on traces created after the
   label flip, the runtime caches are stale — either wait the full 5 min or
   force a Lambda redeploy.

Only proceed to §4 once you've seen the new prompt in live traces.

---

## 4. Revalidate the pool

`pnpm revalidate:cloze` re-runs the **current** validator over every stored
cloze (today's only supported type — extend the script if you need to
revalidate translation/vocab_recall) and demotes the failures. The script is
demote-only by design: validator verdicts can lower review status, never
raise it. See `packages/db/scripts/revalidate-cloze-pool.ts` for the full
policy table.

### 4.1 Prep: stage prod credentials

The script reads `DATABASE_URL` and `ANTHROPIC_API_KEY` from the env. To
point at prod without overwriting your local `.env`, pull the secrets from
AWS Secrets Manager (region is `eu-central-1` — note `aws` CLI defaults to
`us-east-1`):

```bash
PROD_DB=$(aws --region eu-central-1 secretsmanager get-secret-value \
  --secret-id language-drill/DATABASE_URL --query SecretString --output text)
PROD_ANTHROPIC=$(aws --region eu-central-1 secretsmanager get-secret-value \
  --secret-id language-drill/ANTHROPIC_API_KEY --query SecretString --output text)

cat > /tmp/language-drill-prod.env <<EOF
DATABASE_URL=${PROD_DB}
ANTHROPIC_API_KEY=${PROD_ANTHROPIC}
EOF
chmod 600 /tmp/language-drill-prod.env
```

`dotenv-cli` does not override existing env vars unless you pass `-o`, so an
inline `DATABASE_URL=...` also works. The `.env.prod` approach above is
easier to repeat across runs.

### 4.2 Smoke run — narrow + dry

Always start with a tiny dry-run scoped to where the bug surfaced. The goal
is to prove the connection works and the demotion list looks sane before
spending tokens on the full scan:

```bash
pnpm dotenv -e /tmp/language-drill-prod.env -- \
  pnpm --filter @language-drill/db revalidate:cloze -- \
  --language TR --cefr A1 --limit 10
```

You should see:
- Per-row demotion lines that match the failure mode the PR fixed.
- Reasons populated (`context spoils answer`, `ambiguous`, etc.).
- `mode: DRY-RUN (no writes)`.

If nothing demotes, the runtime probably isn't on the new prompt yet — go
back to §3.

### 4.3 Size the cost ceiling

The default cost cap is **$5**. With prompt caching warm, expect ~$0.005
per row after the first few calls. Quick pool-size check:

```bash
cat > packages/db/scripts/_count.mjs <<'EOF'
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  SELECT language, difficulty, review_status, COUNT(*)::int AS n
  FROM exercises
  WHERE type = 'cloze' AND review_status IN ('auto-approved', 'flagged')
  GROUP BY language, difficulty, review_status
  ORDER BY language, difficulty, review_status
`;
let total = 0;
for (const r of rows) {
  console.log(`  ${r.language}/${r.difficulty}  ${r.review_status.padEnd(13)}  ${r.n}`);
  total += r.n;
}
console.log(`---\nTotal candidate rows: ${total}`);
EOF
pnpm dotenv -e /tmp/language-drill-prod.env -- node packages/db/scripts/_count.mjs
rm packages/db/scripts/_count.mjs
```

The `.mjs` file is created **inside the repo** on purpose — running it from
`/tmp` fails to resolve `@neondatabase/serverless`. Always delete after use.

Pick a cap that comfortably covers `rows × $0.01` plus headroom. For ~900
rows, `--max-cost-usd 20` is plenty; the actual May-2026 run came in at
$4.77.

### 4.4 Full dry-run

```bash
pnpm dotenv -e /tmp/language-drill-prod.env -- \
  pnpm --filter @language-drill/db revalidate:cloze -- \
  --max-cost-usd 20 --concurrency 4 \
  2>&1 | tee /tmp/revalidate-cloze-dryrun.log | tail -20
```

905 rows at `--concurrency 4` ≈ 10–15 min. Read the summary block and
**before applying**:

- Per-cell breakdown — anywhere losing >30% of its auto-approved cells
  should be flagged so you can plan a backfill:

  ```bash
  awk '/^Demotions:/{f=1;next} /^Skip reasons:/{f=0} f && / → /' \
    /tmp/revalidate-cloze-dryrun.log \
    | sed -E 's/.* (ES|DE|TR|EN)\/(A1|A2|B1|B2|C1|C2) +(auto-approved|flagged) → (flagged|rejected) .*/\1\/\2 \3→\4/' \
    | sort | uniq -c | sort -rn
  ```

- Reason histogram — the top reasons should match the failure mode you
  fixed. If 80% of demotions are "low quality score (<0.5)" but the PR
  was about `contextSpoilsAnswer`, the validator may be over-firing on
  unrelated rows — investigate before applying.

  ```bash
  awk '/^Demotions:/{f=1;next} /^Skip reasons:/{f=0} f && / → /' \
    /tmp/revalidate-cloze-dryrun.log \
    | sed -E 's/.* qs=[0-9.]+  //' | tr ';' '\n' | sed -E 's/^ +//' \
    | sort | uniq -c | sort -rn | head -10
  ```

### 4.5 Apply

Identical command, `--apply` added:

```bash
pnpm dotenv -e /tmp/language-drill-prod.env -- \
  pnpm --filter @language-drill/db revalidate:cloze -- \
  --apply --max-cost-usd 20 --concurrency 4 \
  2>&1 | tee /tmp/revalidate-cloze-apply.log | tail -15
```

The validator is not seeded (temperature > 0), so demote counts can shift
by a handful between dry-run and apply. Watch for `update-failed` lines —
the script isolates per-row failures (logged, counted in skips, does not
abort) but if you see more than a handful, stop and investigate the DB.

### 4.6 Verify the writes

```bash
cat > packages/db/scripts/_verify.mjs <<'EOF'
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  SELECT language, difficulty, review_status, COUNT(*)::int AS n
  FROM exercises
  WHERE type = 'cloze'
  GROUP BY language, difficulty, review_status
  ORDER BY language, difficulty, review_status
`;
for (const r of rows) console.log(`  ${r.language}/${r.difficulty}  ${r.review_status.padEnd(15)}  ${r.n}`);
EOF
pnpm dotenv -e /tmp/language-drill-prod.env -- node packages/db/scripts/_verify.mjs
rm packages/db/scripts/_verify.mjs
```

Confirm the auto-approved counts dropped by roughly the demote totals from
the apply summary.

### 4.7 Plan backfill if needed

Pool cells that lost a big chunk may now be too thin to serve learners.
Find which grammar points took the biggest hits in the most-affected cell:

```sql
SELECT grammar_point_key,
       COUNT(*) FILTER (WHERE review_status = 'auto-approved') AS approved,
       COUNT(*) FILTER (WHERE review_status = 'rejected')      AS rejected
FROM exercises
WHERE type = 'cloze' AND language = '<lang>' AND difficulty = '<cefr>'
GROUP BY grammar_point_key
ORDER BY rejected DESC;
```

Then queue replacement generation per affected grammar point:

```bash
pnpm generate:exercises \
  --lang <lang> --level <cefr> --type cloze \
  --grammar-point <key> --count <30 or so>
```

Repeat for each grammar point until cell sizes are healthy. The generator
runs the **same** validator that just demoted the bad rows, so the new
drafts will be held to the corrected bar.

---

## 5. Clean up

```bash
rm -f /tmp/language-drill-prod.env \
      /tmp/revalidate-cloze-dryrun.log \
      /tmp/revalidate-cloze-apply.log
```

The prod creds file lives at mode 600 in `/tmp` and won't survive a reboot,
but explicit cleanup is the responsible default. The run logs may contain
exercise content — don't paste them into chat tools or attach to public
issues.

---

## 6. After-action notes

- Update this runbook if any step felt missing or wrong.
- If the failure mode the PR fixed slipped past the prompt + validator for
  weeks, consider adding an eval dataset that pins the pattern as a
  regression so future prompt edits get scored against it (`pnpm eval:export
  --from <pattern-introduction-date> ...`).
- Big demotion runs (>10% of a cell) deserve a one-line note in the PR
  description: how many rows demoted, total cost, peak cell impact.
