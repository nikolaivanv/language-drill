# Bug Verification

## Fix Implementation Summary

Two files changed (`packages/ai/src/annotate.ts`, `infra/lambda/src/routes/read.ts`) plus a test addition (`packages/ai/src/annotate.test.ts`).

- `MAX_TOKENS` for `annotateText` raised from 2048 → **8192**, with a comment naming the A1 worst-case it was undersized for.
- System prompt now caps output to "AT MOST 40 words per call; return the 40 rarest if more qualify" — bounds output deterministically regardless of input size.
- `annotateText` now short-circuits with a dedicated `"Claude annotation truncated by max_tokens (output exceeded budget)"` error when `response.stop_reason === "max_tokens"`, so the truncation signal can't be masked by the generic parser throw.
- `parseAnnotateResult` errors now embed `typeof` of the offending value and the top-level keys — so a CloudWatch line alone identifies the malformed shape.
- `POST /read/annotate` catch logs now include `{ language, proficiencyLevel, textLength }` alongside the error.
- New `describe("max_tokens truncation")` block in the annotate test suite (two cases: `input: {}` and `input: { flagged: null }`, both with `stop_reason: "max_tokens"`), plus updated diagnostic-message assertion on the existing parser test.

Total diff: **3 files, 78 lines added, 6 removed.**

## Test Results

### Original Bug Reproduction

- [x] **Before Fix**: Bug reproduced in production CloudWatch (request id `0eade402-606f-40db-80b1-da200a3e9c04`, 2026-05-10T22:36:27Z). The error chain `Annotate result.flagged must be an array` → `parseAnnotateResult` → route catch → `502 AI_UNAVAILABLE` is the exact failure path the fix targets.
- [x] **After Fix (simulated unit)**: a `stop_reason: "max_tokens"` response with `input: {}` or `input: { flagged: null }` now rejects with `/truncated by max_tokens/i` — verified by the two new tests in `packages/ai/src/annotate.test.ts`. Realistic, non-truncated A1 calls fit comfortably within the new 8192-token budget (worst case ≈ 5–7k tokens; the 40-word prompt cap holds output well below that).
- [ ] **After Fix (live preview / production)**: requires deploy + manual repro by the user. Not exercised in this session — see "Deployment Verification" below.

### Reproduction Steps Verification

The original report's reproduction (sign in as Turkish-A1 user, paste a Turkish passage on the Read page, trigger Annotate) cannot be exercised from this session because it requires a deployed Lambda + a live Anthropic API call. Equivalence verification done via:

1. **Diff review** — every change in the analysis plan is present in the diff and nothing else has changed (`git diff --stat`: only `annotate.ts`, `annotate.test.ts`, `read.ts`).
2. **Unit-test simulation** — the exact SDK response shape that triggered the bug (`stop_reason: "max_tokens"` with a non-array `flagged`) is now exercised by two new tests and produces a named, descriptive error.
3. **Output-budget math** — A1 top_rank is 750; worst-case 2000-char Turkish passage ≈ 150 content words × ~50 tokens per 7-field flag ≈ ~7.5k tokens. The new 8192-token ceiling clears this with margin, and the 40-word prompt cap reduces realistic output to ≈ 2k tokens — well inside budget.

### Regression Testing

- [x] **`packages/ai` — annotate**: 26 tests pass, including the original "rejects when flagged is not an array" case (updated to assert the new diagnostic format).
- [x] **`packages/ai` — full**: 148 tests pass across 7 suites (was 146 pre-fix — +2 truncation tests).
- [x] **`infra/lambda`**: 298 tests pass across 18 suites — the `/read/annotate` route handler tests still green (route error shape and response code unchanged; only the log payload grew).
- [x] **`apps/web`**: 1,244 tests pass — the Read page reducer and consumer hooks are untouched.
- [x] **`packages/api-client`**: 506 tests pass — wire contract is unchanged.
- [x] **`packages/db`**, **`packages/shared`**, **`infra` (CDK)**: 130 + 64 + 22 tests pass — no schema or infra changes.
- **Workspace total**: **2,412 tests pass**, 0 fail (13 skipped, all pre-existing).

### Edge Case Testing

- [x] **Empty in-level passage**: existing test `"accepts an empty flagged array"` still passes — the truncation check fires *only* when `stop_reason === "max_tokens"`, so a legitimate empty-result response (`stop_reason: "tool_use"`, `input: { flagged: [] }`) still parses normally to `{ flagged: {} }`.
- [x] **Stop reason precedence**: the new truncation check is placed *after* the tool-name validation but *before* `parseAnnotateResult`, so a `stop_reason: "max_tokens"` with the wrong tool name still surfaces the more specific `"Unexpected tool name"` error rather than swallowing it as truncation.
- [x] **Malformed payload without truncation**: `parseAnnotateResult({})` and `parseAnnotateResult({ flagged: "no" })` continue to throw, now with the typeof + keys diagnostic embedded — verified by the updated parser test.
- [ ] **40-word cap behavior on a real passage > 40 qualifying words**: this is a prompt instruction, not a code path, so it can only be verified via a live model call. Listed as a follow-up in "Deployment Verification".

