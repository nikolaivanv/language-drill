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
 *  1. Access logging on the default stage — the only record of a rejected
 *     request's path, source IP and user agent.
 *  2. A gateway 5xx alarm on both stacks, and a 4xx alarm on prod only.
 *
 * Note `errorResponseType` does NOT separate scanners from real users here:
 * every method routes through `/{proxy+}`, so any path matches a route and
 * fails at the authorizer, and `NOT_FOUND` essentially never appears. The
 * discriminator is `path` + `ip`.
 */
function buildStack(
  opts: { withTopic?: boolean; enableClientErrorAlarm?: boolean } = {},
): Template {
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
    alarmTopic: opts.withTopic ? new sns.Topic(stack, 'Alerts') : undefined,
    enableClientErrorAlarm: opts.enableClientErrorAlarm ?? true,
  });
  return Template.fromStack(stack);
}

/** Every AWS/ApiGateway alarm in a template, in no particular order. */
function gatewayAlarms(template: Template): Record<string, string>[] {
  return Object.values(template.findResources('AWS::CloudWatch::Alarm'))
    .filter((a) => a.Properties?.Namespace === 'AWS/ApiGateway')
    .map((a) => a.Properties);
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

    it('logs the fields needed to tell a scanner from a real user', () => {
      // The whole point of turning access logs on. `status` cannot do it
      // (both are 401) and neither can `errorResponseType` (both are
      // UNAUTHORIZED) — only `path` + `ip` + `userAgent` can.
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
      // CLF-style default format would make every triage query a regex
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
      // 437-in-one-hour burst seen on 2026-09-26. Still unproven against a
      // real prod auth failure — nothing has tripped it yet.
      const alarm = Object.values(
        template.findResources('AWS::CloudWatch::Alarm'),
      ).find((a) => a.Properties?.MetricName === '4xx');
      expect(alarm!.Properties.Threshold).toBeGreaterThanOrEqual(100);
    });

    it('tells the reader to triage by path and ip, not errorResponseType', () => {
      // The first version of this description said to group by
      // `errorResponseType` to tell authorizer 401s from 404 scanning. That is
      // wrong on this API: every method is routed through `/{proxy+}`, so ANY
      // path matches a route and fails at the authorizer. A scan for `/.env`
      // reports `UNAUTHORIZED` exactly like an expired session, and
      // `NOT_FOUND` essentially never appears. Confirmed 2026-09-28: 413
      // requests probing `/.env`, `/gcp-key.json`, `/actuator/*` — all 401.
      const alarm = gatewayAlarms(template).find(
        (a) => a.MetricName === '4xx',
      );
      expect(alarm!.AlarmDescription).toContain('path');
      expect(alarm!.AlarmDescription).toContain('ip');
      expect(alarm!.AlarmDescription).not.toContain('404');
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

  describe('when enableClientErrorAlarm=false (the dev stack)', () => {
    // A dev 4xx spike has no actionable reading: dev has essentially no
    // legitimate traffic, so it can never mean "users are failing auth" —
    // only "someone scanned us", which is constant background on any public
    // endpoint. The dev alarm fired within a day of shipping on a 412-request
    // credential sweep that reached nothing. An alarm that cries wolf gets
    // muted, and muting is not per-stack in practice — it costs you the prod
    // alarm too, which is the one with signal.
    const devTemplate = buildStack({ enableClientErrorAlarm: false });

    it('creates no 4xx alarm', () => {
      const alarms = gatewayAlarms(devTemplate);
      expect(alarms.map((a) => a.MetricName)).not.toContain('4xx');
    });

    it('still creates the 5xx alarm', () => {
      // A dev 5xx is a real bug signal — it means the integration itself is
      // failing — so this half is NOT gated.
      const alarms = gatewayAlarms(devTemplate);
      expect(alarms).toHaveLength(1);
      expect(alarms[0]!.MetricName).toBe('5xx');
    });

    it('still writes access logs', () => {
      // The 4xx alarm going away must not take the record with it: the log is
      // how the scan was identified in the first place, and how a future one
      // gets dismissed in two queries instead of an investigation.
      devTemplate.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
        StageName: '$default',
        AccessLogSettings: {
          DestinationArn: Match.anyValue(),
          Format: Match.anyValue(),
        },
      });
    });

    it('still wires the surviving alarm to the topic', () => {
      const alarms = gatewayAlarms(
        buildStack({ withTopic: true, enableClientErrorAlarm: false }),
      );
      expect(alarms).toHaveLength(1);
      expect(alarms[0]!.AlarmActions).toHaveLength(1);
    });
  });

  describe('when an alarm topic is supplied', () => {
    it('wires both gateway alarms to it', () => {
      const alarms = gatewayAlarms(buildStack({ withTopic: true }));
      expect(alarms).toHaveLength(2);
      for (const alarm of alarms) {
        expect(alarm.AlarmActions).toHaveLength(1);
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
