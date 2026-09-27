import { CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  ApiMapping,
  CfnStage,
  DomainName,
  HttpApi,
  HttpMethod,
  HttpNoneAuthorizer,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwactions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";

/**
 * Access log format, one JSON object per request.
 *
 * `$context.error.responseType` is the field that earns this log its keep: it
 * names *why* the gateway rejected a request (`UNAUTHORIZED`, `ACCESS_DENIED`,
 * `NOT_FOUND`, …), which the `4xx` metric alone cannot. A rejected request
 * never reaches the Lambda, so this file is the only record it happened.
 *
 * `errorMessage` uses `$context.error.messageString` — the pre-quoted variant —
 * so a message containing a double quote cannot produce a log line Logs
 * Insights refuses to parse. That is also why it is the one value here without
 * surrounding quotes in the template.
 */
const ACCESS_LOG_FORMAT = JSON.stringify(
  {
    requestId: "$context.requestId",
    requestTime: "$context.requestTime",
    ip: "$context.identity.sourceIp",
    userAgent: "$context.identity.userAgent",
    httpMethod: "$context.httpMethod",
    path: "$context.path",
    routeKey: "$context.routeKey",
    status: "$context.status",
    protocol: "$context.protocol",
    responseLength: "$context.responseLength",
    responseLatency: "$context.responseLatency",
    errorResponseType: "$context.error.responseType",
    errorMessage: "__ERROR_MESSAGE_STRING__",
    integrationStatus: "$context.integrationStatus",
    integrationErrorMessage: "$context.integrationErrorMessage",
    jwtSub: "$context.authorizer.claims.sub",
  },
  null,
  0,
).replace('"__ERROR_MESSAGE_STRING__"', "$context.error.messageString");

/**
 * 4xx alarm threshold, per `ALARM_PERIOD`.
 *
 * Prod carries a steady background of unauthenticated scan traffic — measured
 * 2026-09-19/26 at ~85-91 rejected requests/day, arriving as a single sweep
 * inside one hour. An alarm that fires on those is an alarm that gets muted,
 * so the threshold sits at roughly 2x a routine sweep: quiet for the
 * background, but tripped by the 437-request burst seen on 2026-09-26.
 */
const CLIENT_ERROR_THRESHOLD = 200;
const ALARM_PERIOD = Duration.hours(1);

export interface ApiGatewayConstructProps {
  handler: IFunction;
  apiName: string;
  clerkIssuerUrl: string;
  clerkAudience: string[];
  apiDomainName?: string;
  /**
   * Shared SNS topic for alarm actions. Omitting it leaves the gateway alarms
   * console-only, matching every other construct in the stack (and keeping
   * standalone unit tests buildable).
   */
  alarmTopic?: sns.ITopic;
}

export class ApiGatewayConstruct extends Construct {
  public readonly httpApi: HttpApi;

  constructor(scope: Construct, id: string, props: ApiGatewayConstructProps) {
    super(scope, id);

    const authorizer = new HttpJwtAuthorizer(
      "ClerkJwtAuthorizer",
      props.clerkIssuerUrl,
      {
        jwtAudience: props.clerkAudience,
      }
    );

    this.httpApi = new HttpApi(this, "HttpApi", {
      apiName: props.apiName,
    });

    const lambdaIntegration = new HttpLambdaIntegration(
      "LambdaIntegration",
      props.handler
    );

    this.httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [
        HttpMethod.GET,
        HttpMethod.POST,
        HttpMethod.PUT,
        HttpMethod.PATCH,
        HttpMethod.DELETE,
      ],
      integration: lambdaIntegration,
      authorizer,
    });

    this.httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [HttpMethod.OPTIONS],
      integration: lambdaIntegration,
    });

    this.httpApi.addRoutes({
      path: "/webhooks/clerk",
      methods: [HttpMethod.POST],
      integration: lambdaIntegration,
    });

    // Public email routes — no JWT authorizer. More-specific paths take
    // precedence over /{proxy+}, so these are unauthenticated in production.
    this.httpApi.addRoutes({
      path: "/email/confirm",
      methods: [HttpMethod.GET],
      integration: lambdaIntegration,
    });

    this.httpApi.addRoutes({
      path: "/email/unsubscribe",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: lambdaIntegration,
    });

    this.addAccessLogging();
    this.addGatewayAlarms(props.alarmTopic);

    if (props.apiDomainName) {
      const certificate = new acm.Certificate(this, "ApiCertificate", {
        domainName: props.apiDomainName,
        validation: acm.CertificateValidation.fromDns(),
      });

      const domain = new DomainName(this, "ApiDomain", {
        domainName: props.apiDomainName,
        certificate,
      });

      new ApiMapping(this, "ApiMapping", {
        api: this.httpApi,
        domainName: domain,
      });

      new CfnOutput(this, "ApiDomainTarget", {
        value: domain.regionalDomainName,
        description: `Add a CNAME in Cloudflare: ${props.apiDomainName} → this value`,
      });
    }
  }

  /**
   * Access logging on the auto-created `$default` stage.
   *
   * The JWT authorizer rejects unauthenticated requests *before* the Lambda
   * runs, so they emit no Lambda metric and write nothing to the handler's log
   * group. Without this, a rejected request leaves no trace beyond an
   * anonymous tick on the `4xx` metric — no path, no source IP, and no way to
   * tell an expired session from a scanner probing for `/wp-login.php`.
   *
   * `HttpApi` builds the default stage itself and its L2 exposes no access-log
   * setting, so this reaches through to the underlying `CfnStage`.
   */
  private addAccessLogging(): void {
    const accessLogs = new logs.LogGroup(this, "AccessLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const defaultStage = this.httpApi.defaultStage?.node
      .defaultChild as CfnStage;
    defaultStage.accessLogSettings = {
      destinationArn: accessLogs.logGroupArn,
      format: ACCESS_LOG_FORMAT,
    };
  }

  /**
   * Gateway-level alarms.
   *
   * Every other alarm in the stack watches `AWS/Lambda Errors`, SQS DLQ depth,
   * or a custom `LanguageDrill/*` metric emitted from inside a Lambda. None of
   * those can see a request the gateway rejects on its own: on 2026-09-23 and
   * 09-24 *every* prod request was a 4xx with zero Lambda invocations, and
   * nothing fired. These two alarms are the only watch on that layer.
   */
  private addGatewayAlarms(alarmTopic?: sns.ITopic): void {
    const clientErrors = new cloudwatch.Alarm(this, "ClientErrorAlarm", {
      metric: this.httpApi.metricClientError({ period: ALARM_PERIOD }),
      threshold: CLIENT_ERROR_THRESHOLD,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        `API Gateway returned >= ${CLIENT_ERROR_THRESHOLD} 4xx responses in an hour. ` +
        "These are rejected before the Lambda runs, so they appear in NO Lambda " +
        "log or metric. Read the AccessLogs group and group by errorResponseType " +
        "to tell authorizer 401s (expired sessions) from 404s (scanning).",
    });

    // 5xx has been flat zero, and it is the one signal that the integration
    // itself is failing. Note a caught Hono throw returns a 500 through the
    // gateway while leaving the Lambda `Errors` metric at 0 — so the Lambda
    // errors alarm does NOT cover this.
    const serverErrors = new cloudwatch.Alarm(this, "ServerErrorAlarm", {
      metric: this.httpApi.metricServerError({ period: ALARM_PERIOD }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        "API Gateway returned a 5xx. Includes caught Hono throws, which leave " +
        "the Lambda Errors metric at 0 — check the explicit LambdaLogGroup, not " +
        "the Lambda Errors alarm.",
    });

    if (alarmTopic) {
      const action = new cwactions.SnsAction(alarmTopic);
      clientErrors.addAlarmAction(action);
      serverErrors.addAlarmAction(action);
    }
  }
}
