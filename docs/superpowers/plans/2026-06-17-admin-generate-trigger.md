# Admin On-Demand Generation Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Refill this cell" control to the pool drill-down that POSTs to a new `/admin/generate`, which enqueues a `trigger:'admin'` generation job onto the existing SQS pipeline (bounded by a count clamp, a fixed server `maxCostUsd`, a UI confirm, and a best-effort in-flight 409).

**Architecture:** The API Lambda (same package as the scheduler, already depends on `@aws-sdk/client-sqs`) gains a new `POST /admin/generate` route + a CDK grant to send to the generation queue. The existing consumer (`handler.ts` → `runOneCell`) processes the job unchanged. A `useGenerateCell` hook drives a Refill control inside the existing `PoolCellDetail` panel.

**Tech Stack:** Hono + Drizzle + `@aws-sdk/client-sqs` (Lambda), AWS CDK, Vitest, Zod, TanStack Query, Next.js client components.

---

## Context the implementer needs

Work from the worktree `/Users/seal/dev/language-drill/.claude/worktrees/feat-admin-generate-trigger` (branch `feat-admin-generate-trigger`). `cd` into it in every Bash call. Paths contain a `(admin)` route-group segment — quote them.

**Workspace dist:** if a test errors resolving `@language-drill/*`, run `pnpm build` at repo root once, then re-run. (Per-package `node_modules` may also need `pnpm install` at the worktree root if a package can't find deps.)

**Single-file test commands:**
- Lambda: `pnpm --filter @language-drill/lambda test <path-relative-to-infra/lambda>`
- infra (CDK): `pnpm --filter @language-drill/infra test <path-or-empty>`
- api-client: `pnpm --filter @language-drill/api-client test <path>`
- web: `pnpm --filter @language-drill/web test <path>`

**Key existing code:**
- `infra/lambda/src/routes/admin.ts`: Hono admin router; `/admin/*` gated by `authMiddleware + adminMiddleware`. Imports `{ randomInt } from 'node:crypto'`, `{ and, asc, count, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'`, and from `@language-drill/db`: `ALL_CURRICULA, buildCellKey, enumerateCurriculumCells, generationJobs, ...`. zod `safeParse` → `400 { error, code:'VALIDATION_ERROR', details }`.
- `infra/lambda/src/generation/job-message.ts` exports `type GenerationJobMessage` and `parseGenerationJobMessage(raw): GenerationJobMessage` (throws on invalid). Message shape: `{ jobId, trigger, spec: { language, cefrLevel, exerciseType, grammarPointKey, topicDomain, count(1–200), batchSeed(≤100), coverageTargets? }, maxCostUsd((0,100)) }`. `'admin'` is a valid trigger.
- `requireEnv` is imported by the scheduler from `@language-drill/db` (`infra/lambda/src/generation/scheduler.ts` line ~32). Mirror that import source.
- SQS usage (scheduler): `import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';`, `new SQSClient({ region: requireEnv('AWS_REGION') })`, `QueueUrl = requireEnv('GENERATION_QUEUE_URL')`. We use `SendMessageCommand` (single message).
- `enumerateCurriculumCells(ALL_CURRICULA)` → `Cell[]` (`{ language, cefrLevel, exerciseType, grammarPoint, cellKey }`); `cell.grammarPoint.key` is the grammar point key; no `topicDomain` on grammar points. `buildCellKey({ language, cefrLevel, exerciseType, grammarPointKey })` lowercases lang/level/type.
- `generation_jobs` columns: `cellKey`, `status` ('queued'|'running'|'succeeded'|'failed'), `id`.
- `infra/lambda/src/routes/admin.test.ts`: chain-mock `db` + `queryQueue`; `@language-drill/db` mocked with `...actual` + table sentinels (so `enumerateCurriculumCells`/`buildCellKey`/`requireEnv` are REAL). Uses a request helper. Real curriculum cell for fixtures: `es-b1-present-subjunctive` (ES, B1) enumerates with `cloze`.
- `infra/lambda/src/generation/scheduler.test.ts`: shows the `@aws-sdk/client-sqs` mock pattern.
- CDK `infra/lib/stack.ts`: the API `lambda = new LambdaConstruct(this, "Lambda", {...})` (line ~67, exposes `.handler`); `generationQueue = new GenerationQueueConstruct(...)` (line ~96). The API lambda currently gets `queue.queue.grantSendMessages(lambda.handler)` (legacy queue, line 91) but NOT the generation queue. Scheduler construct sets `GENERATION_QUEUE_URL: props.queue.queueUrl` + `props.queue.grantSendMessages(this.handler)`.
- CDK tests: `infra/test/stack.snapshot.test.ts` (snapshot — WILL change), `infra/test/stack.dev.test.ts`, `infra/lib/constructs/lambda.test.ts`.
- `createAuthenticatedFetch` (`packages/api-client/src/fetchClient.ts`) **throws on non-2xx**, attaching `error.status` + `error.body`. So a 409 surfaces as a thrown error with `.status === 409` — the hook stays standard; the card inspects `err.status`.
- `PoolCellDetail` (`apps/web/app/(admin)/admin/generation/_components/pool-cell-detail.tsx`): props `{ item: PoolStatusItem; fetchFn: AuthenticatedFetch }`; already uses `usePoolCell`. Its test mocks `@language-drill/api-client`'s `usePoolCell`. `PoolStatusItem` has `language, level, type, grammarPointKey, approved, generationTarget`.

---

## File structure

**Lambda (modify):** `infra/lambda/src/routes/admin.ts` (+`POST /admin/generate`, lazy SQS client, cost constant), `infra/lambda/src/routes/admin.test.ts` (+SQS mock, +tests).
**CDK (modify):** `infra/lib/stack.ts` (grant + env), `infra/test/stack.snapshot.test.ts` (regenerate snapshot).
**api-client (create/modify):** `schemas/generate.ts` (new), `hooks/useGenerateCell.ts` (new), `hooks/useGenerateCell.test.ts` (new), `index.ts` (barrel).
**web (modify):** `app/(admin)/admin/generation/_components/pool-cell-detail.tsx` + its test.

---

## Task 1: Lambda — `POST /admin/generate`

**Files:** Modify `infra/lambda/src/routes/admin.ts`, `infra/lambda/src/routes/admin.test.ts`

- [ ] **Step 1: Add the SQS mock + write failing tests**

In `infra/lambda/src/routes/admin.test.ts`, add at the TOP (with the other `vi.mock` calls) an SQS mock (mirrors `scheduler.test.ts`):
```ts
const sqsSend = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn(() => ({ send: sqsSend })),
  SendMessageCommand: vi.fn((input: unknown) => ({ input })),
}));
```
Ensure the file's `beforeEach` resets it: add `sqsSend.mockClear();` (alongside the existing `queryQueue` reset). At the top of the new describe block (or a `beforeAll`), set the env the route reads:
```ts
process.env.AWS_REGION = 'us-east-1';
process.env.GENERATION_QUEUE_URL = 'https://sqs.test/queue';
```
Then append the tests (adapt `request(...)` to the file's helper):
```ts
describe('POST /admin/generate', () => {
  it('enqueues an admin generation job for a valid cell', async () => {
    queryQueue.push([]); // in-flight check: no queued/running job
    const res = await request('/admin/generate', {
      method: 'POST',
      body: JSON.stringify({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 18 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('queued');
    expect(typeof body.jobId).toBe('string');
    expect(sqsSend).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(sqsSend.mock.calls[0][0].input.MessageBody);
    expect(sent.trigger).toBe('admin');
    expect(sent.spec.count).toBe(18);
    expect(sent.spec.exerciseType).toBe('cloze');
    expect(sent.spec.grammarPointKey).toBe('es-b1-present-subjunctive');
    expect(sent.spec.batchSeed).toMatch(/^admin-/);
    expect(sent.maxCostUsd).toBe(2.0);
    expect(sent.jobId).toBe(body.jobId);
  });

  it('rejects count over 50 with 400', async () => {
    const res = await request('/admin/generate', {
      method: 'POST',
      body: JSON.stringify({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 51 }),
    });
    expect(res.status).toBe(400);
    expect(sqsSend).not.toHaveBeenCalled();
  });

  it('rejects an unknown cell with 400 INVALID_CELL', async () => {
    const res = await request('/admin/generate', {
      method: 'POST',
      body: JSON.stringify({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'does-not-exist', count: 5 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_CELL');
    expect(sqsSend).not.toHaveBeenCalled();
  });

  it('returns 409 when a job for the cell is already queued/running', async () => {
    queryQueue.push([{ id: 'existing-job' }]); // in-flight check finds a row
    const res = await request('/admin/generate', {
      method: 'POST',
      body: JSON.stringify({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 5 }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('GENERATION_IN_PROGRESS');
    expect(sqsSend).not.toHaveBeenCalled();
  });
});
```
> If `cloze` doesn't enumerate for `es-b1-present-subjunctive`, use the type Task-1-of-the-pool-drilldown used (check `enumerateCurriculumCells` output); floors/cell tests in `admin.test.ts` already reference this grammar point — match their type.

- [ ] **Step 2: Run tests, expect FAIL (404)** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`

- [ ] **Step 3: Implement**

In `infra/lambda/src/routes/admin.ts`:
- Add `randomUUID` to the `node:crypto` import: `import { randomInt, randomUUID } from 'node:crypto';`
- Add `import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';`
- Add `requireEnv` to the `@language-drill/db` import (mirror the scheduler's import source if different).
- Add `import { parseGenerationJobMessage, type GenerationJobMessage } from '../generation/job-message';`

Then add the constant, lazy client, schema, and route:
```ts
const ADMIN_PER_CELL_COST_CAP_USD = 2.0;

// Lazy singleton so importing this module (e.g. in tests) doesn't require AWS env at import time.
let sqsClient: SQSClient | null = null;
function getSqsClient(): SQSClient {
  if (!sqsClient) sqsClient = new SQSClient({ region: requireEnv('AWS_REGION') });
  return sqsClient;
}

const GenerateBodySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']),
  level: z.enum(['A1', 'A2', 'B1', 'B2']),
  type: z.string().min(1),
  grammarPoint: z.string().min(1),
  count: z.coerce.number().int().min(1).max(50),
});

admin.post('/admin/generate', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = GenerateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { language, level, type, grammarPoint, count } = parsed.data;

  const cellKey = buildCellKey({ language, cefrLevel: level, exerciseType: type, grammarPointKey: grammarPoint });
  const cell = enumerateCurriculumCells(ALL_CURRICULA).find((cc) => cc.cellKey === cellKey);
  if (!cell) {
    return c.json({ error: 'Unknown cell', code: 'INVALID_CELL' }, 400);
  }

  const inFlight = await db
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(and(eq(generationJobs.cellKey, cellKey), inArray(generationJobs.status, ['queued', 'running'])))
    .limit(1);
  if (inFlight.length > 0) {
    return c.json({ error: 'A generation job for this cell is already in progress', code: 'GENERATION_IN_PROGRESS' }, 409);
  }

  const jobId = randomUUID();
  const message: GenerationJobMessage = {
    jobId,
    trigger: 'admin',
    spec: {
      language: cell.language,
      cefrLevel: cell.cefrLevel,
      exerciseType: cell.exerciseType,
      grammarPointKey: cell.grammarPoint.key,
      topicDomain: null,
      count,
      batchSeed: `admin-${jobId}`,
    },
    maxCostUsd: ADMIN_PER_CELL_COST_CAP_USD,
  };
  // Validate against the same contract the consumer enforces — never enqueue a poison message.
  parseGenerationJobMessage(message);

  await getSqsClient().send(
    new SendMessageCommand({ QueueUrl: requireEnv('GENERATION_QUEUE_URL'), MessageBody: JSON.stringify(message) }),
  );

  return c.json({ jobId, status: 'queued' });
});
```

- [ ] **Step 4: Run tests, expect PASS** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`
- [ ] **Step 5: Typecheck** — `pnpm --filter @language-drill/lambda typecheck` → clean
- [ ] **Step 6: Commit**
```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): POST /admin/generate enqueues an admin generation job"
```

---

## Task 2: CDK — grant API Lambda send access to the generation queue

**Files:** Modify `infra/lib/stack.ts`, regenerate `infra/test/stack.snapshot.test.ts` snapshot.

- [ ] **Step 1: Add the grant + env**

In `infra/lib/stack.ts`, AFTER the `generationQueue = new GenerationQueueConstruct(...)` block (it must exist before these lines; the API `lambda` is already constructed earlier), add:
```ts
// On-demand admin generation: the API Lambda enqueues trigger:'admin' jobs onto the
// generation queue (POST /admin/generate). addEnvironment avoids reordering construct creation.
generationQueue.queue.grantSendMessages(lambda.handler);
lambda.handler.addEnvironment('GENERATION_QUEUE_URL', generationQueue.queue.queueUrl);
```

- [ ] **Step 2: Run infra tests; regenerate the snapshot**

Run: `pnpm --filter @language-drill/infra test`
Expected: `stack.snapshot.test.ts` FAILS (the synth changed: a new SQS `sendMessage` policy statement on the API Lambda's role + a new env var). Other infra tests should still pass — if `lambda.test.ts` or `stack.dev.test.ts` fail for an unrelated reason, stop and report.

Regenerate the snapshot:
Run: `pnpm --filter @language-drill/infra test -u`  (vitest snapshot update; if the package's test script doesn't forward `-u`, use `pnpm --filter @language-drill/infra exec vitest run -u`)

- [ ] **Step 3: Verify the snapshot diff is only the intended change**

Run: `git diff -- infra/test/__snapshots__ infra/test/stack.snapshot.test.ts`
Expected: the diff adds (a) an SQS `sqs:SendMessage*` (and related) permission targeting the generation queue on the API Lambda role, and (b) a `GENERATION_QUEUE_URL` environment entry on the API Lambda. No unrelated resources changed. If the diff touches the scheduler/consumer or other lambdas, something is wrong — stop and report.

- [ ] **Step 4: Re-run infra tests, expect PASS** — `pnpm --filter @language-drill/infra test`

- [ ] **Step 5: Commit**
```bash
git add infra/lib/stack.ts infra/test
git commit -m "feat(infra): grant API Lambda send access + GENERATION_QUEUE_URL for admin generation"
```

---

## Task 3: api-client — `useGenerateCell`

**Files:** Create `packages/api-client/src/schemas/generate.ts`, `hooks/useGenerateCell.ts`, `hooks/useGenerateCell.test.ts`; modify `index.ts`.

- [ ] **Step 1: Create the schema**

`packages/api-client/src/schemas/generate.ts`:
```ts
import { z } from 'zod';

export type GenerateCellRequest = {
  language: string;
  level: string;
  type: string;
  grammarPoint: string;
  count: number;
};

export const GenerateCellResponseSchema = z.object({
  jobId: z.string(),
  status: z.literal('queued'),
});
export type GenerateCellResponse = z.infer<typeof GenerateCellResponseSchema>;
```

- [ ] **Step 2: Write failing hook test**

`packages/api-client/src/hooks/useGenerateCell.test.ts` (mirror the wrapper idiom in `useContentBrowser.test.ts`):
```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useGenerateCell } from './useGenerateCell';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('useGenerateCell', () => {
  it('POSTs the cell + count and returns the queued job', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ jobId: 'job-1', status: 'queued' }));
    const { result } = renderHook(() => useGenerateCell({ fetchFn }), { wrapper: wrapper() });
    const out = await result.current.mutateAsync({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 18 });
    expect(out).toEqual({ jobId: 'job-1', status: 'queued' });
    expect(fetchFn).toHaveBeenCalledWith('/admin/generate', {
      method: 'POST',
      body: JSON.stringify({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 18 }),
    });
  });

  it('propagates a 409 error from fetchFn', async () => {
    const err = Object.assign(new Error('in progress'), { status: 409 });
    const fetchFn = vi.fn().mockRejectedValue(err);
    const { result } = renderHook(() => useGenerateCell({ fetchFn }), { wrapper: wrapper() });
    await expect(
      result.current.mutateAsync({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 5 }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
```

- [ ] **Step 3: Run, expect FAIL** — `pnpm --filter @language-drill/api-client test src/hooks/useGenerateCell.test.ts`

- [ ] **Step 4: Create the hook**

`packages/api-client/src/hooks/useGenerateCell.ts`:
```ts
import { useMutation } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { GenerateCellResponseSchema, type GenerateCellRequest, type GenerateCellResponse } from '../schemas/generate';

export function useGenerateCell({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  return useMutation<GenerateCellResponse, Error, GenerateCellRequest>({
    mutationFn: async (body) => {
      const res = await fetchFn('/admin/generate', { method: 'POST', body: JSON.stringify(body) });
      const json: unknown = await res.json();
      return GenerateCellResponseSchema.parse(json);
    },
  });
}
```
(`fetchFn` throws on non-2xx — including 409 — so the error, with `.status`, propagates to the caller's `catch`; no per-status branching needed here.)

- [ ] **Step 5: Barrel exports** — add to `packages/api-client/src/index.ts`:
```ts
export { GenerateCellResponseSchema, type GenerateCellRequest, type GenerateCellResponse } from './schemas/generate';
export { useGenerateCell } from './hooks/useGenerateCell';
```

- [ ] **Step 6: Test + typecheck + build**
- `pnpm --filter @language-drill/api-client test src/hooks/useGenerateCell.test.ts` → 2 pass
- `pnpm --filter @language-drill/api-client typecheck` → clean
- `pnpm --filter @language-drill/api-client build` → success

- [ ] **Step 7: Commit**
```bash
git add packages/api-client/src/schemas/generate.ts packages/api-client/src/hooks/useGenerateCell.ts packages/api-client/src/hooks/useGenerateCell.test.ts packages/api-client/src/index.ts
git commit -m "feat(admin): api-client useGenerateCell mutation hook"
```

---

## Task 4: web — Refill control in `PoolCellDetail`

**Files:** Modify `apps/web/app/(admin)/admin/generation/_components/pool-cell-detail.tsx` + `__tests__/pool-cell-detail.test.tsx`.

- [ ] **Step 1: Update the test mock + add refill tests (RED)**

In `apps/web/app/(admin)/admin/generation/_components/__tests__/pool-cell-detail.test.tsx`:
- The existing file mocks `@language-drill/api-client`'s `usePoolCell`. Extend that mock to ALSO provide `useGenerateCell`. Replace the existing `vi.mock('@language-drill/api-client', …)` block with:
```tsx
const mockUsePoolCell = vi.fn();
const mockGenerateMutateAsync = vi.fn();
const mockUseGenerateCell = vi.fn(() => ({ mutateAsync: mockGenerateMutateAsync, isPending: false }));
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, usePoolCell: (args: unknown) => mockUsePoolCell(args), useGenerateCell: (args: unknown) => mockUseGenerateCell(args) };
});
```
- Keep the existing 5 tests. In their shared `beforeEach` (add one if absent), reset: `mockGenerateMutateAsync.mockReset(); mockUseGenerateCell.mockReturnValue({ mutateAsync: mockGenerateMutateAsync, isPending: false });` and ensure `mockUsePoolCell` returns a default success (`{ isLoading:false, isError:false, data:{ floors:{}, rejectionReasonCounts:{} } }`) for the new tests.
- Add a refill describe block:
```tsx
describe('PoolCellDetail — refill', () => {
  beforeEach(() => {
    mockUsePoolCell.mockReturnValue({ isLoading: false, isError: false, data: { floors: {}, rejectionReasonCounts: {} } });
    mockGenerateMutateAsync.mockReset();
    mockUseGenerateCell.mockReturnValue({ mutateAsync: mockGenerateMutateAsync, isPending: false });
  });

  it('defaults the count to the gap (generationTarget - approved)', () => {
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    // item: approved 12, generationTarget 30 → default 18
    expect((screen.getByLabelText(/refill count/i) as HTMLInputElement).value).toBe('18');
  });

  it('does not generate when the confirm is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /refill/i }));
    expect(mockGenerateMutateAsync).not.toHaveBeenCalled();
  });

  it('queues a job and shows the queued message on success', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockGenerateMutateAsync.mockResolvedValue({ jobId: 'abcdef12-3456', status: 'queued' });
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /refill/i }));
    expect(mockGenerateMutateAsync).toHaveBeenCalledWith({
      language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 18,
    });
    expect(await screen.findByText(/queued \(job abcdef12\)/i)).toBeInTheDocument();
  });

  it('shows the in-progress message on a 409', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockGenerateMutateAsync.mockRejectedValue(Object.assign(new Error('x'), { status: 409 }));
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /refill/i }));
    expect(await screen.findByText(/already in progress/i)).toBeInTheDocument();
  });
});
```
Ensure `fireEvent` and `beforeEach` are imported from `@testing-library/react` / `vitest` at the top (the file already imports `render, screen`; add `fireEvent`, and `vi`, `beforeEach` as needed).

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @language-drill/web test "app/(admin)/admin/generation/_components/__tests__/pool-cell-detail.test.tsx"`

