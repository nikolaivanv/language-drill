# Phase 2 — Post-deploy verification runbook

Operator checklist for **Task 31** of `langfuse-implementation-phase-2`. Run
all six scenarios end-to-end after the PR merges and the dev CDK deploy
completes. Tick each `[ ]` as it passes. Anything that fails: open a bug
against this spec; do not consider Phase 2 shipped until all six are green.

**Target environment:** dev only (Langfuse project `language-drill-dev`, API
`api-dev.langdrill.app`, Vercel preview).

**Preconditions:**

- Phase 2 PR merged to `main`.
- `.github/workflows/deploy.yml` has finished both the CDK and Vercel jobs
  for the merge commit. Confirm via `gh run list --workflow=deploy` →
  status `success`.
- You have the dev Langfuse keys in `language-drill/LANGFUSE_PUBLIC_KEY` /
  `language-drill/LANGFUSE_SECRET_KEY` (AWS Secrets Manager, dev prefix).
- You have a working local clone of `main` with `pnpm install` run.

Quote the trace ID / dataset run URL / Langfuse prompt URL in each tick so
this checklist is also the audit record.

---

## Scenario 1 — Bootstrap the prompt registry

_Requirements: 1.1, 1.2, 1.3_

- **Command:**
  ```bash
  pnpm bootstrap-prompts
  ```
  Run from the repo root with your `.env` pointed at the dev Langfuse
  project (`LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` from dev secrets).
- **Pass condition:** stdout lists **6 created** rows on a fresh project,
  or **6 already-exist / 0 created** on a re-run. Open the Langfuse UI →
  *Prompts* and confirm all six names appear:
  - [ ] `evaluate-system-prompt` (label `production`)
  - [ ] `annotate-system-prompt` (label `production`)
  - [ ] `generate-system-prompt` (label `production`)
  - [ ] `validate-system-prompt` (label `production`)
  - [ ] `theory-generate-system-prompt` (label `production`)
  - [ ] `theory-validate-system-prompt` (label `production`)
- **Re-run idempotency:** invoke the command a second time → expected
  output "exists, skipping" × 6, **0 creates**.
  - [ ] Re-run prints zero creates.

---

## Scenario 2 — Live trace carries `promptVersion=langfuse:1`

_Requirements: 2.1, 2.6, 4.1, 4.2_

- **Setup:** open the dev Vercel preview (or `apps/web` pointed at the dev
  API) and sign in. Pick any pool exercise.
- **Action:** submit one answer. Note the timestamp.
- **Pass condition:** in the Langfuse UI → *Traces*, sort by start time,
  open the most recent `feature:evaluate` trace.
  - [ ] `metadata.promptVersion` equals `langfuse:1` (not `fallback:...`).
  - [ ] `metadata.promptFallback` is `false` (or absent — design treats
    missing as "not fallback").
  - [ ] Trace ID quoted here: `__________________________________`

---

## Scenario 3 — Edit the `production` prompt → next trace picks up v2

_Requirements: 2.6, 4.2_

This is the headline "ship a prompt without deploy" loop.

