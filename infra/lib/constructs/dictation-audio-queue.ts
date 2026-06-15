import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

/**
 * SQS queue + DLQ for the dictation audio-synth pipeline (Phase 2). One message
 * per approved dictation row; the consumer Lambda calls Polly, uploads the MP3
 * to S3, and sets `audio_s3_key`. A single Polly synth + S3 put is fast (a few
 * seconds), so the visibility timeout is far below the generation queue's 900 s.
 * `maxReceiveCount = 3` gives a transient Polly/S3 error two retries before the
 * message lands in the DLQ.
 */
export class DictationAudioQueueConstruct extends Construct {
  public readonly queue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;
  public readonly dlqDepthAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.deadLetterQueue = new sqs.Queue(this, 'DictationAudioDeadLetterQueue', {
      retentionPeriod: Duration.days(14),
    });

    this.queue = new sqs.Queue(this, 'DictationAudioQueue', {
      // Must be >= the consumer Lambda's timeout. Polly synth + S3 put is quick;
      // 120 s leaves generous headroom for cold starts + a long clip.
      visibilityTimeout: Duration.seconds(120),
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 3 },
    });

    this.dlqDepthAlarm = new cloudwatch.Alarm(this, 'DictationAudioDlqDepthAlarm', {
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: cloudwatch.Stats.MAXIMUM,
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        'A dictation audio-synth message survived every redelivery and landed in the DLQ.',
    });
  }
}
