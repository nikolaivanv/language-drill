# Bug Analysis

## Root Cause Analysis

### Investigation Summary

The 502 originates inside `parseAnnotateResult` (`packages/ai/src/annotate.ts:186`), thrown when `raw.flagged` is not an array. The route handler `POST /read/annotate` (`infra/lambda/src/routes/read.ts:165`) catches every throw and returns `502 AI_UNAVAILABLE`, with the error message-only log we observed in CloudWatch.

I traced the data flow A1 user → annotate request → Claude tool-use → parser and cross-checked the relevant constants:

| Constant | Value | Source |
|---|---|---|
| `READ_TEXT_MAX_CHARS` | 2000 | `packages/shared/src/read.ts:19` |
| `READ_CEFR_TOP_RANK.A1` | **750** | `packages/shared/src/read.ts:32` |
| `READ_CEFR_TOP_RANK.B1` | 3000 | `packages/shared/src/read.ts:34` |
| `MODEL` (annotate) | `claude-sonnet-4-5` | `packages/ai/src/annotate.ts:224` |
| `MAX_TOKENS` (annotate) | **2048** | `packages/ai/src/annotate.ts:225` |
| `MAX_TOKENS` (evaluate) | 1024 | `packages/ai/src/evaluate.ts:210` |
| `tool_choice` | forced `submit_annotated_words` | `annotate.ts:252–255` |
| `temperature` | 0 | `annotate.ts:256` |

The A1 top_rank of 750 is the lowest of any level — virtually every content word in a typical passage is **rarer than rank 750 AND/OR above A1**. Combined with passages up to 2000 chars (~150–250 Turkish content words) and the seven-field per-flag schema (`matchedForm`, `lemma`, `pos`, `gloss`, `example`, `freq`, `cefr`), the expected tool-use JSON output for an A1 + Turkish input is on the order of **5,000–8,000 output tokens**. The 2048-token budget is therefore almost guaranteed to truncate the response mid-tool-call.

I also ruled out the secondary suspect from the report: the codebase is consistently on `claude-sonnet-4-5` (`evaluate.ts:207`, `validate.ts:39`, `generate.ts:47`, `annotate.ts:224`). The `claude-sonnet-4-6` mention in `CLAUDE.md` is documentation drift, not an active model-id mismatch.

The existing tests in `packages/ai/src/annotate.test.ts` cover non-array `flagged` shapes (line 161–165 — `"no"` string) and missing per-item fields, but no test simulates the **`stop_reason: 'max_tokens'` with a partial / empty tool-use input** branch — which is precisely the path the bug takes.

### Root Cause

Claude's tool-use response is being truncated by the 2048-token `max_tokens` budget. When the Anthropic SDK aggregates the streamed `input_json_delta` chunks into the `ToolUseBlock.input` field on a forcibly-cut response, the JSON it can parse is incomplete — the closing brackets for `flagged` (and possibly the array open) never arrived. The SDK yields either `{}` (no `flagged` key — typical when truncation occurs before any `]` is written) or an object where `flagged` is present but not array-typed. Either way, `Array.isArray(raw.flagged)` returns `false` at `annotate.ts:185` and the parser throws `"Annotate result.flagged must be an array"`.

The route handler then catches the throw and surfaces `502 AI_UNAVAILABLE` without logging `response.stop_reason` or the raw `toolUseBlock.input`, so the truncation signal that would have identified this immediately is lost.

### Contributing Factors

