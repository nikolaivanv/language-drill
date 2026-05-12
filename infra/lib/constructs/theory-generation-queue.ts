import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

/**
 * Phase 4 — dedicated SQS queue + DLQ for the theory generation pipeline.
 *
 * Separate from the exercise-side `GenerationQueue` because the two
 * pipelines have independent reserved-concurrency budgets and DLQ-depth
 * alarms; sharing a queue would couple the operator response surface for
 * unrelated failure modes.
 *
 * Cell-level theory generation takes ~15–25 s (generator + validator + DB
 * write); `visibilityTimeout: 900 s` matches the consumer Lambda's hard
 * timeout (AWS Lambda maximum) with ample headroom. `maxReceiveCount = 3`
 * gives a transient Anthropic 429 three chances to clear before the
 * message lands in the DLQ for operator inspection.
 *
 * The DLQ-depth alarm fires when a single message survives every
 * redelivery and lands in the dead-letter queue — surfacing real
 * generation failures (e.g. an Anthropic outage, a malformed message that
 * the Lambda can't parse) within five minutes. No alarm action is wired in
 * Phase 4 (Req 5.1); the alarm is visible in the AWS console and via
 * CloudWatch Insights queries.
 */
export class TheoryGenerationQueueConstruct extends Construct {
  public readonly queue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;
  public readonly dlqDepthAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.deadLetterQueue = new sqs.Queue(
      this,
      'TheoryGenerationDeadLetterQueue',
      {
        retentionPeriod: Duration.days(14),
      },
    );

    this.queue = new sqs.Queue(this, 'TheoryGenerationQueue', {
      // Must match the consumer Lambda's timeout (900 s; AWS Lambda hard
      // maximum). If `visibilityTimeout < lambda.timeout`, SQS redelivers a
      // still-running message and the cell gets processed twice — wasting
      // Anthropic budget and tripping the dedup short-circuit. Matches the
      // exercise-side PR #71 fix from day 1.
      visibilityTimeout: Duration.seconds(900),
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    this.dlqDepthAlarm = new cloudwatch.Alarm(
      this,
      'TheoryGenerationDlqDepthAlarm',
      {
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
          'Phase 4 (theory): a theory generation message survived every redelivery and landed in the DLQ.',
      },
    );
  }
}
