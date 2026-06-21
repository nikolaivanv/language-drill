import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwactions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface EmailQueueConstructProps {
  readonly alarmTopic?: sns.ITopic;
}

/**
 * Dedicated SQS queue + DLQ for weekly-summary sends. Separate from the
 * generation queue: sends are short (one render + one Resend call), so the
 * visibility timeout is small. maxReceiveCount=3 gives a transient Resend/DB
 * blip a couple of retries before a message lands in the DLQ for inspection.
 */
export class EmailQueueConstruct extends Construct {
  public readonly queue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;
  public readonly dlqDepthAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props?: EmailQueueConstructProps) {
    super(scope, id);

    this.deadLetterQueue = new sqs.Queue(this, 'EmailDeadLetterQueue', {
      retentionPeriod: Duration.days(14),
    });

    this.queue = new sqs.Queue(this, 'EmailQueue', {
      visibilityTimeout: Duration.seconds(120), // must be ≥ sender Lambda timeout
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 3 },
    });

    this.dlqDepthAlarm = new cloudwatch.Alarm(this, 'EmailDlqDepthAlarm', {
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: cloudwatch.Stats.MAXIMUM,
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'A weekly-summary email message survived every redelivery and landed in the DLQ.',
    });

    if (props?.alarmTopic) {
      this.dlqDepthAlarm.addAlarmAction(new cwactions.SnsAction(props.alarmTopic));
    }
  }
}
