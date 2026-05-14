import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
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
