import { Duration } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwactions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

/**
 * Alarm on sustained caught AI-call failures in a Lambda runtime. Routes that
 * *catch* their Claude error, log a stable line, and degrade gracefully (the
 * invocation SUCCEEDS, so the runtime Errors metric never moves) are otherwise
 * invisible — e.g. the 2026-06-18 Anthropic usage-limit outage.
 *
 * One metric filter per caller-supplied log substring, all feeding a single
 * `${surface}-ai-failure` metric, with a sustained-rate alarm (>= `threshold`
 * in 5 min, default 5) so a single transient timeout doesn't page but a real
 * outage does. Used by both the API Lambda and the annotate-stream Lambda; the
 * `patterns` must be NON-OVERLAPPING so no log event is double-counted.
 */
export function addAiFailureAlarm(
  scope: Construct,
  id: string,
  opts: {
    logGroup: logs.ILogGroup;
    /** 'prod' | 'dev' — namespaces the metric so the two stacks don't collide. */
    env: "prod" | "dev";
    /** Short surface label, e.g. 'api' | 'annotate' → metric `${surface}-ai-failure`. */
    surface: string;
    /** Non-overlapping log substrings to match (one MetricFilter each). */
    patterns: readonly string[];
    alarmDescription: string;
    /** Sustained-failure threshold over a 5-minute window. Defaults to 5. */
    threshold?: number;
    alarmTopic?: sns.ITopic;
  },
): cloudwatch.Alarm {
  const metricNamespace = `LanguageDrill/${opts.env}`;
  const metricName = `${opts.surface}-ai-failure`;

  opts.patterns.forEach((pattern, i) => {
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
    threshold: opts.threshold ?? 5,
    evaluationPeriods: 1,
    comparisonOperator:
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    alarmDescription: opts.alarmDescription,
  });

  if (opts.alarmTopic) {
    alarm.addAlarmAction(new cwactions.SnsAction(opts.alarmTopic));
  }

  return alarm;
}
