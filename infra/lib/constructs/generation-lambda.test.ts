import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { describe, beforeAll, expect, it } from 'vitest';

import { GenerationLambdaConstruct } from './generation-lambda';

/**
 * Pin the CFN shape of GenerationLambdaConstruct: NodejsFunction (timeout,
 * memory, runtime, reserved concurrency), SQS event source mapping, the
 * Errors CloudWatch alarm, and — importantly — the IAM minimum-privilege
 * contract (only DATABASE_URL + ANTHROPIC_API_KEY; no Clerk, no Upstash).
 */
describe('GenerationLambdaConstruct', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const queue = new sqs.Queue(stack, 'StubQueue');
    new GenerationLambdaConstruct(stack, 'GenerationLambda', {
      queue,
      secretsPrefix: 'language-drill-dev',
      envName: 'dev',
      reservedConcurrency: 3,
    });
    template = Template.fromStack(stack);
  });

  it('creates a NodejsFunction with timeout 900, memory 1024, reserved concurrency 3', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Timeout: 900,
      MemorySize: 1024,
      ReservedConcurrentExecutions: 3,
    });
  });

  it('wires the Lambda to the SQS queue with BatchSize=1, ReportBatchItemFailures, and MaximumConcurrency matching reservedConcurrency', () => {
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      BatchSize: 1,
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      ScalingConfig: { MaximumConcurrency: 3 },
    });
  });

  it('creates the Errors CloudWatch alarm (threshold > 5, period 1 day, sum)', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'Errors',
      Namespace: 'AWS/Lambda',
      Statistic: 'Sum',
      Period: 86400,
      Threshold: 5,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
      EvaluationPeriods: 1,
    });
  });

  it('Errors alarm has no AlarmActions when no alarmTopic is supplied', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmActions: Match.absent(),
    });
  });

  it('routes the Errors alarm to the SNS topic when alarmTopic is supplied', () => {
    const app = new App();
    const stack = new Stack(app, 'TopicStack');
    const queue = new sqs.Queue(stack, 'StubQueue');
    const topic = new sns.Topic(stack, 'T');
    new GenerationLambdaConstruct(stack, 'GenerationLambda', {
      queue,
      secretsPrefix: 'language-drill-dev',
      envName: 'dev',
      reservedConcurrency: 3,
      alarmTopic: topic,
    });
    Template.fromStack(stack).hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmActions: Match.arrayWith([Match.objectLike({ Ref: Match.anyValue() })]),
    });
  });

  it('creates the CellFailures alarm (LanguageDrill/Generation CellFailed, env dim, >= 5 / day)', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'LanguageDrill/Generation',
      MetricName: 'CellFailed',
      Threshold: 5,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      Dimensions: Match.arrayWith([
        Match.objectLike({ Name: 'env', Value: 'dev' }),
      ]),
    });
  });

  it('creates the daily-cost alarm (LanguageDrill/Generation CellCostUsd, env dim, sum > $50/day)', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'LanguageDrill/Generation',
      MetricName: 'CellCostUsd',
      Statistic: 'Sum',
      Period: 86400,
      Threshold: 50,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
      EvaluationPeriods: 1,
      Dimensions: Match.arrayWith([
        Match.objectLike({ Name: 'env', Value: 'dev' }),
      ]),
    });
  });

  it('honours a custom dailyCostAlarmUsd threshold', () => {
    const app = new App();
    const stack = new Stack(app, 'CostThresholdStack');
    const queue = new sqs.Queue(stack, 'StubQueue');
    new GenerationLambdaConstruct(stack, 'GenerationLambda', {
      queue,
      secretsPrefix: 'language-drill-dev',
      envName: 'dev',
      reservedConcurrency: 3,
      dailyCostAlarmUsd: 120,
    });
    Template.fromStack(stack).hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'CellCostUsd',
      Threshold: 120,
    });
  });

  it('IAM policies grant access to DATABASE_URL, ANTHROPIC_API_KEY, and the two Langfuse secrets only', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const serialized = JSON.stringify(policies);

    expect(serialized).toContain('/DATABASE_URL');
    expect(serialized).toContain('/ANTHROPIC_API_KEY');
    // Phase-1 Langfuse secrets (Req 8.1 / 8.2) — added by Task 18.
    expect(serialized).toContain('/LANGFUSE_PUBLIC_KEY');
    expect(serialized).toContain('/LANGFUSE_SECRET_KEY');

    expect(serialized).not.toContain('/CLERK_SECRET_KEY');
    expect(serialized).not.toContain('/CLERK_WEBHOOK_SECRET');
    expect(serialized).not.toContain('/UPSTASH_REDIS_REST_URL');
    expect(serialized).not.toContain('/UPSTASH_REDIS_REST_TOKEN');
  });

  it("Lambda Environment.Variables includes LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and LANGFUSE_ENV='dev'", () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          LANGFUSE_PUBLIC_KEY: Match.anyValue(),
          LANGFUSE_SECRET_KEY: Match.anyValue(),
          LANGFUSE_ENV: 'dev',
        }),
      },
    });
  });
});
