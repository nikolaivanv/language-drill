import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import { describe, expect, it } from 'vitest';

import { ApiGatewayConstruct } from './api-gateway';

/**
 * Pin the API Gateway *observability* contract.
 *
 * Requests the JWT authorizer rejects never invoke the Lambda: they emit no
 * Lambda metric, write no line to the handler's log group, and — before this
 * construct gained an alarm — tripped nothing at all. Measured on prod
 * 2026-09-23/24, *every* request that day was a 4xx with zero Lambda
 * invocations, and no alarm fired, because every alarm in the stack watches
 * `AWS/Lambda Errors`, SQS DLQ depth, or a custom `LanguageDrill/*` metric
 * emitted from inside a Lambda. This layer was structurally unmonitored.
 *
 * Two things close that hole, and both are pinned here:
 *  1. Access logging on the default stage — the only way to tell a `401`
 *     (authorizer) from a `404` (no matching route), and the only record of
 *     the source IP and path.
 *  2. Gateway-level 4xx and 5xx alarms wired to the shared SNS topic.
 */
function buildStack(alarmTopic?: sns.ITopic): Template {
  const app = new App();
  const stack = new Stack(app, 'TestStack');
  const handler = new lambda.Function(stack, 'Handler', {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => {};'),
  });
  new ApiGatewayConstruct(stack, 'ApiGateway', {
    handler,
    apiName: 'language-drill-api-test',
    clerkIssuerUrl: 'https://clerk.example.com',
    clerkAudience: ['language-drill'],
    alarmTopic,
  });
  return Template.fromStack(stack);
}

