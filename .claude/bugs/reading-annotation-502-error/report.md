# Bug Report

## Bug Summary

`POST /read/annotate` returns **502 AI_UNAVAILABLE** when annotating a Turkish A1 passage. The Lambda log shows the failure originates inside `parseAnnotateResult` with the message `Annotate result.flagged must be an array` — i.e. Claude's tool-use payload does not match the expected shape, so the parser throws and the route maps the throw to 502.

## Bug Details

### Expected Behavior

`POST /read/annotate` returns `200` with an `AnnotateOutput` body (`{ flagged: Record<string, WordFlag> }`). For an in-level Turkish A1 passage with no qualifying words, the response should be `{ flagged: {} }`.

### Actual Behavior

The backend responds with `502` and `{ error: 'Evaluation temporarily unavailable', code: 'AI_UNAVAILABLE' }`. The Read page surfaces this as an annotation failure.

### Steps to Reproduce

1. Sign in as a user whose Turkish proficiency is set to **A1** during onboarding.
2. Open the **Read** page in either a Vercel preview deployment or production with Turkish as the active learning language.
3. Paste a Turkish passage (which is expected to contain words above A1) and trigger **Annotate**.
4. Observe a 502 response from `POST /read/annotate` and an annotation failure in the UI.

Note: A1 is the user's onboarding-configured level, not a property of the passage. Because the passage almost certainly contains words above A1, the call to Claude is expected to return a *non-empty* `flagged` array — so an "empty-array coercion" failure mode is unlikely to be the trigger here.

### Environment

- **Version**: branch `main` @ `b9cc3d4` (PR #48 merged — Lambda timeout raised to 29s).
- **Platform**: AWS Lambda (production + preview), API Gateway v2, Hono.
- **Configuration**: `claude-sonnet-4-5` via `@anthropic-ai/sdk`, `tool_choice: { type: 'tool', name: 'submit_annotated_words' }`, `temperature: 0`, system prompt cached.

## Impact Assessment

### Severity

- [ ] Critical - System unusable
- [x] High - Major functionality broken
- [ ] Medium - Feature impaired but workaround exists
- [ ] Low - Minor issue or cosmetic

Annotation is the entry point to the Read & Collect flow; without it the feature is unusable for affected language/level pairs.

### Affected Users

All users attempting to annotate passages in the affected language/level combinations. Reproduced for **Turkish A1**; unknown whether ES/DE or higher CEFR levels are also affected (likely intermittent — Claude tool-use payload shape depends on model output).

### Affected Features

- Read & Collect — annotation step (`POST /read/annotate`).
- Downstream: passage cannot be persisted with a word bank because the upstream call fails.

## Additional Context

### Error Messages

```
2026-05-10T22:36:27.716Z 0eade402-606f-40db-80b1-da200a3e9c04 ERROR
[POST /read/annotate] Claude annotation failed:
Error: Annotate result.flagged must be an array
    at Kw (/var/task/index.js:151:10033)
    at dy (/var/task/index.js:160:739)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async /var/task/index.js:183:8516
    at async o (/var/task/index.js:8:149670)
    at async or (/var/task/index.js:162:679)
    at async o (/var/task/index.js:8:149670)
    at async /var/task/index.js:8:174373
    at async o (/var/task/index.js:8:149670)
    at async /var/task/index.js:8:160216
```

The throw site is `packages/ai/src/annotate.ts:186` inside `parseAnnotateResult`:

```ts
if (!Array.isArray(raw.flagged)) {
  throw new Error("Annotate result.flagged must be an array");
}
```

It is caught by the route handler `infra/lambda/src/routes/read.ts:165` which maps any throw to `502 AI_UNAVAILABLE`.

### Screenshots/Media

N/A — failure is server-side; client only sees the 502.

### Related Issues

- PR #48 (`3ac5ff0`) raised the Lambda timeout from default to 29s + bumped memory to 512 MB. This bug is *not* a timeout — the throw happens after Claude responds — but it landed in the same area and may share triage context.

## Initial Analysis

### Suspected Root Cause

`parseAnnotateResult` only validates `Array.isArray(raw.flagged)`. The error fires when Claude's `tool_use.input` returns `flagged` as something other than an array — `null`, an object, a string, or the key omitted entirely. Because the passage is expected to contain above-A1 words, the model is being asked for a *non-empty* result, so this is not an empty-list coercion bug.

Most likely triggers, in rough order of probability:

- **Output truncation mid-tool-call** — `MAX_TOKENS = 2048` in `packages/ai/src/annotate.ts:225`. For an A1 user reading a passage of even moderate length, a large fraction of tokens may need flagging, and each entry carries seven fields (`matchedForm`, `lemma`, `pos`, `gloss`, `example`, `freq`, `cefr`). If the response hits `max_tokens` before the tool-use JSON is closed, the SDK still surfaces the partial `input` — but `flagged` may not yet have been emitted as a complete array, so `raw.flagged` is `undefined`/non-array at parse time. The route does not log `response.stop_reason`, which would confirm this.
- **Model regression / wrong model id** — `MODEL = "claude-sonnet-4-5"` in `packages/ai/src/annotate.ts:224`, but the project standard per `CLAUDE.md` is `claude-sonnet-4-6`. A regressed or retired model could produce a malformed tool payload. Worth confirming both that the id is current and that prod is actually running this build.
- **Hidden non-array shape** — the parser does not log `raw` (or `response.stop_reason`) before throwing, so the current trace tells us nothing about what `flagged` actually was. Lack of observability is itself a contributing cause and the first thing to fix during analysis.

### Affected Components

- `packages/ai/src/annotate.ts` — `parseAnnotateResult` (throw site) and `annotateText` (caller; does not log the raw tool input).
- `infra/lambda/src/routes/read.ts` — `POST /read/annotate` handler; maps throw → 502 and logs only the error message, not the offending payload.
- `packages/ai/src/annotate.test.ts` — likely missing coverage for the "model returned `flagged: null` / missing" branch.
- `apps/web/app/(dashboard)/read/_state/read-page-reducer.ts` — consumer; relevant only for verifying UX after the backend fix.