- [ ] **Step 3: Implement — add the Refill section to `pool-cell-detail.tsx`**

Add imports + `useState` + `useGenerateCell`, and render the section. Concretely:
- Change the React import to include `useState`: `import { useState } from 'react';`
- Add `useGenerateCell` to the `@language-drill/api-client` import (which already imports `usePoolCell`, `type AuthenticatedFetch`, `type PoolStatusItem`).
- Inside the component, after the `detail` query but BEFORE the early `if (detail.isLoading)` returns, declare the refill state/hook (hooks must run unconditionally):
```tsx
const generate = useGenerateCell({ fetchFn });
const [refillCount, setRefillCount] = useState(() =>
  Math.min(50, Math.max(1, item.generationTarget - item.approved)),
);
const [genMessage, setGenMessage] = useState<string | null>(null);
```
- Add a handler (define inside the component):
```tsx
const onRefill = async () => {
  if (!window.confirm(`Generate ~${refillCount} exercises for this cell?`)) return;
  try {
    const res = await generate.mutateAsync({
      language: item.language, level: item.level, type: item.type,
      grammarPoint: item.grammarPointKey, count: refillCount,
    });
    setGenMessage(`Queued (job ${res.jobId.slice(0, 8)})`);
  } catch (err) {
    const status = (err as { status?: number }).status;
    setGenMessage(status === 409 ? 'A job for this cell is already in progress.' : 'Failed to queue generation.');
  }
};
```
- Render a Refill `<section>` in the returned JSX (e.g. right before the "View approved exercises" link), keeping it OUTSIDE the loading/error early returns (so it only renders on the success branch alongside the rest — acceptable, since the panel only shows analytics on success; the refill lives with them):
```tsx
<section className="flex flex-col gap-1">
  <h4 className="text-ink-soft text-[12px] mb-1">Refill</h4>
  <div className="flex items-center gap-2">
    <label className="text-[12px] text-ink-soft" htmlFor="refill-count">Refill count</label>
    <input
      id="refill-count"
      aria-label="Refill count"
      type="number"
      min={1}
      max={50}
      value={refillCount}
      onChange={(e) => setRefillCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
      className="w-16 text-[13px]"
    />
    <button
      type="button"
      onClick={onRefill}
      disabled={generate.isPending}
      className="text-[13px] text-ink underline disabled:opacity-40"
    >
      Refill
    </button>
  </div>
  {genMessage ? <p className="text-[12px] text-ink-soft">{genMessage}</p> : null}
</section>
```
NOTE: the hooks (`useGenerateCell`, `useState`) MUST be declared before the `if (detail.isLoading) return …` / `if (detail.isError) return …` early returns (React rules-of-hooks). The early returns stay; only move the new hook declarations above them. The Refill `<section>` goes in the final (success) JSX return.