describe('ApiGatewayConstruct observability', () => {
  const template = buildStack();

  describe('access logging', () => {
    it('creates a dedicated access log group with a finite retention', () => {
      // Unbounded retention on a log group that receives every request —
      // including scan traffic — is an open-ended cost. One month matches
      // LambdaConstruct's explicit group.
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        RetentionInDays: 30,
      });
    });

    it('enables access logging on the default stage', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
        StageName: '$default',
        AccessLogSettings: {
          DestinationArn: Match.anyValue(),
          Format: Match.anyValue(),
        },
      });
    });

    it('logs the fields needed to tell an authorizer 401 from a route 404', () => {
      // The whole point of turning access logs on. `status` alone cannot
      // distinguish them, and without `routeKey`/`path`/`ip` there is no way
      // to tell a scanner from a real user failing auth.
      const stages = template.findResources('AWS::ApiGatewayV2::Stage');
      const stage = Object.values(stages).find(
        (s) => s.Properties?.StageName === '$default',
      );
      expect(stage).toBeDefined();
      const format: string = stage!.Properties.AccessLogSettings.Format;
      for (const field of [
        '$context.status',
        '$context.routeKey',
        '$context.path',
        '$context.identity.sourceIp',
        '$context.requestId',
        '$context.error.message',
      ]) {
        expect(format).toContain(field);
      }
    });

    it('emits the access log as one JSON object per request', () => {
      // Logs Insights can only parse fields out of a structured line; the
      // CLF-style default format would make the 401-vs-404 question a regex
      // exercise.
      //
      // `$context.error.messageString` is deliberately the one UNQUOTED value
      // in the template — it expands to an already-quoted, already-escaped
      // string, which is what keeps a message containing a double quote from
      // emitting a line Insights cannot parse. Substituting a quoted
      // placeholder here reproduces what the gateway actually writes.
      const stages = template.findResources('AWS::ApiGatewayV2::Stage');
      const stage = Object.values(stages).find(
        (s) => s.Properties?.StageName === '$default',
      );
      const format: string = stage!.Properties.AccessLogSettings.Format;
      expect(format).toContain('$context.error.messageString');
      const expanded = format.replace(
        '$context.error.messageString',
        '"a \\" quote"',
      );
      expect(() => JSON.parse(expanded)).not.toThrow();
    });
  });

  describe('gateway alarms', () => {
    it('alarms on a 4xx spike against the AWS/ApiGateway namespace', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        Namespace: 'AWS/ApiGateway',
        MetricName: '4xx',
        Statistic: 'Sum',
      });
    });

    it('alarms on any gateway 5xx', () => {
      // 5xx has been flat zero; it is also the signal that the integration
      // itself is failing, which no Lambda-side alarm reports (a caught Hono
      // throw returns 500 while leaving the Lambda Errors metric at 0).
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        Namespace: 'AWS/ApiGateway',
        MetricName: '5xx',
        Statistic: 'Sum',
      });
    });

    it('scopes both alarms to this API, not every API in the account', () => {
      const alarms = Object.values(
        template.findResources('AWS::CloudWatch::Alarm'),
      ).filter((a) => a.Properties?.Namespace === 'AWS/ApiGateway');
      expect(alarms).toHaveLength(2);
      for (const alarm of alarms) {
        // Exactly one dimension, and it must resolve to THIS api's id — an
        // undimensioned AWS/ApiGateway alarm aggregates every API in the
        // account, so prod and dev would alarm on each other's traffic.
        expect(alarm.Properties.Dimensions).toHaveLength(1);
        expect(alarm.Properties.Dimensions[0].Name).toBe('ApiId');
        expect(alarm.Properties.Dimensions[0].Value).toEqual({
          Ref: expect.stringContaining('HttpApi'),
        });
      }
    });

    it('sets the 4xx threshold above the observed background scan rate', () => {
      // Prod sees a steady ~85-91 rejected requests/day from scanners. An
      // alarm that fires on those is an alarm that gets muted, so the
      // threshold has to sit above a routine sweep while still catching the
      // 437-in-one-hour burst seen on 2026-09-26.
      const alarm = Object.values(
        template.findResources('AWS::CloudWatch::Alarm'),
      ).find((a) => a.Properties?.MetricName === '4xx');
      expect(alarm!.Properties.Threshold).toBeGreaterThanOrEqual(100);
    });

    it('does not alarm on missing data', () => {
      // Traffic is bursty and low-volume; most 5-minute windows are empty.
      const alarms = Object.values(
        template.findResources('AWS::CloudWatch::Alarm'),
      ).filter((a) => a.Properties?.Namespace === 'AWS/ApiGateway');
      expect(alarms).toHaveLength(2);
      for (const alarm of alarms) {
        expect(alarm.Properties.TreatMissingData).toBe('notBreaching');
      }
    });
  });

  describe('when an alarm topic is supplied', () => {
    it('wires both gateway alarms to it', () => {
      const withTopic = (() => {
        const app = new App();
        const stack = new Stack(app, 'TopicStack');
        const topic = new sns.Topic(stack, 'Alerts');
        const handler = new lambda.Function(stack, 'Handler', {
          runtime: lambda.Runtime.NODEJS_22_X,
          handler: 'index.handler',
          code: lambda.Code.fromInline('exports.handler = async () => {};'),
        });
        new ApiGatewayConstruct(stack, 'ApiGateway', {
          handler,
          apiName: 'language-drill-api-test',
          clerkIssuerUrl: 'https://clerk.example.com',
          clerkAudience: ['language-drill'],
          alarmTopic: topic,
        });
        return Template.fromStack(stack);
      })();

      const alarms = Object.values(
        withTopic.findResources('AWS::CloudWatch::Alarm'),
      ).filter((a) => a.Properties?.Namespace === 'AWS/ApiGateway');
      expect(alarms).toHaveLength(2);
      for (const alarm of alarms) {
        expect(alarm.Properties.AlarmActions).toHaveLength(1);
      }
    });
  });

  describe('when no alarm topic is supplied', () => {
    it('leaves the gateway alarms console-only', () => {
      // Matches every other construct: omitting the topic must not fail
      // synth, so unit tests can build the construct standalone.
      const alarms = Object.values(
        template.findResources('AWS::CloudWatch::Alarm'),
      ).filter((a) => a.Properties?.Namespace === 'AWS/ApiGateway');
      expect(alarms).toHaveLength(2);
      for (const alarm of alarms) {
        expect(alarm.Properties.AlarmActions).toBeUndefined();
      }
    });
  });
});
