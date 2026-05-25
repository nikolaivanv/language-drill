# Sync Prompts Command

Sync the in-repo `*_SYSTEM_PROMPT` source to the live Langfuse `production`
label so the runtime stops serving the stale body after a merged prompt edit.

## Usage
```
/sync-prompts [prod|dev|both]
```
- No argument → **prod** (default).
- `dev` → sync the dev Langfuse project only.
- `both` → sync prod, then repeat the same flow for dev.

## What this does (and does not)

This wraps the canonical sequence from `CLAUDE.md` (§Prompt Editing) and
`docs/runbooks/prompt-update-and-revalidate.md` (§2B.2): detect drift between
the in-repo prompt source and the live `production` label, preview it, push the
drifted prompts, and verify. It is **prompt sync only** — it does **not**
revalidate the existing exercise pool. For a generation/validation fix that also
needs a re-pass over stored exercises, follow
`docs/runbooks/prompt-update-and-revalidate.md` (§4) after this.

The six prompts and their version constants:

| Prompt file (`packages/ai/src/`) | Version constant |
|---|---|
| `prompts.ts` | `EVALUATION_SYSTEM_PROMPT_VERSION` |
| `annotate.ts` | `ANNOTATE_SYSTEM_PROMPT_VERSION` |
| `generation-prompts.ts` | `GENERATION_PROMPT_VERSION` |
| `validation-prompts.ts` | `VALIDATION_PROMPT_VERSION` |
| `theory-prompts.ts` | `THEORY_GENERATION_PROMPT_VERSION` |
| `theory-validation-prompts.ts` | `THEORY_VALIDATION_PROMPT_VERSION` |

## Instructions

You are running the Langfuse prompt-sync workflow. Treat the apply step as an
outward-facing, hard-to-reverse action: it rewrites the `production` prompt body
that live Lambda traffic reads.

### 0. Resolve the target environment

Parse the argument (`prod` default, `dev`, or `both`). Map env → AWS Secrets
Manager prefix. **Region is always `eu-central-1`** (the CLI defaults to
us-east-1 — always pass `--region eu-central-1`):

- **prod** → prefix `language-drill/`
- **dev** → prefix `language-drill-dev/`

For `both`, run steps 1–6 fully against prod first, then repeat against dev.

### 1. Pre-flight checks (no writes)

Before touching Langfuse, confirm:

1. The in-repo `*_SYSTEM_PROMPT` edit you intend to publish is **merged** (the
   runtime fetches the body from Langfuse, so the source must already reflect the
   final text). Check `git log`/`git status` if unsure.
2. The matching `*_PROMPT_VERSION` constant was bumped to today's date
   (`<surface>@YYYY-MM-DD`) in the **same commit** as the prompt edit. If not,
   stop and tell the user — Langfuse cohorts traces by `promptVersion`, so a
   missing bump collapses old and new populations. Do not push until this is
   fixed.

Report which of the six prompts the user changed (or note that the sync will
simply push whatever has drifted).

### 2. Fetch Langfuse credentials for the target env

```bash
PK=$(aws --region eu-central-1 secretsmanager get-secret-value \
  --secret-id <PREFIX>LANGFUSE_PUBLIC_KEY --query SecretString --output text)
SK=$(aws --region eu-central-1 secretsmanager get-secret-value \
  --secret-id <PREFIX>LANGFUSE_SECRET_KEY --query SecretString --output text)
```

Substitute `<PREFIX>` with `language-drill/` (prod) or `language-drill-dev/`
(dev). If either fetch fails, stop and report — do not continue with empty creds.

### 3. Detect drift (read-only)

```bash
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" \
LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai bootstrap-prompts --check
```

`--check` does a byte-for-byte comparison of each live `production` body against
the in-repo source and **exits 1 on any mismatch** (or fetch error). Interpret:

- **Exit 0** → everything is already in sync. Report "no drift, nothing to push"
  and stop (for this env).
- **Exit 1** → drift (or an error). Show the user which prompts differ. If the
  non-zero was caused by a 404/auth/network error rather than real drift, stop
  and surface it — do not push blind.

### 4. Preview the push (no writes)

```bash
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" \
LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai push-prompts --dry-run
```

Summarize exactly which prompts would get a new `production`-labeled version.
Only the drifted ones are touched; in-sync prompts are skipped.

### 5. Confirmation gate — STOP HERE

Do **not** run the apply step automatically. The next command rewrites the
production prompt body served to live traffic. Present the dry-run summary and
explicitly ask the user to confirm they want to push to **<env>**. Wait for an
affirmative reply. If syncing `both`, confirm separately per environment.

### 6. Apply (only after explicit approval)

```bash
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" \
LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai push-prompts
```

`push-prompts` logs each prompt's **prior `production` version number** before
writing — this is the revert target. Capture and report these numbers; the user
needs them to roll back from the Langfuse dashboard.

### 7. Verify in sync

```bash
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" \
LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai bootstrap-prompts --check
```

Expect **exit 0**. If it still reports drift, the push didn't fully land —
investigate before declaring done.

### 8. Closeout

Report to the user:
- Which prompts were pushed and their revert-target versions.
- The runtime picks up the new body within **~5 min** (Lambda module-scope cache
  TTL); cold starts see it sooner.
- To revert: re-point the `production` label at the logged prior version in the
  Langfuse dashboard.
- If this prompt change also requires re-scoring the existing exercise pool
  (generation/validation fixes), continue with
  `docs/runbooks/prompt-update-and-revalidate.md` (§4) — that is out of scope for
  this skill.

## Critical rules
- **NEVER** run `push-prompts` (without `--dry-run`) before the user confirms.
- **ALWAYS** pass `--region eu-central-1` to the AWS CLI.
- **ALWAYS** run `bootstrap-prompts --check` before and after the push.
- **STOP** if pre-flight finds an unbumped `*_PROMPT_VERSION` or an unmerged edit.
- For `both`, treat prod and dev as independent runs with independent confirmations.
