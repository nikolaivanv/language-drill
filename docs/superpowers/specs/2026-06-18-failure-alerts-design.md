# Failure Alerts for Critical Backend Failures

**Date:** 2026-06-18
**Surfaces:** `infra/lib` (CDK alarms), `infra/lambda/src/generation` (application metric)

## Problem

When the Anthropic org usage limit was exhausted (2026-06-18 ~09:08 UTC), two
production failures went **unalerted**:

1. **Answer evaluation** (`POST /exercises/:id/submit`) returned `502
   AI_UNAVAILABLE` for every user. The route *catches* the Claude error, logs
   `[POST /exercises/:id/submit] Claude evaluation failed:`, and returns a 502
   *response* — so the Lambda invocation **succeeds**. It never increments the
   Lambda `Errors` metric, and nothing watches the log line. No alarm fired.
   Nothing appeared in Sentry because Sentry is wired only into `apps/web`; the
   Lambda API isn't connected to it (by design — `Lambda → CloudWatch`).

2. **Nightly exercise generation** failed silently. When a cell's generation
   resolves as a terminal `status='failed'`, the handler logs `cell
   terminal-failed` (warn) and does **not** push to `batchItemFailures` — SQS
   sees success, nothing reaches the DLQ. Unlike the *theory* pipeline, exercise
   generation emits **no** application-level CloudWatch metric, so neither the
   runtime-`Errors` alarm nor the DLQ-depth alarm catches a wholesale failure.

## Existing infrastructure (reused, not rebuilt)

- `infra/lib/constructs/alerts.ts` — an SNS topic with a confirmed email
  subscription (`nikolaivanv@gmail.com`), exposed as `alerts.topic` and passed
  to constructs as `alarmTopic?: sns.ITopic`.
- `infra/lib/constructs/prompt-fallback-alarm.ts` — `addPromptFallbackAlarm`: a
  `MetricFilter` on a log-line substring → custom metric → `Alarm` → conditional
  `SnsAction`. **This is the template for fix #1.**
- `infra/lambda/src/theory-generation/metrics.ts` — `emitCellOutcomeMetric`: EMF
  `CellFailed` metric (namespace `LanguageDrill/TheoryGeneration`, dimension
  `env`), and `TheoryGenerationCellFailuresAlarm` in
  `theory-generation-lambda.ts`. **This is the template for fix #2.**

## Decisions (from brainstorming)

- **Mechanism:** CloudWatch metric-filter / EMF → existing SNS email topic. **No
  Sentry-in-Lambda** (keeps the `Lambda → CloudWatch` boundary, no new deps).
- **Sensitivity:** sustained-rate, not every single failure.

## Design

### Fix 1 — API "AI is failing" alarm

New helper `infra/lib/constructs/ai-failure-alarm.ts` exporting
`addAiFailureAlarm`, modeled on `addPromptFallbackAlarm`. It creates **one
`MetricFilter` per failure log line**, all incrementing a single metric
`api-ai-failure` in namespace `LanguageDrill/{env}` on the API Lambda log group,
plus one `Alarm`:

- Patterns matched (the API Lambda's caught AI-call failures) — two
  **non-overlapping** substrings so no log event is counted twice:
  - `"Claude evaluation failed:"` — the eval/submit 502 (`[POST
    /exercises/:id/submit] Claude evaluation failed:`).
  - `" generation failed:"` (leading space) — covers the reading failure
    (`[POST /read/generate] Reading generation failed:`) **and** the
    writing-helper trio (`[brainstorm]`/`[vocab-boost]`/`[start-my-paragraph]
    generation failed:`) in one pattern, since all four share that suffix.
- Alarm: `period = 5 min`, `statistic = SUM`, `threshold = 5`,
  `comparisonOperator = GREATER_THAN_OR_EQUAL_TO_THRESHOLD`,
  `evaluationPeriods = 1`, `treatMissingData = NOT_BREACHING`. Conditional
  `SnsAction(alarmTopic)`.

Wired in `infra/lib/constructs/lambda.ts` next to the existing
`addPromptFallbackAlarm(... "ApiPromptFallbackAlarm" ...)` call, passing the same
`this.logGroup`, `env`, and `props.alarmTopic`.

Each `MetricFilter` uses `metricValue: "1"`, `defaultValue: 0`. A multi-day
outage trips the alarm once (state → ALARM) and stays there; CloudWatch does not
re-send on every data point.

### Fix 2 — Nightly generation cell-failure metric + alarm

Mirror the theory pipeline exactly.

- New `infra/lambda/src/generation/metrics.ts` with
  `emitCellOutcomeMetric(status, env)`:
  - `status === 'skipped-cost-cap'` → no emit (a deliberate budget stop is not a
    failure).
  - otherwise `CellFailed: status === 'failed' ? 1 : 0` (the `0` on success lets
    the alarm distinguish "all passing" from "no runs").
  - EMF over `console.log`, namespace `LanguageDrill/Generation`, metric
    `CellFailed`, dimensions `[['env']]`.
- Call `emitCellOutcomeMetric(result.status, env)` in the generation handler's
  terminal-result branches (where it already logs `cell succeeded` /
  `cell terminal-failed`). The `env` value must equal the alarm's
  `dimensionsMap.env` (`'prod'`/`'dev'`).
- New `GenerationCellFailuresAlarm` in
  `infra/lib/constructs/generation-lambda.ts`, copied from
  `TheoryGenerationCellFailuresAlarm`: namespace `LanguageDrill/Generation`,
  metric `CellFailed`, `dimensionsMap: { env }`, `period = 1 day`,
  `statistic = SUM`, `threshold = 5`,
  `GREATER_THAN_OR_EQUAL_TO_THRESHOLD`, `evaluationPeriods = 1`,
  `treatMissingData = NOT_BREACHING`, conditional `SnsAction(props.alarmTopic)`.
  The `env` is derived the same way theory does it (from `secretsPrefix` /
  `envName`).

## Out of scope

- Wiring Sentry into any Lambda.
- Refactoring the working `prompt-fallback-alarm.ts` onto a shared helper.
- A "scheduler enqueued 0 jobs" alarm — a healthy pool legitimately enqueues 0;
  the cell-failure metric is the real failure signal.
- Distinguishing Anthropic billing/usage-limit 400s from other failures in the
  alarm (the sustained-rate alarm catches the outage regardless of cause; the
  Anthropic budget email already covers the billing-specific signal).

## Testing

- **Unit** (`infra/lambda/src/generation/metrics.test.ts`): mirror theory's
  metrics test — `CellFailed: 1` on `'failed'`, `0` on `'succeeded'`, no emit on
  `'skipped-cost-cap'`; correct namespace/dimension/`env` in the EMF JSON.
- **Handler** (existing generation handler test): the terminal branches call
  `emitCellOutcomeMetric` with the resolved status.
- **CDK assertions** (`infra` package tests, mirroring the theory/prompt-fallback
  alarm tests): the API log group gets the AI-failure metric filters + an alarm
  with an SNS action; the generation Lambda gets a `CellFailed` alarm wired to
  the topic.

## Deployment

CDK changes apply on merge → CDK deploy (prod and dev). The SNS topic and its
email subscription already exist and are confirmed, so no new subscription
confirmation is needed. The alarms begin evaluating immediately after deploy.
