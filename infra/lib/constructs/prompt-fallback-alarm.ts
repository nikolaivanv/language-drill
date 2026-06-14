import { Duration } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwactions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

/**
 * Audit §3.2 — alarm on a non-`keys_unset` Langfuse prompt fallback.
 *
 * The prompt registry (`packages/ai/src/prompts-registry.ts`) serves the
 * in-repo fallback and logs a stable
 *   `[prompts-registry] prompt fallback (reason=timeout|fetch_error) for "…"`
 * line whenever Langfuse was reachable but the fetch failed (timeout, SDK
 * error, or the prompt was deleted/unlabeled). It deliberately does NOT log on
 * the benign `keys_unset` path, so a metric filter on that line catches only
 * the operator-emergency cases — Langfuse could otherwise serve a stale in-repo
 * prompt body for days unnoticed.
 *
 * One metric filter per runtime log group (the API and annotate-stream Lambdas
 * both resolve prompts) → a per-surface custom metric → an alarm routed to the
 * stack alert topic.
 */
export function addPromptFallbackAlarm(
  scope: Construct,
  id: string,
  opts: {
    logGroup: logs.ILogGroup;
    /** 'prod' | 'dev' — namespaces the metric so the two stacks don't collide. */
    env: "prod" | "dev";
    /** Short surface label, e.g. 'api' | 'annotate'. */
    surface: string;
    alarmTopic?: sns.ITopic;
  },
): cloudwatch.Alarm {
  const metricNamespace = `LanguageDrill/${opts.env}`;
  const metricName = `${opts.surface}-prompt-fallback`;

  new logs.MetricFilter(scope, `${id}Filter`, {
    logGroup: opts.logGroup,
    // Quoted literal → substring match on the whole log message; brackets
    // inside quotes are literal (outside quotes they'd denote space-delimited
    // fields). Matches both `reason=timeout` and `reason=fetch_error`.
    filterPattern: logs.FilterPattern.literal(
      '"[prompts-registry] prompt fallback (reason="',
    ),
    metricNamespace,
    metricName,
    metricValue: "1",
    defaultValue: 0,
  });

  const alarm = new cloudwatch.Alarm(scope, id, {
    metric: new cloudwatch.Metric({
      namespace: metricNamespace,
      metricName,
      period: Duration.minutes(5),
      statistic: cloudwatch.Stats.SUM,
    }),
    threshold: 1,
    evaluationPeriods: 1,
    comparisonOperator:
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    alarmDescription:
      "Langfuse prompt registry served the in-repo fallback for a non-keys_unset reason (timeout / fetch_error) — the live prompt may have vanished or Langfuse is unreachable. See CLAUDE.md §Prompt Editing.",
  });

  if (opts.alarmTopic) {
    alarm.addAlarmAction(new cwactions.SnsAction(opts.alarmTopic));
  }

  return alarm;
}
