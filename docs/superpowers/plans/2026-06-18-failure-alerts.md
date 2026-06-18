# Failure Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CloudWatch alarms (→ the existing SNS email topic) for two currently-silent backend failures: sustained AI-call failures on the API Lambda, and wholesale nightly exercise-generation failures.

**Architecture:** Two independent additions, each mirroring an existing in-repo pattern. (A) A metric-filter alarm on the API Lambda log group for caught AI-call failures, modeled on `prompt-fallback-alarm.ts`. (B) An application-level `CellFailed` EMF metric + daily alarm for exercise generation, mirroring the theory pipeline (`theory-generation/metrics.ts` + `TheoryGenerationCellFailuresAlarm`).

**Tech Stack:** AWS CDK (TypeScript), CloudWatch (MetricFilter, EMF, Alarm), SNS, Vitest + `aws-cdk-lib/assertions`.

## Global Constraints

- **TDD:** failing test → confirm it fails for the expected reason → minimal implementation → confirm pass → commit.
- **Packages:** the EMF emitter + handler live in `@language-drill/lambda` (`infra/lambda`); the CDK alarm constructs live in `@language-drill/infra` (`infra/lib`). Typecheck/test the right one.
- **env namespacing — critical:** the alarm's metric `env` dimension MUST equal what the runtime emits. Everywhere in this stack `env` is derived as `props.secretsPrefix === 'language-drill' ? 'prod' : 'dev'`, and the generation handler emits `process.env.LANGFUSE_ENV ?? 'dev'` (the construct sets `LANGFUSE_ENV` from that same expression). A mismatch makes the alarm watch a stream nothing writes to.
- **Alarm conventions (match existing):** `statistic = SUM`, `treatMissingData = NOT_BREACHING`, `evaluationPeriods = 1`, conditional `if (props.alarmTopic) alarm.addAlarmAction(new cwactions.SnsAction(props.alarmTopic))`.
- **Pre-push:** `pnpm lint`, `pnpm typecheck`, `pnpm turbo run test --concurrency=1` all green.

---

### Task 1: Generation `CellFailed` EMF emitter

**Files:**
- Create: `infra/lambda/src/generation/metrics.ts`
- Test: `infra/lambda/src/generation/metrics.test.ts`

**Interfaces:**
- Produces: `emitCellOutcomeMetric(status: CellResult['status'], env: string): void` — emits one EMF `CellFailed` data point to `console.log`. `status` is `'succeeded' | 'failed' | 'skipped-cost-cap'` (the `CellResult['status']` union from `@language-drill/db`). `'failed'` → `CellFailed: 1`; `'succeeded'` → `CellFailed: 0`; `'skipped-cost-cap'` → no emit. Namespace `LanguageDrill/Generation`, single dimension `env`.

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/generation/metrics.test.ts`:

```ts
/**
 * Tests for the generation `CellFailed` EMF emitter — mirrors the theory
 * pipeline's metrics test. Asserts the emit/no-emit decision per outcome and
 * the EMF envelope shape CloudWatch Logs auto-extraction depends on.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import { emitCellOutcomeMetric } from './metrics';

let consoleLogSpy: MockInstance<typeof console.log>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
});

function soleEmittedRecord(): Record<string, unknown> {
  expect(consoleLogSpy).toHaveBeenCalledTimes(1);
  const arg = consoleLogSpy.mock.calls[0]?.[0];
  expect(typeof arg).toBe('string');
  return JSON.parse(arg as string) as Record<string, unknown>;
}

describe('emitCellOutcomeMetric (generation)', () => {
  it("emits CellFailed=1 on a 'failed' outcome", () => {
    emitCellOutcomeMetric('failed', 'prod');
    expect(soleEmittedRecord()['CellFailed']).toBe(1);
  });

  it("emits CellFailed=0 on a 'succeeded' outcome", () => {
    emitCellOutcomeMetric('succeeded', 'prod');
    expect(soleEmittedRecord()['CellFailed']).toBe(0);
  });

  it("does NOT emit on 'skipped-cost-cap'", () => {
    emitCellOutcomeMetric('skipped-cost-cap', 'prod');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('emits the EMF envelope with the LanguageDrill/Generation namespace and env dimension', () => {
    emitCellOutcomeMetric('failed', 'dev');
    const record = soleEmittedRecord();
    expect(record['env']).toBe('dev');
    expect(record['CellFailed']).toBe(1);
    const aws = record['_aws'] as Record<string, unknown>;
    expect(typeof aws['Timestamp']).toBe('number');
    const directives = aws['CloudWatchMetrics'] as Array<Record<string, unknown>>;
    expect(directives).toHaveLength(1);
    const directive = directives[0]!;
    expect(directive['Namespace']).toBe('LanguageDrill/Generation');
    expect(directive['Dimensions']).toEqual([['env']]);
    expect(directive['Metrics']).toEqual([{ Name: 'CellFailed' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- generation/metrics.test.ts`
Expected: FAIL — `./metrics` module / `emitCellOutcomeMetric` does not exist.

- [ ] **Step 3: Implement**

Create `infra/lambda/src/generation/metrics.ts`:

```ts
/**
 * CloudWatch EMF emitter for the exercise generation Lambda. Mirrors
 * `theory-generation/metrics.ts`. Emits an application-level `CellFailed`
 * metric over `console.log` stdout — CloudWatch Logs auto-extracts EMF records
 * into metrics, so there is no blocking PutMetricData round-trip.
 *
 * This is the application-failure signal, distinct from the Lambda runtime
 * `Errors` metric: a cell that `runOneCell` resolves as `status='failed'` is a
 * terminal *outcome*, not an unhandled throw (those go to the DLQ instead). The
 * `GenerationCellFailuresAlarm` (CDK) watches the emitted metric.
 */