- **Steps:**
  1. In Langfuse UI → *Prompts* → `evaluate-system-prompt` → open v1 →
     *New version*. Make a small, non-semantic edit (add a trailing
     comment line or whitespace — we want to verify the round-trip, not
     change Claude's behaviour). Save as v2.
  2. Move the `production` label from v1 to v2 (drag the label in the UI).
  3. Wait either ≥ 5 min (cache TTL) or trigger a Lambda cold start by
     running `aws lambda update-function-configuration --function-name
     LanguageDrillStack-dev-ApiFunction --description "force-cold-$(date +%s)"`.
  4. Submit one more answer from `apps/web`.
- **Pass condition:** the new trace shows:
  - [ ] `metadata.promptVersion` equals `langfuse:2`.
  - [ ] `metadata.promptFallback` is `false`.
  - [ ] New trace ID quoted here: `__________________________________`
- **Cleanup:** move the `production` label back to v1 (we want v1 to be
  the live prompt going forward — v2 was for testing only). Delete v2 if
  the UI allows it.
  - [ ] `production` label is back on v1.

---

## Scenario 4 — Langfuse outage → fail-soft fallback

_Requirements: 2.5, 4.2, 7.1, NFR-2_

This proves the runtime never blocks a Claude call on Langfuse.

- **Setup:** temporarily break the Langfuse base URL on the dev Lambda:
  ```bash
  aws lambda update-function-configuration \
    --function-name LanguageDrillStack-dev-ApiFunction \
    --environment "Variables={LANGFUSE_BASE_URL=https://bogus.example,...other vars...}"
  ```
  Or for a one-off test, set `LANGFUSE_BASE_URL=https://bogus.example` in
  the Lambda console → *Configuration* → *Environment variables* (and copy
  the existing var list so you don't accidentally drop anything).
- **Action:** wait ≥ 5 min for the prompt cache to expire (or force a
  cold start as in Scenario 3), then submit one answer from `apps/web`.
- **Pass condition:** the resulting trace shows:
  - [ ] `metadata.promptVersion` equals `fallback:evaluate@<YYYY-MM-DD>`
    where the date matches `EVALUATION_SYSTEM_PROMPT_VERSION` in
    `packages/ai/src/prompts.ts`.
  - [ ] `metadata.promptFallback` is `true`.
  - [ ] User-facing UX is unchanged — the evaluation result returned
    normally; no error banner.
  - [ ] Trace ID quoted here: `__________________________________`
- **Cleanup:** remove the bogus `LANGFUSE_BASE_URL` (delete the env var
  entirely, or revert to the default — the SDK falls back to
  `https://cloud.langfuse.com` when unset).
  - [ ] Lambda env restored. Confirm by submitting one more answer and
    verifying `promptFallback=false` is back.

---

## Scenario 5 — `eval:export` produces a working dataset

_Requirements: 5.1, 5.2, 5.3, 5.5, 5.6_

By this point the dev Langfuse project has ≥ a handful of `feature:evaluate`
traces from scenarios 2–4. Use those as the source.

- **Command:**
  ```bash
  pnpm eval:export --from 2026-05-10 --to 2026-05-17 --sample 10 --dataset eval-smoke
  ```
  Adjust `--from` / `--to` to a window that covers your scenarios 2–4
  submissions. `--sample 10` is fine even if there are < 10 traces; the
  CLI samples up to the requested count.
- **Pass condition:**
  - [ ] stdout reports `fetched N, sampled M` with M ≤ N and M ≤ 10.
  - [ ] Langfuse UI → *Datasets* → `eval-smoke` exists and contains M
    items.
  - [ ] Each item has `metadata.submissionId`, `metadata.language`,
    `metadata.cefrLevel`, `metadata.exerciseType`, and
    `metadata.localPromptVersion` populated.
  - [ ] Each item's `input.exercise` and `input.userAnswer` are non-empty
    (the Drizzle join to `user_exercise_history` worked).
- **Dedupe check:** re-run the exact same command.
  - [ ] Second run reports `fetched N, sampled M` but creates **0** new
    dataset items (all `submissionId`s are already in the set).

---

## Scenario 6 — `eval` against the smoke dataset

_Requirements: 6.1, 6.7, 8.1, 8.4_

This is the final acceptance gate — proves the candidate-prompt iteration
loop closes end-to-end.

- **Command:**
  ```bash
  pnpm eval --dataset eval-smoke --candidate langfuse:evaluate-system-prompt@production
  ```
  (Using `@production` as the "candidate" makes this a sanity baseline run
  — the candidate is identical to what live traffic uses, so quality
  deltas should hover near zero. Use this as the calibration run.)
- **Pass condition:**
  - [ ] stdout prints a markdown table containing **all** of these
    column headers: `score`, `grammarAccuracy`, `taskAchievement`,
    `errorCountDelta`, `cefr.agreementRate`, `cefr.avgDistance`,
    `costUsd.candidate`, `latencyMs.candidate`.
  - [ ] `./eval-runs/<runName>.json` is written and parses as JSON.
    The file has `perItem` populated with one entry per dataset item.
  - [ ] CLI exits with code 0 (no per-item errors).
  - [ ] Langfuse UI → *Datasets* → `eval-smoke` → *Runs* → `<runName>`
    page lists all M items, each with a linked trace. Click one trace
    and confirm `metadata.promptVersion` starts with `eval-run:<sha8>`.
  - [ ] Run JSON file path quoted here: `__________________________________`
- **Production-guard sanity check:** set `LANGFUSE_ENV=prod` in your
  shell and re-run the same command.
  ```bash
  LANGFUSE_ENV=prod pnpm eval --dataset eval-smoke --candidate langfuse:evaluate-system-prompt@production
  ```
  - [ ] CLI refuses to run (non-zero exit, message mentioning
    `--allow-prod`). No Anthropic calls were made.

---

## Sign-off

When **every** box above is ticked, Phase 2 is shipped:

- [ ] All scenarios 1–6 passed.
- [ ] Mark task 31 complete in `tasks.md` (`- [x] 31. Manual post-deploy verification ...`).
- [ ] Capture the trace IDs / run name from this checklist in the PR
      description (or a follow-up comment) for audit.

If any scenario regressed: open a bug against the spec referencing this
runbook and the specific scenario number before considering the work
complete.