1. **`max_tokens` budget calibrated for evaluate, not annotate.** Annotate's output is unbounded in `N × 7-fields-with-prose`, while evaluate's is a small fixed-shape score object. Reusing 2048 (only 2× evaluate's 1024) was undersized from day one for A1-level users.
2. **No output cap in the prompt.** The system prompt asks Claude to flag *every* qualifying word with no upper bound — so output growth is purely a function of input size and user level.
3. **A1 is a worst-case for output volume**, and A1 was likely under-exercised during pre-merge testing (the existing tests use B1 / `topRank: 3000`).
4. **Parser swallows `stop_reason` and the offending payload.** `parseAnnotateResult` throws a string-only `Error`. The route logs only `err`. There is no way to distinguish "model returned malformed JSON" from "model truncated mid-call" from CloudWatch — exactly the diagnostic gap we hit.
5. **The route maps every throw uniformly to 502.** A truncation-due-to-output-size is a request-shape issue (retryable only after adjusting size or budget), not a generic transient AI failure, but the user-facing response and metric treat them identically.

## Technical Details

### Affected Code Locations

- **File**: `packages/ai/src/annotate.ts`
  - **Function/Method**: `annotateText()` + `parseAnnotateResult()`
  - **Lines**: `180–201` (parser), `224–225` (MODEL / MAX_TOKENS constants), `231–278` (caller)
  - **Issue**: `MAX_TOKENS = 2048` is too low for A1 passages; the caller does not surface `stop_reason` to the parser/route; the parser throws a non-diagnostic error when `flagged` is missing or non-array.

- **File**: `infra/lambda/src/routes/read.ts`
  - **Function/Method**: `POST /read/annotate` handler
  - **Lines**: `153–170`
  - **Issue**: Logs only `err` (no `stop_reason`, no raw response shape, no `language` / `proficiencyLevel` / `text.length` context). Maps every throw uniformly to 502 `AI_UNAVAILABLE`.

- **File**: `packages/shared/src/read.ts`
  - **Lines**: `19`, `31–38`
  - **Issue**: Not a defect — but `READ_TEXT_MAX_CHARS = 2000` paired with `READ_CEFR_TOP_RANK.A1 = 750` defines the output-volume upper bound that 2048 max-tokens cannot satisfy.

- **File**: `packages/ai/src/annotate.test.ts`
  - **Issue**: No coverage for `stop_reason: 'max_tokens'` with an empty/partial tool-use `input`. Closest existing case (`{ flagged: 'no' }` at line 162) is an artificial shape that doesn't match the real truncation behavior.

### Data Flow Analysis

```
Web client (Read page, Turkish, A1)
  └─► POST /read/annotate  { text, language: TR }
        └─► routes/read.ts:89  parse body, fetch user CEFR (= A1 from onboarding)
              └─► topRank = READ_CEFR_TOP_RANK['A1'] = 750
                    └─► annotateText(client, { text, language: TR, proficiencyLevel: A1, topRank: 750 })
                          └─► client.messages.create({ MODEL, max_tokens: 2048, tool_choice: submit_annotated_words, ... })
                                └─► Claude streams partial JSON for `flagged: [ {...}, {...}, ...`
                                      └─► [BREAK] response hits max_tokens before closing `]`
                                            └─► SDK returns toolUseBlock.input = {} (or partial, non-array `flagged`)
                                                  └─► parseAnnotateResult: Array.isArray(raw.flagged) === false  ⇒ throw
                                                        └─► route catch: console.error(err); return 502 AI_UNAVAILABLE
```

### Dependencies

- `@anthropic-ai/sdk` — partial-input aggregation behavior on `stop_reason: max_tokens` with `tool_choice: tool`.
- Claude `claude-sonnet-4-5` model — output verbosity for the annotate tool schema is the controlling variable.

## Impact Analysis

### Direct Impact

- `POST /read/annotate` returns 502 for A1 users on any Turkish passage that produces more than roughly 40–50 flag entries (the rough capacity of 2048 output tokens).
- Read & Collect is the entry point to vocabulary growth in the app; for A1 users it is effectively broken end-to-end.
- Likely also broken for A2 (top_rank 1500) and inconsistently for B1 on dense passages, even if the user reported it for A1 specifically.

### Indirect Impact

- Failed calls do not insert a `usage_events` row (correctly), so analytics will under-count Read activity and obscure the failure-rate signal in dashboards. The bug shows up only in CloudWatch error logs.
- `read_annotation` and `ai_evaluation` share a daily counter (`DAILY_EVAL_LIMIT = 50`), so a frustrated user retrying does not affect their cap — but every failed retry still costs an Anthropic invocation.

### Risk Assessment

- **If left unfixed**: the lowest-CEFR cohort cannot use Read & Collect; this disproportionately blocks the demographic least able to consume native text without scaffolding — the exact user the feature is designed for. Reputation/portfolio impact on a feature already deployed to production.

## Solution Approach

### Fix Strategy

A two-part fix, in order of priority:

**Part 1 — Eliminate truncation (primary, ships the user fix).**
- Raise `MAX_TOKENS` in `packages/ai/src/annotate.ts` from 2048 to **8192**. This comfortably covers the worst case (A1 + a 2000-char Turkish passage ≈ 5–7k output tokens) with margin and stays well below Sonnet's 64k output ceiling.
- Add an output cap to the system prompt: **"Flag at most 40 words per call. If more qualify, prioritize the rarest by corpus rank."** This bounds output deterministically so a single passage cannot blow the budget regardless of future input-size changes, and matches what the UI can usefully render anyway.

**Part 2 — Close the observability + error-shape gap (defensive, prevents the next silent failure).**
- In `annotateText`, after extracting `toolUseBlock`, inspect `response.stop_reason`. If it is `"max_tokens"`, throw a dedicated, descriptive error (`AnnotateTruncatedError`) before invoking the parser — so the failure mode is named, not inferred from a generic parser throw.
- In `parseAnnotateResult`, include the actual top-level keys of `raw` and the typeof `raw.flagged` in the thrown error message (e.g. `"Annotate result.flagged must be an array (got typeof undefined; keys: [])"`) so the CloudWatch log alone tells the next person what shape the model returned.
- In the route handler at `read.ts:165`, log `language`, `proficiencyLevel`, and `text.length` alongside `err` so we can correlate failures with input characteristics without re-deriving them.

### Alternative Solutions

- **Server-side chunking**: split the passage into N chunks, annotate each, merge `flagged` maps with first-seen dedup. *Rejected for v1*: triples the Anthropic round-trip cost for a problem that a token-budget bump solves directly, adds new edge cases (chunk boundary cutting a compound noun in DE), and the 29s Lambda timeout (PR #48) gives no headroom for sequential N-chunk calls.
- **Retry with larger `max_tokens` on truncation detection**: works but doubles latency on every A1 call. Better as a *fallback* layered on Part 1 if even 8192 turns out to be insufficient — not as the primary fix.
- **Stream the tool-use response and parse incrementally**: meaningful refactor; out of scope for a bug fix.
- **Tighten `READ_TEXT_MAX_CHARS` for low CEFR levels**: pushes the failure mode onto the user as a frontend constraint; worse UX, contradicts the "intermediate plateau" positioning where A1 is already the edge case to support gracefully.

### Risks and Trade-offs

- **Cost**: an 8192-token cap is the *ceiling*, not the typical spend — A1 calls will consume more output tokens than today, but realistic output is bounded by the new 40-word prompt cap. Budget impact is small relative to evaluate (which dominates AI cost overall).
- **Latency**: Sonnet's per-token output latency is roughly linear; an A1 worst-case call could grow from ~2–3s to ~5–8s. Well inside the new 29s Lambda timeout (PR #48), but worth eyeballing in CloudWatch after rollout.
- **Prompt cap (40 words) is a behavior change**: in extreme passages users would previously have received 502 (no result); they will now receive the rarest 40 words and the rest silently dropped. Acceptable for v1 — full coverage would require chunking — and far better than failing outright.

## Implementation Plan

### Changes Required

1. **Raise the annotate output budget**
   - File: `packages/ai/src/annotate.ts`
   - Modification: `const MAX_TOKENS = 2048;` → `const MAX_TOKENS = 8192;` (line 225). Keep as a `const` rather than promoting to a config to match the other AI modules' pattern.

2. **Cap output volume in the prompt**
   - File: `packages/ai/src/annotate.ts`
   - Modification: Append to `ANNOTATE_SYSTEM_PROMPT` (in the "Selection Rule" section) — `"Flag at most 40 words per call. If more than 40 words qualify, return the 40 rarest by corpus rank."` Mirrors the existing terse rule statements; no schema change needed.

3. **Detect truncation explicitly in the caller**
   - File: `packages/ai/src/annotate.ts`
   - Modification: After `const toolUseBlock = response.content.find(...)` (line 259) and after the existing tool-name check, add: `if (response.stop_reason === 'max_tokens') throw new Error('Claude annotation truncated by max_tokens (output too long)');`. Throw *before* invoking the parser so the dedicated error wins over the generic parser throw.

4. **Make the parser error self-describing**
   - File: `packages/ai/src/annotate.ts`
   - Modification: In `parseAnnotateResult` at line 186, change the throw message to include the typeof and the top-level keys: `` throw new Error(`Annotate result.flagged must be an array (got typeof ${typeof raw.flagged}; keys: [${Object.keys(raw).join(', ')}])`); ``. Same for the line-182 throw (`typeof input`).

5. **Add diagnostic context to the route log**
   - File: `infra/lambda/src/routes/read.ts`
   - Modification: At the catch (around line 165), expand the log to: `console.error('[POST /read/annotate] Claude annotation failed:', err, { language, proficiencyLevel, textLength: text.length });`. The route still returns 502 unchanged — only the log line grows.

6. **Cover the truncation path in tests**
   - File: `packages/ai/src/annotate.test.ts`
   - Modification: Add a `describe("annotateText — truncation")` block with two cases:
     - SDK returns `{ content: [{ type: 'tool_use', name: ANNOTATE_TOOL_NAME, input: {} }], stop_reason: 'max_tokens' }` → expect `annotateText` to reject with `/truncated by max_tokens/`.
     - SDK returns `{ content: [{ type: 'tool_use', name: ANNOTATE_TOOL_NAME, input: { flagged: null } }], stop_reason: 'max_tokens' }` → same expectation (truncation check fires before parser).
   - Update the existing `"rejects when flagged is not an array"` test in `parseAnnotateResult` to assert the new diagnostic message includes the typeof.

### Testing Strategy

- **Unit**: the two new truncation tests + the updated parser-message assertion in `packages/ai/src/annotate.test.ts`. Run `pnpm --filter @language-drill/ai test`.
- **Integration**: existing route tests in `infra/lambda/src/routes/read.test.ts` should remain green — the catch branch behavior is unchanged.
- **Full repo gate**: `pnpm lint && pnpm typecheck && pnpm test` from the repo root before push (per `CLAUDE.md`).
- **Manual verification (in `/bug-verify`)**:
  1. Local: `pnpm dev`, sign in as the Turkish-A1 dev user, paste a known-bad passage (the one that originally repro'd), confirm `200` and a populated `flagged` map.
  2. Preview deploy: same flow via the Vercel preview after merge to a PR branch.
  3. Production: smoke-check after deploy with the same passage.
  4. CloudWatch: trigger one synthetic truncation (e.g., temporarily lower MAX_TOKENS to 256 in a one-off branch) and confirm the log line now identifies it as `max_tokens` rather than the generic parser error. Revert.

### Rollback Plan

- All five code changes live in two files (`packages/ai/src/annotate.ts`, `infra/lambda/src/routes/read.ts`). Revert is a single `git revert <commit>` followed by `pnpm db:migrate` (no migrations) and a CDK redeploy.
- No schema changes, no API contract changes, no DB writes — the rollback is purely a Lambda redeploy of the prior image. Zero data risk.
- If post-deploy latency on A1 calls turns out to be unacceptable, intermediate fallback: leave Changes 3–5 in place and revert only the MAX_TOKENS bump (Change 1) + prompt cap (Change 2) by lowering the cap to a tighter number (e.g. `MAX_TOKENS = 4096`, "flag at most 25 words"). This narrows the worst case without losing the observability gains.