import type { CellResult } from '@language-drill/db';

const NAMESPACE = 'LanguageDrill/Generation';
const METRIC_NAME = 'CellFailed';

/**
 * Emit a single `CellFailed` EMF data point for a terminal cell outcome.
 * - 'failed' → 1 (the alarm sums these over a day).
 * - 'succeeded' → 0 — emitted so the alarm distinguishes "all passing" from
 *   "no runs at all".
 * - 'skipped-cost-cap' → no emit: a deliberate budget stop is not a failure.
 *
 * The `env` dimension must match the alarm's `dimensionsMap.env`
 * ('prod' / 'dev'), or the alarm watches a stream nothing writes to.
 */
export function emitCellOutcomeMetric(
  status: CellResult['status'],
  env: string,
): void {
  if (status === 'skipped-cost-cap') return;
  const value = status === 'failed' ? 1 : 0;
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: NAMESPACE,
            Dimensions: [['env']],
            Metrics: [{ Name: METRIC_NAME }],
          },
        ],
      },
      env,
      [METRIC_NAME]: value,
    }),
  );
}
```

(`CellResult` is already exported from `@language-drill/db` — the generation handler imports `type CellResult` from it. If `CellResult['status']` does not resolve to the three-member union, inline the union `'succeeded' | 'failed' | 'skipped-cost-cap'` instead and note it in the report.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- generation/metrics.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/generation/metrics.ts infra/lambda/src/generation/metrics.test.ts
git commit -m "feat(lambda): CellFailed EMF metric for exercise generation"
```

---

### Task 2: Wire the emitter into the generation handler

**Files:**
- Modify: `infra/lambda/src/generation/handler.ts` (after the cell-run `finally`, before the `// Result dispatch` block — around line 326)
- Test: `infra/lambda/src/generation/handler.test.ts`

**Interfaces:**
- Consumes: `emitCellOutcomeMetric` from `./metrics` (Task 1).

- [ ] **Step 1: Write the failing test**

The handler test already drives `runOneCell` to terminal outcomes (e.g. the `'skipped-cost-cap'` test ~line 536, and `'succeeded'` cases ~line 199). Add a test that asserts the EMF line is emitted. Spy on `console.log` and reuse the file's existing arrange for a `'failed'` result (mirror the nearest `runOneCell`-returns-a-status test's setup — the SQS event builder + the `runOneCell` mock):

