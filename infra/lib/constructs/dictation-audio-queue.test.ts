import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, beforeAll, it } from 'vitest';

import { DictationAudioQueueConstruct } from './dictation-audio-queue';

/**
 * Pin the CFN shape of DictationAudioQueueConstruct: two SQS queues (main + DLQ),
 * the redrive policy, the visibility / retention durations, and the DLQ-depth
 * CloudWatch alarm. The visibility timeout is far below the generation queue's
 * 900 s because a Polly synth + S3 put is quick; the test asserts the alarm
 * exists and is configured correctly (no action wired yet).
 */
describe('DictationAudioQueueConstruct', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    new DictationAudioQueueConstruct(stack, 'DictationAudioQueue');
    template = Template.fromStack(stack);
  });

  it('creates exactly two SQS queues (main + DLQ)', () => {
    template.resourceCountIs('AWS::SQS::Queue', 2);
  });

  it('main queue has visibility timeout 120 (Polly synth is quick) and a redrive policy with maxReceiveCount 3', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 120,
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }),
    });
  });

  it('DLQ has 14-day message retention', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 14 * 86400,
    });
  });

  it('creates exactly one CloudWatch alarm (the DLQ-depth alarm)', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 1);
  });

  it('DLQ-depth alarm fires when ApproximateNumberOfMessagesVisible >= 1', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'ApproximateNumberOfMessagesVisible',
      Namespace: 'AWS/SQS',
      Statistic: 'Maximum',
      Period: 300,
      Threshold: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      TreatMissingData: 'notBreaching',
      EvaluationPeriods: 1,
    });
  });
});