- [ ] **Step 4: Run, expect PASS (9: 5 existing + 4 refill)** — `pnpm --filter @language-drill/web test "app/(admin)/admin/generation/_components/__tests__/pool-cell-detail.test.tsx"`
- [ ] **Step 5: Typecheck web** — `pnpm --filter @language-drill/web typecheck` → clean (the known pre-existing `e2e/helpers/auth.ts` worktree-dist error may appear if `db` dist is missing; run `pnpm build` at repo root if so, then re-run — only that error is acceptable and is resolved by the full turbo typecheck in Task 5).
- [ ] **Step 6: Commit**
```bash
git add "apps/web/app/(admin)/admin/generation/_components/pool-cell-detail.tsx" "apps/web/app/(admin)/admin/generation/_components/__tests__/pool-cell-detail.test.tsx"
git commit -m "feat(admin): Refill this cell control in the pool drill-down"
```

---

## Task 5: Full verification

**Files:** none.

- [ ] **Step 1: Lint** — `pnpm lint` → no errors
- [ ] **Step 2: Repo typecheck** — `pnpm typecheck` → no errors (all packages)
- [ ] **Step 3: Full serial test suite** — `pnpm turbo run test --concurrency=1` → all packages pass (incl. lambda `/admin/generate`, infra snapshot, api-client `useGenerateCell`, web refill tests)
- [ ] **Step 4: Commit (only if a lint/format autofix changed files; else skip)**
```bash
git add -A && git commit -m "chore(admin): verification fixes" || echo "nothing to commit"
```

