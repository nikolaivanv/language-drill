# Admin On-Demand Generation Trigger (Design)

**Status:** approved · **Date:** 2026-06-17 · **Scope:** Tier 2 item #6 (second of two pool tools)

Derived from `docs/admin-panel.md` (Tier 2, item 6: "On-demand cell generation trigger").
The mutating/infra companion to the pool health drill-down (PR #330). A "Refill this cell"
control inside the drill-down panel enqueues an `trigger:'admin'` generation job onto the
existing SQS pipeline.

## Goal

Let an admin refill an underfilled cell from the UI: a `POST /admin/generate` endpoint
enqueues a single `GenerationJobMessage` with `trigger:'admin'` onto the existing generation
queue; the existing consumer generates and stores the exercises. No consumer changes — the
job model already reserves `'admin'` as a valid trigger.

## ⚠️ Deploy & cost caveat

Merging this:
- Runs a **CDK/IAM change**: the API Lambda gains `SendMessages` on the generation queue + a
  `GENERATION_QUEUE_URL` env var. Deploys on merge via the normal pipeline.
- Makes a button that **spends real LLM money per click**. Bounded by: count clamp (≤50), a
  fixed server-set `maxCostUsd` cap (2.0), a UI confirm, pending-disable, and a best-effort
  in-flight 409.

## Background (verified against current code)

- **Message contract** (`infra/lambda/src/generation/job-message.ts`):
  `GenerationJobMessage = { jobId: string; trigger: 'cli'|'scheduled'|'admin'; spec: {
  language; cefrLevel; exerciseType; grammarPointKey; topicDomain: string|null; count
  (1–200); batchSeed (≤100 chars); coverageTargets?: CoverageTarget[] }; maxCostUsd
  ((0,100)) }`. `parseGenerationJobMessage(raw)` validates and throws field-named errors.
  No `build*` helper — callers construct inline. `'admin'` is already in the trigger union.
- **Producers**: the scheduler (`infra/lambda/src/generation/scheduler.ts`) builds messages
  inline with `jobId = deterministicUuid(cellKey|batchSeed)`, `batchSeed =
  scheduled-<UTC-date>`, `maxCostUsd = SCHEDULER_PER_CELL_COST_CAP_USD (0.5)`, optional
  `coverageTargets`. The CLI (`packages/db/scripts/generate-exercises-queue.ts`,
  `postCellsToQueue`) uses `jobId = randomUUID()`, `trigger:'cli'`, no `coverageTargets`.
  Both send via `@aws-sdk/client-sqs` (`SendMessageBatchCommand`), `new SQSClient({ region:
  requireEnv('AWS_REGION') })`, `QueueUrl = requireEnv('GENERATION_QUEUE_URL')`.
- **Consumer** (`infra/lambda/src/generation/handler.ts`): parses the message, runs
  `checkAuditRowState(db, jobId)` (idempotency: `absent` → run, `in-progress` → defer,
  `completed` → skip), then `runOneCell(...)` which **inserts the `generation_jobs` row** at
  cell start (`status` opens `running`; `trigger` comes from the message). With a random
  `jobId`, every admin click is a fresh job (no cross-click dedup — handled instead by the
  in-flight guard + UI).
- **Package**: the Hono API (`infra/lambda/src/index.ts` + `routes/*`) and the scheduler are
  the SAME package `@language-drill/lambda`, which already depends on `@aws-sdk/client-sqs`.
- **Admin router** (`infra/lambda/src/routes/admin.ts`): `/admin/*` gated by `authMiddleware
  + adminMiddleware`; zod `safeParse` → `400 VALIDATION_ERROR`. Already imports `ALL_CURRICULA`,
  `enumerateCurriculumCells`, `buildCellKey`, `generationJobs`, `eq`, `inArray`. `requireEnv`
  is available from `@language-drill/db`.
- **CDK** (`infra/lib/stack.ts` + `infra/lib/constructs/lambda.ts`,
  `generation-queue.ts`): the generation queue (`generationQueue.queue`) is granted only to
  the scheduler + consumer. The API `LambdaConstruct` (exposes `.handler`) currently gets the
  **legacy** queue grant (`queue.queue.grantSendMessages(lambda.handler)`) but **not** the
  generation queue and **no** `GENERATION_QUEUE_URL`. `grantSendMessages` + `addEnvironment`
  is the pattern to mirror (scheduler construct sets `GENERATION_QUEUE_URL:
  props.queue.queueUrl`).
- **Cell resolution**: `enumerateCurriculumCells(ALL_CURRICULA)` → `Cell[]` (`{ language,
  cefrLevel, exerciseType, grammarPoint, cellKey }`); `GrammarPoint` has no `topicDomain`
  (admin sets `topicDomain: null`). `buildCellKey({ language, cefrLevel, exerciseType,
  grammarPointKey })` lowercases lang/level/type.
- **Drill-down panel** (`apps/web/app/(admin)/admin/generation/_components/pool-cell-detail.tsx`,
  PR #330): renders per-cell analytics + has the `PoolStatusItem` row (`approved`,
  `generationTarget`) — the natural home for the Refill control. It receives a `fetchFn`.
- **Test harness**: `infra/lambda/src/generation/scheduler.test.ts` mocks `@aws-sdk/client-sqs`
  (`SQSClient` + `SendMessageBatchCommand`) to capture sends; `admin.test.ts` uses the
  chain-mock `db` + `queryQueue`. A route test mocks SQS send + stages the in-flight query.

## Architecture

```
PoolCellDetail (Refill control)
   → POST /admin/generate { language, level, type, grammarPoint, count }
   → admin.ts: validate cell · in-flight guard · build message · parseGenerationJobMessage · SQS send
   → [existing generation queue] → handler.ts → runOneCell (creates generation_jobs row, generates)
```

Only the API Lambda gains a new capability (SQS send to the generation queue). The consumer
pipeline is untouched.

## API — `POST /admin/generate` (new, in `infra/lambda/src/routes/admin.ts`)

Body schema (zod): `language` (enum ES|DE|TR), `level` (enum A1|A2|B1|B2), `type` (non-empty
string), `grammarPoint` (non-empty string), `count` (int, `.min(1).max(50)`). Invalid →
`400 VALIDATION_ERROR`.

Handler steps:
1. `cellKey = buildCellKey({ language, cefrLevel: level, exerciseType: type, grammarPointKey:
   grammarPoint })`. Resolve `cell = enumerateCurriculumCells(ALL_CURRICULA).find(c => c.cellKey
   === cellKey)`. If absent → `400 { code: 'INVALID_CELL' }`.
2. **In-flight guard**: `db.select(...).from(generationJobs).where(and(eq(cellKey),
   inArray(status, ['queued','running']))).limit(1)`. If a row exists → `409 { code:
   'GENERATION_IN_PROGRESS' }`. (Best-effort: the consumer creates the row after dequeue, so
   two near-simultaneous clicks before the consumer starts could both pass — the UI
   pending-disable covers that window.)
3. Build the message:
   ```
   const jobId = randomUUID();
   const message: GenerationJobMessage = {
     jobId, trigger: 'admin',
     spec: { language, cefrLevel: level, exerciseType: type, grammarPointKey: grammarPoint,
             topicDomain: null, count, batchSeed: `admin-${jobId}` },
     maxCostUsd: ADMIN_PER_CELL_COST_CAP_USD,   // fixed 2.0, server-set; client cannot set it
   };
   ```
4. `parseGenerationJobMessage(message)` — validate against the contract before sending (so a
   malformed message is a 500 here, never an enqueued poison job). On throw → `500`.
5. `sqs.send(new SendMessageCommand({ QueueUrl: requireEnv('GENERATION_QUEUE_URL'),
   MessageBody: JSON.stringify(message) }))` (module-scope `SQSClient`, mirroring the
   scheduler's singleton).
6. Return `{ jobId, status: 'queued' }`.

`ADMIN_PER_CELL_COST_CAP_USD = 2.0` is a module constant (tunable). `randomUUID` from
`node:crypto` (already imported in admin.ts).

## CDK (`infra/lib/stack.ts`)

After both the API `lambda` and `generationQueue` are constructed, add:
```ts
generationQueue.queue.grantSendMessages(lambda.handler);
lambda.handler.addEnvironment('GENERATION_QUEUE_URL', generationQueue.queue.queueUrl);
```
`addEnvironment` avoids reordering construct creation (the queue is created after the API
lambda). Verify/adjust any infra stack test (`infra/**/*.test.ts` — snapshot or assertions)
affected by the new grant/env.

## Web — Refill control in `PoolCellDetail`

Add a "Refill" section to the panel:
- A number input defaulting to `Math.min(50, Math.max(1, item.generationTarget -
  item.approved))` (clamped 1–50), and a **Refill** button.
- On click: `window.confirm(\`Generate ~${count} exercises for this cell?\`)`; if confirmed,
  call `useGenerateCell` (disabled while `isPending`).
- On success: inline "Queued (job <first 8 chars of jobId>)". On `409`: "A job for this cell
  is already in progress." On other error: a generic failure message. Copy says **queued**
  (data won't reflect new exercises until the job runs and the page is refetched).
- api-client: `schemas/generate.ts` (`GenerateCellRequest`, `GenerateCellResponse = { jobId,
  status }`); `hooks/useGenerateCell.ts` — mutation POSTing the body; the `mutationFn` checks
  `res.status === 409` → throw a tagged error (`Error` with a recognizable message/code) so
  the card can show the in-progress message, parses `{jobId, status}` on ok, throws generic
  otherwise. Barrel-exported.

## Testing

- **Lambda** (`infra/lambda/src/routes/admin.test.ts`; mock `@aws-sdk/client-sqs` like
  `scheduler.test.ts`, plus the chain-mock `db`):
  - happy path: valid cell, no in-flight row → SQS `send` called once with a body that
    `parseGenerationJobMessage` accepts, `trigger:'admin'`, `count` echoed, `maxCostUsd`
    = 2.0, `batchSeed` starts `admin-`; response `{ jobId, status:'queued' }`.
  - `count` 0 or 51 → 400.
  - bogus `grammarPoint` (no enumerated cell) → 400 `INVALID_CELL`; assert SQS NOT called.
  - in-flight row staged → 409 `GENERATION_IN_PROGRESS`; assert SQS NOT called.
- **CDK**: run the infra package tests; update the stack snapshot/assertion for the new grant
  + env if present.
- **api-client**: `useGenerateCell` posts `/admin/generate` with the body and returns
  `{jobId,status}`; a 409 response surfaces a tagged error.
- **web**: `PoolCellDetail` refill control — count input defaults to the gap; confirm gates
  the call; pending disables the button; success shows the queued message; a 409 shows the
  in-progress message. (Mock `window.confirm` + the `useGenerateCell` hook.)
- Gate before push: `pnpm lint`, `pnpm typecheck`, `pnpm turbo run test --concurrency=1`.

## Out of scope (later / separate)

- Live job progress / streaming status (no job-log surface yet — Tier 1 #5).
- `admin_audit_log` (Tier 2) — this mutating action will append once it exists.
- Per-day admin-generation cap (chose in-flight 409 + caps instead).
- Coverage-guided admin generation (`coverageTargets` omitted; manual top-up isn't
  coverage-controlled).
- Batch/multi-cell triggering — one cell per click.

## Risks / notes

- **CDK grant is the real risk.** It's the minimal necessary capability (send to one queue).
  Verify the env+grant land on the API Lambda (not the consumer/scheduler) in the synth.
- **In-flight guard is best-effort**, not race-proof (row created post-dequeue). Acceptable;
  the UI pending-disable covers the sub-second window and the cost cap bounds the worst case.
- **Validate-before-send** (`parseGenerationJobMessage`) keeps the producer honest against the
  same contract the consumer enforces — a drift in the message shape fails loudly here rather
  than as a poisoned SQS message.
- **`maxCostUsd` is never client-controlled** — it's a server constant, so the cost ceiling
  per click can't be raised from the browser.
- **No live feedback loop**: after enqueue, the drill-down's numbers update only on the next
  page load once the job has run. The success copy must not imply the exercises already exist.
