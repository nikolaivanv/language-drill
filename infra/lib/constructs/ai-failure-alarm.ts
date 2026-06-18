import { Duration } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwactions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

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
  "Claude evaluation failed:",
  " generation failed:",
] as const;

export function addAiFailureAlarm(
  scope: Construct,
  id: string,
  opts: {
    logGroup: logs.ILogGroup;
    /** 'prod' | 'dev' — namespaces the metric so the two stacks don't collide. */
    env: "prod" | "dev";
    alarmTopic?: sns.ITopic;
  },
): cloudwatch.Alarm {
  const metricNamespace = `LanguageDrill/${opts.env}`;
  const metricName = "api-ai-failure";

  AI_FAILURE_PATTERNS.forEach((pattern, i) => {
    new logs.MetricFilter(scope, `${id}Filter${i}`, {
      logGroup: opts.logGroup,
      filterPattern: logs.FilterPattern.literal(`"${pattern}"`),
      metricNamespace,
      metricName,
      metricValue: "1",
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
      "API Lambda: >= 5 caught AI-call failures (eval / reading / writing-helper " +
      "502 AI_UNAVAILABLE) in 5 minutes — Anthropic outage, usage-limit, or a " +
      "systemic prompt/parse bug. These do not move the Lambda Errors metric.",
  });

  if (opts.alarmTopic) {
    alarm.addAlarmAction(new cwactions.SnsAction(opts.alarmTopic));
  }

  return alarm;
}
