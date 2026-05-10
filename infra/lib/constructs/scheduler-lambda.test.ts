import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { describe, expect, it } from 'vitest';

import { SchedulerLambdaConstruct } from './scheduler-lambda';

/**
 * Pin the SchedulerLambdaConstruct's CFN gate behaviour:
 * - enableScheduledJobs=true → exactly one EventBridge rule wired to the Lambda.
 * - enableScheduledJobs=false → zero EventBridge rules; the Lambda still exists
 *   so dev can invoke it manually.
 *
 * Also pin the IAM minimum-privilege contract: DATABASE_URL only, plus
 * sqs:SendMessage on the queue. No ANTHROPIC_API_KEY (the scheduler does not
 * call Claude).
 */
function buildStack(enableScheduledJobs: boolean): Template {
  const app = new App();
  const stack = new Stack(app, 'TestStack');
  const queue = new sqs.Queue(stack, 'StubQueue');
  new SchedulerLambdaConstruct(stack, 'SchedulerLambda', {
    queue,
    secretsPrefix: 'language-drill-dev',
    enableScheduledJobs,
  });
  return Template.fromStack(stack);
}

describe('SchedulerLambdaConstruct', () => {
  describe('when enableScheduledJobs=true', () => {
    const template = buildStack(true);

    it('creates exactly one EventBridge rule', () => {
      template.resourceCountIs('AWS::Events::Rule', 1);
    });

    it('the EventBridge rule fires daily at 04:00 UTC by default', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        ScheduleExpression: 'cron(0 4 * * ? *)',
      });
    });

    it('creates the scheduler Lambda with timeout 60 and memory 512', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs20.x',
        Timeout: 60,
        MemorySize: 512,
      });
    });

    it('IAM policies grant DATABASE_URL read and sqs:SendMessage; no ANTHROPIC_API_KEY', () => {
      const policies = template.findResources('AWS::IAM::Policy');
      const serialized = JSON.stringify(policies);

      expect(serialized).toContain('/DATABASE_URL');
      expect(serialized).toContain('sqs:SendMessage');

      expect(serialized).not.toContain('/ANTHROPIC_API_KEY');
      expect(serialized).not.toContain('/CLERK_SECRET_KEY');
      expect(serialized).not.toContain('/UPSTASH_REDIS_REST_URL');
    });
  });

  describe('when enableScheduledJobs=false', () => {
    const template = buildStack(false);

    it('omits the EventBridge rule', () => {
      template.resourceCountIs('AWS::Events::Rule', 0);
    });

    it('still creates the scheduler Lambda for ad-hoc invocation', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs20.x',
        Timeout: 60,
        MemorySize: 512,
      });
    });
  });
});
