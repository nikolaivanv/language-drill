import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { describe, beforeAll, expect, it } from 'vitest';

import { DictationAudioLambdaConstruct } from './dictation-audio-lambda';

/**
 * Pin the CFN shape of DictationAudioLambdaConstruct: NodejsFunction (timeout
 * <= the queue's 120 s visibility, reserved concurrency for Polly TPS), the SQS
 * event source on the audio queue, the env (CONTENT_BUCKET_NAME + DATABASE_URL),
 * and the IAM contract: Polly SynthesizeSpeech (account-scoped), S3 PutObject on
 * the content bucket, DATABASE_URL secret read — and NOT the Anthropic/Langfuse
 * secrets the generation Lambda needs (this Lambda never calls Claude).
 */
describe('DictationAudioLambdaConstruct', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const queue = new sqs.Queue(stack, 'StubQueue');
    const bucket = new s3.Bucket(stack, 'StubBucket');
    new DictationAudioLambdaConstruct(stack, 'DictationAudioLambda', {
      queue,
      contentBucket: bucket,
      secretsPrefix: 'language-drill-dev',
      reservedConcurrency: 2,
    });
    template = Template.fromStack(stack);
  });

  it('creates a NodejsFunction with a 90s timeout (<= the queue 120s visibility) and reserved concurrency 2', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Timeout: 90,
      ReservedConcurrentExecutions: 2,
    });
  });

  it('wires the Lambda to the SQS queue with BatchSize, ReportBatchItemFailures, and MaximumConcurrency matching reservedConcurrency', () => {
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      ScalingConfig: { MaximumConcurrency: 2 },
    });
  });

  it('Lambda Environment.Variables includes CONTENT_BUCKET_NAME and DATABASE_URL', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          CONTENT_BUCKET_NAME: Match.anyValue(),
          DATABASE_URL: Match.anyValue(),
        }),
      },
    });
  });

  it('grants polly:SynthesizeSpeech (account-scoped, resource *)', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'polly:SynthesizeSpeech',
            Effect: 'Allow',
            Resource: '*',
          }),
        ]),
      },
    });
  });

  it('grants s3:PutObject on the content bucket', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const serialized = JSON.stringify(policies);
    expect(serialized).toContain('s3:PutObject');
  });

  it('grants read on DATABASE_URL only (no Anthropic / Langfuse / Clerk secrets)', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const serialized = JSON.stringify(policies);

    expect(serialized).toContain('/DATABASE_URL');
    expect(serialized).not.toContain('/ANTHROPIC_API_KEY');
    expect(serialized).not.toContain('/LANGFUSE_PUBLIC_KEY');
    expect(serialized).not.toContain('/LANGFUSE_SECRET_KEY');
    expect(serialized).not.toContain('/CLERK_SECRET_KEY');
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
    const bucket = new s3.Bucket(stack, 'StubBucket');
    const topic = new sns.Topic(stack, 'T');
    new DictationAudioLambdaConstruct(stack, 'DictationAudioLambda', {
      queue,
      contentBucket: bucket,
      secretsPrefix: 'language-drill-dev',
      reservedConcurrency: 2,
      alarmTopic: topic,
    });
    Template.fromStack(stack).hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmActions: Match.arrayWith([Match.objectLike({ Ref: Match.anyValue() })]),
    });
  });
});
