import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwactions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

/**
 * Phase 4 — dedicated SQS queue + DLQ for the generation pipeline.
 *
 * Separate from the legacy `JobsQueue` (`queue.ts`) because cell-level
 * generation can take minutes (50 drafts × 2 Claude calls × ~3 s ≈ 5 min worst
 * case) and shares no visibility-timeout requirement with the older queue.
 * `maxReceiveCount = 3` matches the Phase 3 dedup-retry budget; a transient
 * Anthropic 429 has three chances to clear before the message lands in the
 * DLQ for operator inspection.
 *
 * The DLQ-depth alarm fires when a single message survives every redelivery
 * and lands in the dead-letter queue — surfacing real generation failures
 * (e.g. an Anthropic outage, a malformed message that the Lambda can't parse)
 * within five minutes. When an `alarmTopic` is supplied the alarm routes to
 * the stack alert topic so the operator is notified, not just the console.
 */
export interface GenerationQueueConstructProps {
  /** SNS topic for the DLQ-depth alarm action. */
  readonly alarmTopic?: sns.ITopic;
}

export class GenerationQueueConstruct extends Construct {
  public readonly queue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;
  public readonly dlqDepthAlarm: cloudwatch.Alarm;

  constructor(
    scope: Construct,
    id: string,
    props?: GenerationQueueConstructProps,
  ) {
    super(scope, id);

    this.deadLetterQueue = new sqs.Queue(this, 'GenerationDeadLetterQueue', {
      retentionPeriod: Duration.days(14),
    });

    this.queue = new sqs.Queue(this, 'GenerationQueue', {
      // Must match the consumer Lambda's timeout (900 s; AWS Lambda hard
      // maximum). If `visibilityTimeout < lambda.timeout`, SQS redelivers a
      // still-running message and the cell gets processed twice — wasting
      // Anthropic budget and tripping the dedup-retry guard. Bumped from
      // 600 s on 2026-05-12 alongside the Lambda timeout bump.
      visibilityTimeout: Duration.seconds(900),
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    this.dlqDepthAlarm = new cloudwatch.Alarm(this, 'GenerationDlqDepthAlarm', {
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: cloudwatch.Stats.MAXIMUM,
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        'Phase 4: a generation message survived every redelivery and landed in the DLQ.',
    });

    if (props?.alarmTopic) {
      this.dlqDepthAlarm.addAlarmAction(
        new cwactions.SnsAction(props.alarmTopic),
      );
    }
  }
}
