import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { LambdaConstruct } from "./lambda";

/**
 * Pin the CFN shape of the API LambdaConstruct's secret + env-var wiring.
 *
 * The construct has no test file prior to Phase-1 Langfuse work — this file
 * was added by Task 20 to lock the Lambda environment + IAM grants for the
 * two new Langfuse secrets and the `LANGFUSE_ENV` derived value. Shape
 * follows `generation-lambda.test.ts` (same `Template.fromStack` /
 * `findResources` pattern, same `secretsPrefix: 'language-drill-dev'` test
 * fixture).
 */
function buildStack(): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  new LambdaConstruct(stack, "ApiLambda", {
    secretsPrefix: "language-drill-dev",
  });
  return Template.fromStack(stack);
}

describe("LambdaConstruct — Langfuse env + IAM (Req 8.1 / 8.2)", () => {
  const template = buildStack();

  it("Lambda Environment.Variables includes LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and LANGFUSE_ENV='dev'", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          LANGFUSE_PUBLIC_KEY: Match.anyValue(),
          LANGFUSE_SECRET_KEY: Match.anyValue(),
          // Non-secret derived from `secretsPrefix` — 'language-drill-dev'
          // ⇒ 'dev'. The prod-mapping is implicit in the construct logic
          // (`secretsPrefix === 'language-drill' ? 'prod' : 'dev'`).
          LANGFUSE_ENV: "dev",
        }),
      },
    });
  });

  it("IAM policies grant read on both Langfuse secrets (grantRead pattern)", () => {
    const policies = template.findResources("AWS::IAM::Policy");
    const serialized = JSON.stringify(policies);

    // Resource ARN format: `...:secret:language-drill-dev/LANGFUSE_PUBLIC_KEY-??????`
    expect(serialized).toContain("/LANGFUSE_PUBLIC_KEY");
    expect(serialized).toContain("/LANGFUSE_SECRET_KEY");

    // Existing API-Lambda secrets stay granted (minimum-privilege contract
    // is enforced separately by the prod CFN snapshot test).
    expect(serialized).toContain("/DATABASE_URL");
    expect(serialized).toContain("/CLERK_SECRET_KEY");
    expect(serialized).toContain("/CLERK_WEBHOOK_SECRET");
    expect(serialized).toContain("/ANTHROPIC_API_KEY");
    expect(serialized).toContain("/UPSTASH_REDIS_REST_URL");
    expect(serialized).toContain("/UPSTASH_REDIS_REST_TOKEN");
  });

  // Audit §4.2 — the API log group must have a finite retention (was: never
  // expire).
  it("creates an explicit log group with 1-month retention", () => {
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: 30,
    });
  });

  // Audit §3.2 — a metric filter on the non-keys_unset prompt-fallback warn
  // line, feeding an alarm.
  it("creates a prompt-fallback metric filter + alarm (env-namespaced)", () => {
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      MetricTransformations: Match.arrayWith([
        Match.objectLike({
          MetricName: "api-prompt-fallback",
          MetricNamespace: "LanguageDrill/dev",
        }),
      ]),
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "api-prompt-fallback",
      Namespace: "LanguageDrill/dev",
    });
  });

  it("creates an AI-failure metric filter + alarm (env-namespaced, threshold 5)", () => {
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      MetricTransformations: Match.arrayWith([
        Match.objectLike({
          MetricName: "api-ai-failure",
          MetricNamespace: "LanguageDrill/dev",
        }),
      ]),
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "api-ai-failure",
      Namespace: "LanguageDrill/dev",
      Threshold: 5,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
    });
  });
});
