import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { AnnotateStreamLambdaConstruct } from "./annotate-stream-lambda";

/**
 * Pin the AnnotateStreamLambdaConstruct's CFN output shape:
 *  - Lambda function with timeout=29s, memorySize=512.
 *  - AWS::Lambda::Url resource with InvokeMode=RESPONSE_STREAM, AuthType=NONE.
 *  - CORS allow-list includes `https://*.vercel.app` (the shared
 *    `FALLBACK_ORIGINS` list from `@language-drill/shared/cors`).
 *
 * The 29s timeout is non-arbitrary — it pre-empts the CloudFront 30s idle-drop
 * that would otherwise cut a slow Claude stream from below. The snapshot test
 * is the only place that contract is enforced in CI.
 */
function buildStack(): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  new AnnotateStreamLambdaConstruct(stack, "AnnotateStream", {
    secretsPrefix: "language-drill-dev",
  });
  return Template.fromStack(stack);
}

describe("AnnotateStreamLambdaConstruct", () => {
  const template = buildStack();

  it("creates the streaming Lambda with timeout=29 and memorySize=512", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs20.x",
      Timeout: 29,
      MemorySize: 512,
    });
  });

  it("creates an AWS::Lambda::Url with RESPONSE_STREAM invoke mode and AuthType NONE", () => {
    template.hasResourceProperties("AWS::Lambda::Url", {
      AuthType: "NONE",
      InvokeMode: "RESPONSE_STREAM",
    });
  });

  it("CORS allows all origins (per-origin matching is a follow-up — see tech-debt.md)", () => {
    // AWS Lambda Function URL CORS doesn't support subdomain wildcards
    // (`https://*.vercel.app`) — only full URLs, `https://*`, or `*`.
    // Using `*` here pending the planned in-handler matchOrigin migration.
    template.hasResourceProperties("AWS::Lambda::Url", {
      Cors: Match.objectLike({
        AllowOrigins: ["*"],
        AllowMethods: Match.arrayWith(["POST"]),
        AllowHeaders: Match.arrayWith(["Authorization", "Content-Type"]),
      }),
    });
  });

  it("IAM policies grant the three secrets the streaming handler needs and only those", () => {
    const policies = template.findResources("AWS::IAM::Policy");
    const serialized = JSON.stringify(policies);

    expect(serialized).toContain("/DATABASE_URL");
    expect(serialized).toContain("/CLERK_SECRET_KEY");
    expect(serialized).toContain("/ANTHROPIC_API_KEY");

    // The streaming Lambda does not read Upstash (no rate-limit token bucket
    // on this path), nor the Clerk webhook secret (no SVIX verification).
    expect(serialized).not.toContain("/UPSTASH_REDIS_REST_URL");
    expect(serialized).not.toContain("/UPSTASH_REDIS_REST_TOKEN");
    expect(serialized).not.toContain("/CLERK_WEBHOOK_SECRET");
  });
});
