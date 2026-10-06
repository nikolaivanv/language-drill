import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import {
  EVAL_SUBMIT_TIMEOUT_SECONDS,
  EvalSubmitLambdaConstruct,
} from "./eval-submit-lambda";

/**
 * Pin the eval-submit Function URL's shape. The timeout is the whole point of
 * this construct: it must stay well above API Gateway's 30s integration cap,
 * or free-writing evaluations (~50s) time out exactly as they did behind it.
 */
function buildStack(): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  new EvalSubmitLambdaConstruct(stack, "EvalSubmit", {
    secretsPrefix: "language-drill-dev",
    additionalEnv: { ALLOWED_ORIGINS: "https://langdrill.app" },
  });
  return Template.fromStack(stack);
}

describe("EvalSubmitLambdaConstruct", () => {
  const template = buildStack();

  it("gives the Lambda a timeout far beyond API Gateway's 30s cap", () => {
    expect(EVAL_SUBMIT_TIMEOUT_SECONDS).toBeGreaterThanOrEqual(120);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Timeout: EVAL_SUBMIT_TIMEOUT_SECONDS,
      ReservedConcurrentExecutions: 10,
    });
  });

  it("exposes a BUFFERED, AuthType NONE Function URL with no platform CORS", () => {
    template.hasResourceProperties("AWS::Lambda::Url", {
      AuthType: "NONE",
      InvokeMode: "BUFFERED",
      // CORS is answered by Hono with exact origin matching; a platform Cors
      // block would answer preflights itself with its own (coarser) policy.
      Cors: Match.absent(),
    });
  });

  it("passes caller env through alongside the secrets", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          ALLOWED_ORIGINS: "https://langdrill.app",
          LANGFUSE_ENV: "dev",
          DATABASE_URL: Match.anyValue(),
          CLERK_SECRET_KEY: Match.anyValue(),
          ANTHROPIC_API_KEY: Match.anyValue(),
        }),
      },
    });
  });

  it("alarms on Lambda errors and on invocation floods", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Errors",
      Threshold: 1,
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Invocations",
      Threshold: 300,
    });
  });
});