## Code Quality Checks

### Automated Tests

- [x] **Unit Tests**: 2,412 passing across 7 packages.
- [x] **Integration Tests**: route-level tests in `infra/lambda` cover the `/read/annotate` handler — all pass.
- [x] **Linting**: `pnpm lint` clean across 7 packages.
- [x] **Type Checking**: `pnpm typecheck` clean across 11 task targets.

### Manual Code Review

- [x] **Code Style**: matches the file's existing conventions — single-line `as const` model id, block comment above the `MAX_TOKENS` constant explaining why, dedicated branch placed alongside the other guard clauses in `annotateText`.
- [x] **Error Handling**: dedicated truncation error name is grep-able; diagnostic embeds `typeof` and `Object.keys` for cheap CloudWatch triage; route still maps every throw to `502 AI_UNAVAILABLE` (no contract change).
- [x] **Performance**: worst-case latency for an A1 call grows from ~2–3s to ~5–8s on truly maximal output, but the 40-word prompt cap keeps typical output near current sizes. Well within the 29s Lambda budget from PR #48.
- [x] **Security**: no new untrusted input parsed, no auth/permission changes, no secret handling changes. The expanded log includes `proficiencyLevel` and `textLength` but never `text` itself — no passage content leaks to CloudWatch.

## Deployment Verification

### Pre-deployment

- [x] **Local Testing**: full suite passes; diff is minimal and matches the analysis plan.
- [ ] **Staging Environment**: not applicable to this project — the project uses Vercel preview + production. Preview verification is the next step.
- [x] **Database Migrations**: none required (no schema changes).

### Post-deployment (to do — user action)

The unit tests are the regression guard, but the live fix can only be confirmed against the deployed Lambda. The following are owed by the next CI run + manual repro:

- [ ] **Preview Vercel deploy** — open a PR from `worktree-reading-annotation-bug`, let CI build the preview, sign in as the Turkish-A1 user, paste the originally failing passage, confirm a `200` response with a populated `flagged` map. Check CloudWatch on the preview Lambda for zero errors.
- [ ] **Production deploy** — after merge, repeat the smoke check against `api.langdrill.app`.
- [ ] **CloudWatch monitoring (24h)** — confirm `[POST /read/annotate] Claude annotation failed` no longer fires, OR if it does, the new log line identifies the cause (`truncated by max_tokens` vs. parser typeof / keys vs. SDK error).
- [ ] **Follow-up: 40-word cap behavior** — confirm via a deliberately dense Turkish passage that the model returns ≤40 flags ordered by rarity (matches the prompt instruction).

## Documentation Updates

- [x] **Code Comments**: added a 5-line block above `MAX_TOKENS` naming the A1 worst case and the 40-word prompt cap; a 4-line block above the truncation check explaining why it must precede the parser.
- [x] **README / CLAUDE.md**: no changes needed — `CLAUDE.md` references annotate only at the architecture level. (Side note unrelated to this bug: `CLAUDE.md` mentions `claude-sonnet-4-6` while the codebase is consistently on `claude-sonnet-4-5`; flagged in the analysis as documentation drift, not part of this fix.)
- [x] **Bug docs**: `report.md`, `analysis.md`, `verification.md` complete in `.claude/bugs/reading-annotation-502-error/`.

## Closure Checklist

- [x] **Original issue resolved (logical / unit-tested)**: the truncation path that produced the 502 now produces a named, diagnostic error and is exercised by tests.
- [ ] **Original issue resolved (live)**: pending preview + production deploy and a manual repro by the user.
- [x] **No regressions introduced**: 2,412 tests pass; no contract changes; no schema changes.
- [x] **Tests passing**: full workspace suite green.
- [x] **Documentation updated**: code comments + bug docs.
- [ ] **Stakeholders notified**: N/A — single-author project; user is the stakeholder.

## Notes

- The fix targets the **root cause** (undersized output budget for the worst-case input) and the **observability gap** (generic parser error masking the real failure mode) in the same change. Either part on its own would be a partial fix.
- A natural follow-up — not part of this bug — is to apply the same observability discipline (`stop_reason` short-circuit + typeof/keys diagnostic in parser errors) to `evaluate.ts`, `validate.ts`, and `generate.ts`, which share the same tool-use parsing pattern and the same blind spot. Worth a small PR after this one ships.
- One thing this fix does **not** do: it does not auto-retry on truncation. If even the 8192-token budget + 40-word cap turns out to be insufficient in the wild, the dedicated truncation error gives a clean place to add a single retry with a larger budget later.
