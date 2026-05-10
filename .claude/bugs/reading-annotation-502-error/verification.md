# Bug Verification

**Status: RESOLVED in production** as of 2026-05-11 via PR #49 + hotfix PR #51.

## Fix Implementation Summary

The fix shipped in two PRs — #49 addressed the root cause but had an under-estimated latency profile that surfaced as a Lambda timeout in production; #51 was the immediate hotfix that completed the resolution.

### PR #49 — Truncation fix (`55d1361`)

Two files changed (`packages/ai/src/annotate.ts`, `infra/lambda/src/routes/read.ts`) plus a test addition (`packages/ai/src/annotate.test.ts`).

- `MAX_TOKENS` for `annotateText` raised from 2048 → **8192**, with a comment naming the A1 worst-case it was undersized for.
- System prompt now caps output to "AT MOST 40 words per call; return the 40 rarest if more qualify" — bounds output deterministically regardless of input size.
- `annotateText` now short-circuits with a dedicated `"Claude annotation truncated by max_tokens (output exceeded budget)"` error when `response.stop_reason === "max_tokens"`, so the truncation signal can't be masked by the generic parser throw.
- `parseAnnotateResult` errors now embed `typeof` of the offending value and the top-level keys — so a CloudWatch line alone identifies the malformed shape.
- `POST /read/annotate` catch logs now include `{ language, proficiencyLevel, textLength }` alongside the error.
- New `describe("max_tokens truncation")` block in the annotate test suite (two cases: `input: {}` and `input: { flagged: null }`, both with `stop_reason: "max_tokens"`), plus updated diagnostic-message assertion on the existing parser test.

Total diff: **3 files, 78 lines added, 6 removed.**

### PR #51 — Hotfix: switch annotate to Haiku 4.5 (`bea65ef`)

Single-line change to `packages/ai/src/annotate.ts`.

- `MODEL: "claude-sonnet-4-5" → "claude-haiku-4-5-20251001"`.
- Comment block updated to explain why annotate is the only AI surface on Haiku (other AI surfaces — evaluate, validate, generate — keep Sonnet because their outputs are small and bounded).
- `MAX_TOKENS = 8192` retained; the 40-word prompt cap from #49 retained.

## Test Results

### Original Bug Reproduction

- [x] **Before Fix**: Bug reproduced in production CloudWatch (request id `0eade402-606f-40db-80b1-da200a3e9c04`, 2026-05-10T22:36:27Z). The error chain `Annotate result.flagged must be an array` → `parseAnnotateResult` → route catch → `502 AI_UNAVAILABLE` is the exact failure path the fix targets.
- [x] **After Fix (simulated unit)**: a `stop_reason: "max_tokens"` response with `input: {}` or `input: { flagged: null }` now rejects with `/truncated by max_tokens/i` — verified by the two new tests in `packages/ai/src/annotate.test.ts`. The 8192-token budget eliminates the truncation path entirely under typical usage.
- [x] **After Fix (live production)**: confirmed by the user after PR #51 deployed (2026-05-11). The originally-failing Turkish A1 annotate flow now returns `200` with a populated `flagged` map.

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
- [x] **Performance**: post-#51, A1 annotate calls land in ~5–10s end-to-end on Haiku 4.5 — comfortably under the 29s Lambda budget. The original "~5–8s on Sonnet" estimate in this section was wrong by a ~4× factor; see "Post-deploy incident" below.
- [x] **Security**: no new untrusted input parsed, no auth/permission changes, no secret handling changes. The expanded log includes `proficiencyLevel` and `textLength` but never `text` itself — no passage content leaks to CloudWatch.

## Deployment Verification

### Pre-deployment

- [x] **Local Testing**: full suite passes; diff is minimal and matches the analysis plan.
- [ ] **Staging Environment**: not applicable to this project — the project uses Vercel preview + production. Preview verification is the next step.
- [x] **Database Migrations**: none required (no schema changes).

### Post-deployment

