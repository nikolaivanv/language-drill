import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { MasteryRebuildLambdaConstruct } from './mastery-rebuild-lambda';

/**
 * Pin the MasteryRebuildLambdaConstruct's CFN gate behaviour:
 * - enableScheduledJobs=true → exactly one EventBridge rule, fires daily at
 *   03:00 UTC.
 * - enableScheduledJobs=false → zero EventBridge rules; the Lambda still
 *   exists so dev can invoke it manually.
 *
 * Also pin the IAM/env minimum-privilege contract: DATABASE_URL plus
 * MASTERY_REBUILD_MAX_DELETES (defaulting to '5'), no ANTHROPIC_API_KEY —
 * that key intentionally stays out of this Lambda's IAM and env surface so a
 * misconfigured scheduler can never burn the Anthropic budget.
 */
function buildStack(enableScheduledJobs: boolean): Template {
  const app = new App();
  const stack = new Stack(app, 'TestStack');
  new MasteryRebuildLambdaConstruct(stack, 'MasteryRebuildLambda', {
    secretsPrefix: 'language-drill-dev',
    enableScheduledJobs,
  });
  return Template.fromStack(stack);
}

describe('MasteryRebuildLambdaConstruct', () => {
  describe('when enableScheduledJobs=true', () => {
    const template = buildStack(true);

    it('creates exactly one EventBridge rule', () => {
      template.resourceCountIs('AWS::Events::Rule', 1);
    });

    it('the EventBridge rule fires daily at 03:00 UTC by default', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        ScheduleExpression: 'cron(0 3 * * ? *)',
      });
    });

    it('the EventBridge rule description identifies the mastery rebuild', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Description: Match.stringLikeRegexp('Nightly mastery rebuild'),
      });
    });

    it('creates the Lambda with timeout 300 and memory 512', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs22.x',
        Timeout: 300,
        MemorySize: 512,
      });
    });

    it('exposes DATABASE_URL and MASTERY_REBUILD_MAX_DELETES (default 5) on the Lambda environment', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            DATABASE_URL: Match.anyValue(),
            MASTERY_REBUILD_MAX_DELETES: '5',
          }),
        },
      });
    });

    it('Lambda environment does NOT include ANTHROPIC_API_KEY', () => {
      const fns = template.findResources('AWS::Lambda::Function');
      const serialized = JSON.stringify(fns);
      expect(serialized).not.toContain('ANTHROPIC_API_KEY');
    });

    it('IAM policies grant DATABASE_URL read only; no ANTHROPIC_API_KEY', () => {
      const policies = template.findResources('AWS::IAM::Policy');
      const serialized = JSON.stringify(policies);

      expect(serialized).toContain('/DATABASE_URL');

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

    it('still creates the rebuild Lambda for ad-hoc invocation', () => {
      // Not resourceCountIs(1): NodejsFunction's `logRetention` prop adds a
      // second AWS::Lambda::Function (the log-retention custom resource
      // provider), so assert on this function's own properties instead.
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs22.x',
        Timeout: 300,
        MemorySize: 512,
      });
    });

    it('still exposes DATABASE_URL and MASTERY_REBUILD_MAX_DELETES (default 5) on the Lambda environment', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            DATABASE_URL: Match.anyValue(),
            MASTERY_REBUILD_MAX_DELETES: '5',
          }),
        },
      });
    });

    it('Lambda environment still does NOT include ANTHROPIC_API_KEY anywhere', () => {
      const fns = template.findResources('AWS::Lambda::Function');
      const serialized = JSON.stringify(fns);
      expect(serialized).not.toContain('ANTHROPIC_API_KEY');
    });
  });
});
