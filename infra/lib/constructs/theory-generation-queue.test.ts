import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as sns from 'aws-cdk-lib/aws-sns';
import { describe, beforeAll, it } from 'vitest';

import { TheoryGenerationQueueConstruct } from './theory-generation-queue';

/**
 * Pin the CFN shape of TheoryGenerationQueueConstruct: two SQS queues (main +
 * DLQ), the redrive policy, the visibility / retention durations, and the
 * DLQ-depth CloudWatch alarm. Mirrors the exercise-side queue test byte-for-
 * byte; the theory pipeline ships these invariants from day 1 instead of
 * re-discovering them.
 */
describe('TheoryGenerationQueueConstruct', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    new TheoryGenerationQueueConstruct(stack, 'TheoryGenerationQueue');
    template = Template.fromStack(stack);
  });

  it('creates exactly two SQS queues (main + DLQ)', () => {
    template.resourceCountIs('AWS::SQS::Queue', 2);
  });

  it('main queue has visibility timeout 900 (matches Lambda) and a redrive policy with maxReceiveCount 3', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 900,
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

  it('DLQ-depth alarm has no AlarmActions when no alarmTopic is supplied', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmActions: Match.absent(),
    });
  });

  it('routes the DLQ-depth alarm to the SNS topic when alarmTopic is supplied', () => {
    const app = new App();
    const stack = new Stack(app, 'TopicStack');
    const topic = new sns.Topic(stack, 'T');
    new TheoryGenerationQueueConstruct(stack, 'TheoryGenerationQueue', {
      alarmTopic: topic,
    });
    Template.fromStack(stack).hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmActions: Match.arrayWith([Match.objectLike({ Ref: Match.anyValue() })]),
    });
  });
});