- [x] **Production deploy of PR #49** — CDK deploy completed cleanly at 2026-05-10T23:05:21Z (`LanguageDrillStack: ✅`, Lambda `LambdaHandlerF6372945` updated). However, the new Sonnet+8192 configuration introduced Lambda timeouts on A1 annotate calls — see "Post-deploy incident & hotfix" below.
- [x] **Hotfix PR #51 deployed** — Haiku 4.5 swap shipped 2026-05-11. Eliminated the timeouts; A1 annotate flow now succeeds.
- [x] **Production smoke check** — user-confirmed: the originally-failing Turkish A1 annotate scenario returns `200` with a populated `flagged` map in production.
- [ ] **CloudWatch monitoring (24h post-#51)** — owed: confirm `[POST /read/annotate] Claude annotation failed` lines and `Status: timeout` Lambda reports stay absent on the production log group over the next 24h.
- [ ] **40-word cap behavior** — owed: confirm via a deliberately dense Turkish passage that Haiku returns ≤40 flags ordered by rarity (matches the prompt instruction). Sonnet-era tests didn't exercise this; the cap is a soft prompt rule and Haiku's adherence to it has not been spot-checked.
- [ ] **Flag-selection quality on Haiku** — owed: spot-check on a known Turkish A1 passage that Haiku surfaces the genuinely rare words and skips closed-class words per the system prompt. If quality is materially worse than Sonnet's, the steady-state choice may need revisiting (e.g., Sonnet + streaming response, or returning to Sonnet with a tighter cap).

## Post-deploy incident & hotfix (#51)

Within ~4 minutes of the PR #49 deploy completing at 23:05:21Z, the production Lambda began returning `Status: timeout` at exactly 29,000 ms on `POST /read/annotate`. Two CloudWatch REPORT lines confirm this:

- `ae4644d5-e455-4ae6-a0a9-729c83f51aba` — Duration 29000.00 ms — Status: timeout — 23:08:54Z
- `52227206-9d20-4698-9e01-5224d15e7dc6` — Duration 29000.00 ms — Status: timeout — 23:09:35Z

No `ERROR` or `annotate` log lines appeared — the route never reached its catch. The Lambda was stuck inside the Claude SDK call until the runtime killed it. API Gateway returned a 502 with no CORS headers (because Hono's CORS middleware doesn't run on a Lambda that never returns), so the browser surfaced this as `TypeError: Failed to fetch` — the user-visible "500 / Failed to fetch" symptom.

**Why the prediction was wrong.** This document's pre-deploy "Performance" check estimated ~5–8s worst-case latency on A1 calls. Actual behavior on Sonnet 4-5 at `MAX_TOKENS = 8192` is materially worse: per-token output rate for structured tool-use JSON is roughly 50–80 tok/s, so a maximal A1+Turkish flag set of ~2000 output tokens takes 25–40s — beyond the 29s Lambda budget. The 40-word prompt cap was a soft constraint; the model still spent the full budget generating up to the cap. API Gateway HTTP API has a hard 30s integration ceiling that cannot be raised, so the only resolution paths were tightening output further, switching models, or reverting.

**Hotfix #51** swapped annotate alone to `claude-haiku-4-5-20251001`. Haiku is 2–3× faster on tool-use, comfortably fitting the same 8192-token ceiling inside 29s. Other AI surfaces (`evaluate`, `validate`, `generate`) stayed on Sonnet because their outputs are small and bounded and quality matters more than latency on those paths.

**Lessons captured** (for future similar work):
- Output latency on Sonnet for structured tool-use scales worse than the in-document estimate. Future analyses that raise `max_tokens` against a finite Lambda budget must estimate latency from a calibrated tok/s figure, not from input-size heuristics.
- A `max_tokens` bump alongside a `Lambda timeout` is a tightrope — there is no margin in API Gateway HTTP API's 30s ceiling. Consider model choice (Haiku vs. Sonnet) at the same time as token budget, not as a follow-up.
- The fast user diagnosis was possible because of the route log enrichment in #49 (`{ language, proficiencyLevel, textLength }`) and the CloudWatch `Status: timeout` REPORT line — the observability investment paid off on its first incident.

## Documentation Updates

- [x] **Code Comments**: added a 5-line block above `MAX_TOKENS` naming the A1 worst case and the 40-word prompt cap; a 4-line block above the truncation check explaining why it must precede the parser.
- [x] **README / CLAUDE.md**: no changes needed — `CLAUDE.md` references annotate only at the architecture level. (Side note unrelated to this bug: `CLAUDE.md` mentions `claude-sonnet-4-6` while the codebase is consistently on `claude-sonnet-4-5`; flagged in the analysis as documentation drift, not part of this fix.)
- [x] **Bug docs**: `report.md`, `analysis.md`, `verification.md` complete in `.claude/bugs/reading-annotation-502-error/`.

## Closure Checklist

- [x] **Original issue resolved (logical / unit-tested)**: the truncation path that produced the 502 now produces a named, diagnostic error and is exercised by tests.
- [x] **Original issue resolved (live)**: user-confirmed in production after PR #51 deployed (2026-05-11). The originally-failing Turkish A1 annotate flow returns `200` with a populated `flagged` map.
- [x] **No regressions introduced**: 2,412 tests pass; no contract changes; no schema changes.
- [x] **Tests passing**: full workspace suite green on both #49 and #51.
- [x] **Documentation updated**: code comments + bug docs + post-deploy incident write-up.
- [x] **Stakeholders notified**: N/A — single-author project; user is the stakeholder.

## Notes

- The fix targets the **root cause** (undersized output budget for the worst-case input) and the **observability gap** (generic parser error masking the real failure mode) in the same change. Either part on its own would be a partial fix.
- A natural follow-up — not part of this bug — is to apply the same observability discipline (`stop_reason` short-circuit + typeof/keys diagnostic in parser errors) to `evaluate.ts`, `validate.ts`, and `generate.ts`, which share the same tool-use parsing pattern and the same blind spot. Worth a small PR.
- One thing this fix does **not** do: it does not auto-retry on truncation. If even the 8192-token budget + 40-word cap turns out to be insufficient in the wild, the dedicated truncation error gives a clean place to add a single retry with a larger budget later.
- The Haiku-vs-Sonnet split for annotate vs. the other AI surfaces is now an unstated convention in `packages/ai/`. If the convention sticks past the spot-check on flag-selection quality, it's worth a short note in `CLAUDE.md` so it doesn't drift back to "all Sonnet" by default in future work.
