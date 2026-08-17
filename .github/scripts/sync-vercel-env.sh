#!/usr/bin/env bash
#
# Upsert a single environment variable into the Vercel project, via the REST API.
#
# Replaces `vercel env rm <name> <target> --yes || true` followed by
# `echo <value> | vercel env add <name> <target>`, which was broken two ways:
#
#   1. INTERACTIVE PROMPT. `vercel env add <name> preview` asks for an optional
#      Git branch ("Leave empty to apply to all Preview branches"). Under CI,
#      stdin carries only the value — the CLI consumes it ("Removed trailing
#      newline from stdin input") and the follow-up prompt then hits EOF:
#
#        ? Git branch?
#        Error: An unexpected error occurred in env:
#               Error: User force closed the prompt with 0 null
#
#      The `production` target has no Git-branch concept and so never prompts,
#      which is why only the preview job failed — on every deploy from at least
#      2026-08-16 (#655) through #658. Passing the `[gitbranch]` positional is
#      NOT the fix: it would scope the variable to one branch, where we want it
#      to apply to all preview branches.
#
#   2. DESTRUCTIVE ORDER. `rm` ran before `add`, so a failing `add` left the
#      variable DELETED rather than stale. That is how preview lost
#      NEXT_PUBLIC_ANNOTATE_STREAM_URL outright — the `rm` in the last run
#      logged "Environment Variable was not found", i.e. there was nothing left
#      to remove.
#
# `POST /v10/projects/{id}/env?upsert=true` creates-or-updates in one
# non-interactive call: no prompt to hang on, and no window where the variable
# is absent. It is also CLI-version-independent, which the failure mode above
# was not.
#
# Required env: VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID,
#               ENV_KEY, ENV_VALUE, ENV_TARGET (production|preview|development).
set -euo pipefail

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${VERCEL_ORG_ID:?VERCEL_ORG_ID is required}"
: "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID is required}"
: "${ENV_KEY:?ENV_KEY is required}"
: "${ENV_VALUE:?ENV_VALUE is required}"
: "${ENV_TARGET:?ENV_TARGET is required}"

# A stray CR/LF would be stored verbatim and produce a URL that fails only at
# runtime, in the browser — expensive to trace back to here.
value=$(printf '%s' "$ENV_VALUE" | tr -d '\r\n')
if [ -z "$value" ]; then
  echo "::error::ENV_VALUE for ${ENV_KEY} is empty after trimming"
  exit 1
fi

# `plain` (not the CLI's default `encrypted`): NEXT_PUBLIC_* values are inlined
# into the client bundle, so they are public by construction — the CLI itself
# warns as much. Storing them readable keeps the dashboard usable for spotting
# exactly the kind of drift this script exists to prevent.
body=$(jq -n \
  --arg key "$ENV_KEY" \
  --arg value "$value" \
  --arg target "$ENV_TARGET" \
  '{key: $key, value: $value, type: "plain", target: [$target]}')

# Overridable so the error paths below can be exercised against a local stub;
# CI never sets it.
api_base="${VERCEL_API_BASE:-https://api.vercel.com}"

response=$(mktemp)
status=$(curl -sS -o "$response" -w '%{http_code}' -X POST \
  "${api_base}/v10/projects/${VERCEL_PROJECT_ID}/env?upsert=true&teamId=${VERCEL_ORG_ID}" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$body")

if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
  echo "::error::Vercel env upsert for ${ENV_KEY} (${ENV_TARGET}) failed with HTTP ${status}: $(cat "$response")"
  exit 1
fi

# A 2xx can still carry per-variable errors in `failed[]`. Without this check the
# step would go green having changed nothing — the same silent-success mode the
# old `|| true` pipeline had.
failed_count=$(jq -r '.failed // [] | length' "$response")
if [ "$failed_count" != "0" ]; then
  echo "::error::Vercel env upsert for ${ENV_KEY} (${ENV_TARGET}) reported failures: $(jq -c '.failed' "$response")"
  exit 1
fi

echo "Upserted ${ENV_KEY} for target ${ENV_TARGET}."
