import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { describe, expect, it } from 'vitest';

import { TheorySchedulerLambdaConstruct } from './theory-scheduler-lambda';

/**
 * Pin the TheorySchedulerLambdaConstruct's CFN gate behaviour:
 * - enableScheduledJobs=true → exactly one EventBridge rule, fires weekly on
 *   Mondays at 04:00 UTC (distinct from the exercise scheduler's daily cron).
 * - enableScheduledJobs=false → zero EventBridge rules; the Lambda still
 *   exists so dev can invoke it manually.
 *
 * Also pin the IAM minimum-privilege contract: DATABASE_URL only, plus
 * sqs:SendMessage on the queue. No ANTHROPIC_API_KEY (the scheduler does not
 * call Claude — that key intentionally stays out of the scheduler's IAM
 * surface so a misconfigured scheduler can never burn the Anthropic budget).
 */
function buildStack(enableScheduledJobs: boolean): Template {
  const app = new App();
  const stack = new Stack(app, 'TestStack');
  const queue = new sqs.Queue(stack, 'StubQueue');
  new TheorySchedulerLambdaConstruct(stack, 'TheorySchedulerLambda', {
    queue,
    secretsPrefix: 'language-drill-dev',
    enableScheduledJobs,
  });
  return Template.fromStack(stack);
}

describe('TheorySchedulerLambdaConstruct', () => {
  describe('when enableScheduledJobs=true', () => {
    const template = buildStack(true);

    it('creates exactly one EventBridge rule', () => {
      template.resourceCountIs('AWS::Events::Rule', 1);
    });

    it('the EventBridge rule fires weekly on Mondays at 04:00 UTC by default', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        ScheduleExpression: 'cron(0 4 ? * MON *)',
      });
    });

    it('the EventBridge rule description identifies the theory scheduler', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Description: Match.stringLikeRegexp(
          'Phase 4 \\(theory\\): weekly refill scheduler',
        ),
      });
    });

    it('creates the scheduler Lambda with timeout 60 and memory 512', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs22.x',
        Timeout: 60,
        MemorySize: 512,
      });
    });

    it('exposes THEORY_GENERATION_QUEUE_URL on the Lambda environment', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            THEORY_GENERATION_QUEUE_URL: Match.anyValue(),
          }),
        },
      });
    });

    it('Lambda environment does NOT include ANTHROPIC_API_KEY', () => {
      const fns = template.findResources('AWS::Lambda::Function');
      const serialized = JSON.stringify(fns);
      expect(serialized).not.toContain('ANTHROPIC_API_KEY');
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
        Runtime: 'nodejs22.x',
        Timeout: 60,
        MemorySize: 512,
      });
    });

    it('still exposes THEORY_GENERATION_QUEUE_URL on the Lambda environment', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            THEORY_GENERATION_QUEUE_URL: Match.anyValue(),
          }),
        },
      });
    });

    it('Lambda IAM still has sqs:SendMessage, no ANTHROPIC_API_KEY', () => {
      const policies = template.findResources('AWS::IAM::Policy');
      const serialized = JSON.stringify(policies);

      expect(serialized).toContain('/DATABASE_URL');
      expect(serialized).toContain('sqs:SendMessage');
      expect(serialized).not.toContain('/ANTHROPIC_API_KEY');
    });
  });
});