```ts
it('emits a CellFailed EMF metric for a terminal failed cell', async () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  // ...arrange exactly like the existing "terminal-failed"/"skipped-cost-cap"
  // test: mock runOneCell to resolve { status: 'failed', errorMessage: '...' },
  // build the single-record SQSEvent, then invoke the handler...
  await handler(event, context);

  const emitted = logSpy.mock.calls
    .map((c) => String(c[0]))
    .filter((s) => s.includes('"CellFailed"'));
  expect(emitted).toHaveLength(1);
  expect(emitted[0]).toContain('"CellFailed":1');
  logSpy.mockRestore();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- generation/handler.test.ts -t "CellFailed EMF"`
Expected: FAIL — no `"CellFailed"` line emitted (handler doesn't call the emitter yet).

- [ ] **Step 3: Implement**

In `infra/lambda/src/generation/handler.ts`, add the import alongside the existing imports:

```ts
import { emitCellOutcomeMetric } from './metrics';
```

Insert the emit immediately after the cell-run `finally { clearTimeout(timer); }` block and before the `// Result dispatch.` comment — this point is reached only when `runOneCell` *returned* a result (a throw `continue`s to the DLQ path above, which must NOT emit a terminal metric):

```ts
      } finally {
        clearTimeout(timer);
      }

      // Application-failure signal (distinct from the runtime Errors metric):
      // emit one CellFailed point per terminal outcome. 'skipped-cost-cap'
      // self-suppresses inside the emitter.
      emitCellOutcomeMetric(result.status, process.env.LANGFUSE_ENV ?? 'dev');

      // Result dispatch. ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- generation/handler.test.ts`
Expected: PASS (new test + all existing handler tests).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/generation/handler.ts infra/lambda/src/generation/handler.test.ts
git commit -m "feat(lambda): emit CellFailed on terminal generation outcomes"
```

---

### Task 3: `GenerationCellFailuresAlarm` (CDK)

**Files:**
- Modify: `infra/lib/constructs/generation-lambda.ts` (add the alarm after `GenerationErrorsAlarm`; expose `public readonly cellFailuresAlarm`)
- Test: `infra/lib/constructs/generation-lambda.test.ts`

**Interfaces:**
- Consumes: the `CellFailed` metric (namespace `LanguageDrill/Generation`, dimension `env`) emitted in Task 2.
- Produces: `cellFailuresAlarm` on the construct, routed to `props.alarmTopic` when present.

- [ ] **Step 1: Write the failing test**

Add to `infra/lib/constructs/generation-lambda.test.ts` (mirror the existing `GenerationErrorsAlarm` assertions + the theory cell-failures test). The default stack in that file builds with `secretsPrefix` for dev → `env` dimension `'dev'`:

```ts
it('creates the CellFailures alarm (LanguageDrill/Generation CellFailed, env dim, >= 5 / day)', () => {
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    Namespace: 'LanguageDrill/Generation',
    MetricName: 'CellFailed',
    Threshold: 5,
    ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    Dimensions: Match.arrayWith([
      Match.objectLike({ Name: 'env', Value: 'dev' }),
    ]),
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/infra test -- generation-lambda.test.ts -t CellFailures`
Expected: FAIL — no such alarm in the synthesized template.

- [ ] **Step 3: Implement**

In `infra/lib/constructs/generation-lambda.ts`, add `public readonly cellFailuresAlarm: cloudwatch.Alarm;` beside `errorsAlarm`. After the `GenerationErrorsAlarm` block (and before the `if (props.alarmTopic)` action wiring), add:

```ts
    // Application-level failure alarm (mirrors the theory pipeline): catches a
    // wholesale terminal failure (e.g. Anthropic usage-limit) that resolves
    // cells as status='failed' WITHOUT throwing — so it never reaches the DLQ
    // or the runtime Errors metric. The env dimension reuses the same
    // expression that sets LANGFUSE_ENV, which is exactly what the handler
    // emits; a mismatch would silently watch nothing.
    const langfuseEnv =
      props.secretsPrefix === 'language-drill' ? 'prod' : 'dev';
    this.cellFailuresAlarm = new cloudwatch.Alarm(
      this,
      'GenerationCellFailuresAlarm',
      {
        metric: new cloudwatch.Metric({
          namespace: 'LanguageDrill/Generation',
          metricName: 'CellFailed',
          dimensionsMap: { env: langfuseEnv },
          period: Duration.days(1),
          statistic: cloudwatch.Stats.SUM,
        }),
        threshold: 5,
        evaluationPeriods: 1,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription:
          'Phase 4 (exercise gen): >= 5 cells failed at the APPLICATION level ' +
          'in one day (terminal status=failed, e.g. Anthropic usage-limit), ' +
          'distinct from the Lambda runtime Errors alarm.',
      },
    );
```

Then extend the existing SNS wiring to route both alarms:

```ts
    if (props.alarmTopic) {
      const snsAction = new cwactions.SnsAction(props.alarmTopic);
      this.errorsAlarm.addAlarmAction(snsAction);
      this.cellFailuresAlarm.addAlarmAction(snsAction);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/infra test -- generation-lambda.test.ts`
Expected: PASS (new test + existing alarm/SNS tests, including the "routes the Errors alarm to the SNS topic" case which now also covers the cell-failures alarm).

- [ ] **Step 5: Commit**

```bash
git add infra/lib/constructs/generation-lambda.ts infra/lib/constructs/generation-lambda.test.ts
git commit -m "feat(infra): GenerationCellFailuresAlarm on the CellFailed metric"
```

---

### Task 4: API AI-failure alarm (helper + wiring)

**Files:**
- Create: `infra/lib/constructs/ai-failure-alarm.ts`
- Modify: `infra/lib/constructs/lambda.ts` (call the helper next to `addPromptFallbackAlarm`)
- Test: `infra/lib/constructs/lambda.test.ts`

**Interfaces:**
- Produces: `addAiFailureAlarm(scope, id, { logGroup, env, alarmTopic? }): cloudwatch.Alarm` — one `MetricFilter` per AI-failure log line (all → metric `api-ai-failure` in `LanguageDrill/{env}`), plus an alarm (SUM ≥ 5 / 5 min).

- [ ] **Step 1: Write the failing test**

Add to `infra/lib/constructs/lambda.test.ts` (mirror the prompt-fallback assertion; the default test stack uses the dev `secretsPrefix` → namespace `LanguageDrill/dev`):

```ts
it('creates an AI-failure metric filter + alarm (env-namespaced, threshold 5)', () => {
  template.hasResourceProperties('AWS::Logs::MetricFilter', {
    MetricTransformations: Match.arrayWith([
      Match.objectLike({
        MetricName: 'api-ai-failure',
        MetricNamespace: 'LanguageDrill/dev',
      }),
    ]),
  });
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    MetricName: 'api-ai-failure',
    Namespace: 'LanguageDrill/dev',
    Threshold: 5,
    ComparisonOperator: 'GreaterThanOrEqualToThreshold',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/infra test -- lambda.test.ts -t "AI-failure"`
Expected: FAIL — no such metric filter / alarm.

- [ ] **Step 3: Implement the helper**

Create `infra/lib/constructs/ai-failure-alarm.ts`:

```ts
import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwactions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

/**
 * Alarm on sustained AI-call failures in the API Lambda. The submit/eval,
 * reading, and writing-helper routes all *catch* their Claude error, log a
 * stable line, and return 502 AI_UNAVAILABLE — so the Lambda invocation
 * SUCCEEDS and the runtime Errors metric never moves. These caught failures
 * were invisible until now (e.g. the 2026-06-18 Anthropic usage-limit outage).
 *
 * One metric filter per log line, all feeding a single `api-ai-failure` metric,
 * with a sustained-rate alarm (>= 5 in 5 min) so a single transient timeout
 * doesn't page but a real outage does.
 */
// Two NON-OVERLAPPING substrings cover all four AI-call failure lines without
// double-counting any event:
//   - "Claude evaluation failed:"  → [POST /exercises/:id/submit] ...
//   - " generation failed:"        → [POST /read/generate] Reading generation
//     failed:  AND  the writing-helper trio ([brainstorm]/[vocab-boost]/
//     [start-my-paragraph] generation failed:)
const AI_FAILURE_PATTERNS = [
  'Claude evaluation failed:',
  ' generation failed:',
] as const;

export function addAiFailureAlarm(
  scope: Construct,
  id: string,
  opts: {
    logGroup: logs.ILogGroup;
    /** 'prod' | 'dev' — namespaces the metric so the two stacks don't collide. */
    env: 'prod' | 'dev';
    alarmTopic?: sns.ITopic;
  },
): cloudwatch.Alarm {
  const metricNamespace = `LanguageDrill/${opts.env}`;
  const metricName = 'api-ai-failure';

  AI_FAILURE_PATTERNS.forEach((pattern, i) => {
    new logs.MetricFilter(scope, `${id}Filter${i}`, {
      logGroup: opts.logGroup,
      filterPattern: logs.FilterPattern.literal(`"${pattern}"`),
      metricNamespace,
      metricName,
      metricValue: '1',
      defaultValue: 0,
    });
  });

  const alarm = new cloudwatch.Alarm(scope, id, {
    metric: new cloudwatch.Metric({
      namespace: metricNamespace,
      metricName,
      period: Duration.minutes(5),
      statistic: cloudwatch.Stats.SUM,
    }),
    threshold: 5,
    evaluationPeriods: 1,
    comparisonOperator:
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    alarmDescription:
      'API Lambda: >= 5 caught AI-call failures (eval / reading / writing-helper ' +
      '502 AI_UNAVAILABLE) in 5 minutes — Anthropic outage, usage-limit, or a ' +
      'systemic prompt/parse bug. These do not move the Lambda Errors metric.',
  });

  if (opts.alarmTopic) {
    alarm.addAlarmAction(new cwactions.SnsAction(opts.alarmTopic));
  }

  return alarm;
}
```

- [ ] **Step 4: Wire it into `lambda.ts`**

In `infra/lib/constructs/lambda.ts`, add the import next to the existing `addPromptFallbackAlarm` import:

```ts
import { addAiFailureAlarm } from "./ai-failure-alarm";
```

Add the call immediately after the existing `addPromptFallbackAlarm(...)` block:

```ts
    // Alarm on sustained caught AI-call failures (eval / reading / writing
    // helpers) — these return 502 but the invocation succeeds, so the runtime
    // Errors metric never sees them.
    addAiFailureAlarm(this, "ApiAiFailureAlarm", {
      logGroup: this.logGroup,
      env: props.secretsPrefix === "language-drill" ? "prod" : "dev",
      alarmTopic: props.alarmTopic,
    });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @language-drill/infra test -- lambda.test.ts`
Expected: PASS (new test + all existing lambda construct tests).

- [ ] **Step 6: Commit**

```bash
git add infra/lib/constructs/ai-failure-alarm.ts infra/lib/constructs/lambda.ts infra/lib/constructs/lambda.test.ts
git commit -m "feat(infra): alarm on sustained API AI-call failures"
```

---

## Final verification

- [ ] `pnpm lint` — clean
- [ ] `pnpm typecheck` — clean
- [ ] `pnpm turbo run test --concurrency=1` — green (`rm -rf infra/lambda/dist` first if the lambda suite shows phantom stale-dist failures)

## Self-review notes (coverage vs spec)

- Spec Fix 1 (API AI-failure alarm, two non-overlapping patterns, ≥5/5min) → Task 4. ✓
- Spec Fix 2 (CellFailed EMF emitter; handler wiring; daily ≥5 alarm) → Tasks 1, 2, 3. ✓
- Spec "env dimension must match emitter" → enforced in Tasks 2 (`LANGFUSE_ENV`) and 3 (`secretsPrefix`-derived). ✓
- Spec testing (unit emitter, handler wiring, CDK assertions) → Tasks 1, 2, 3, 4. ✓
- Out of scope (Sentry, refactor prompt-fallback, "enqueued 0" alarm, billing-400 discrimination) → not implemented. ✓