---

## Self-review notes

- **Spec coverage:** `POST /admin/generate` with cell validation, in-flight 409, count clamp, fixed `maxCostUsd`, validate-before-send, SQS enqueue (Task 1); CDK grant + `GENERATION_QUEUE_URL` (Task 2); `useGenerateCell` hook (Task 3); Refill control with top-up default, confirm, pending-disable, queued/409 messages (Task 4); tests throughout + Task 5.
- **Type consistency:** message built from `cell.*` (guarantees `parseGenerationJobMessage` passes); `GenerateCellRequest` shape (`language/level/type/grammarPoint/count`) identical across the hook (Task 3), its test, and the card's `mutateAsync` call (Task 4); `GenerateCellResponse` `{jobId, status:'queued'}` matches the Lambda return (Task 1) and the schema (Task 3).
- **Known pitfalls flagged inline:** lazy SQS client (avoids import-time `requireEnv`); SQS mock + env in the lambda test; `createAuthenticatedFetch` throws on non-2xx so 409 handling is in the card via `err.status` (not the hook); hooks-before-early-returns in `PoolCellDetail`; snapshot regeneration + diff-verification for the CDK change; workspace `pnpm build` for cross-package imports / the known e2e/db typecheck artifact.
- **No placeholders:** every code step is complete; every run step has a command + expected result.
```
