import { beforeAll, describe, expect, it } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { LanguageDrillStack } from "../lib/stack";

/**
 * Dev-stack assertion tests for LanguageDrillStack-dev.
 *
 * Locks in the dev-vs-prod boundary so future refactors cannot accidentally
 * cross it: dev IAM policies must reference only `language-drill-dev/*`
 * secrets, the API Gateway must carry the dev name, the stack must be tagged
 * `env=dev`, and the Lambda runtime environment must reflect the dev origins.
 *
 * Placeholder values mirror what `bin/app.ts` would pass at runtime — the
 * tests assert CFN shape, not deploy correctness.
 */

function buildDevStack() {
  const app = new App();
  return new LanguageDrillStack(app, "LanguageDrillStack-dev", {
    env: { account: "123456789012", region: "us-east-1" },
    envName: "dev",
    secretsPrefix: "language-drill-dev",
    apiName: "language-drill-api-dev",
    apiDomainName: "api-dev.langdrill.app",
    clerkIssuerUrl: "https://clerk-dev.example.com",
    clerkAudience: ["language-drill"],
    allowedOrigins: ["https://*.vercel.app", "http://localhost:3000"],
    enableScheduledJobs: false,
  });
}

function buildProdStack() {
  const app = new App();
  return new LanguageDrillStack(app, "LanguageDrillStack", {
    env: { account: "123456789012", region: "us-east-1" },
    envName: "prod",
    secretsPrefix: "language-drill",
    apiName: "language-drill-api",
    apiDomainName: "api.langdrill.app",
    clerkIssuerUrl: "https://clerk.langdrill.app",
    clerkAudience: ["language-drill"],
    allowedOrigins: [
      "https://*.vercel.app",
      "https://langdrill.app",
      "https://www.langdrill.app",
    ],
    enableScheduledJobs: true,
  });
}

// CDK synth runs esbuild bundling per stack instantiation (~1s on CI). Build
// each stack once and reuse the synthesized Template across all assertions in
// the describe block — cuts the suite from N synths to 2.
describe("LanguageDrillStack-dev", () => {
  let devStack: LanguageDrillStack;
  let devTemplate: Template;
  let prodTemplate: Template;

  beforeAll(() => {
    devStack = buildDevStack();
    devTemplate = Template.fromStack(devStack);
    prodTemplate = Template.fromStack(buildProdStack());
  });

  it("IAM policies reference only dev secrets (no prod leak)", () => {
    const policies = devTemplate.findResources("AWS::IAM::Policy");
    const serialized = JSON.stringify(policies);

    // Dev prefix flowed through to at least DATABASE_URL and CLERK_SECRET_KEY.
    expect(serialized).toContain("language-drill-dev/DATABASE_URL");
    expect(serialized).toContain("language-drill-dev/CLERK_SECRET_KEY");

    // No prod-prefixed secret name leaked into any policy statement.
    // Note: `language-drill-dev/` does not contain `language-drill/` as a
    // substring, so this assertion cleanly distinguishes the two prefixes.
    expect(serialized).not.toContain("language-drill/DATABASE_URL");
    expect(serialized).not.toContain("language-drill/CLERK_SECRET_KEY");
  });

  it("API Gateway is named language-drill-api-dev", () => {
    devTemplate.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      Name: "language-drill-api-dev",
    });
  });

  it("stack carries the env=dev tag", () => {
    // beforeAll already called Template.fromStack(devStack), which forces the
    // Tags.of(...) aspect to apply before stack.tags is queried.
    expect(devStack.tags.tagValues()).toEqual({ env: "dev" });
  });

  it("Lambda environment exposes ENV_NAME=dev and the dev ALLOWED_ORIGINS list", () => {
    const lambdas = devTemplate.findResources("AWS::Lambda::Function");
    const fns = Object.values(lambdas);
    expect(fns).toHaveLength(1);

    const fn = fns[0] as {
      Properties: { Environment: { Variables: Record<string, string> } };
    };
    expect(fn.Properties.Environment.Variables.ENV_NAME).toBe("dev");
    expect(fn.Properties.Environment.Variables.ALLOWED_ORIGINS).toBe(
      "https://*.vercel.app,http://localhost:3000",
    );
  });

  // Phase 1 contract: prod will eventually have N>0 EventBridge rules; dev
  // must stay at 0 regardless of how many prod gets.
  it("does not deploy any EventBridge rules when enableScheduledJobs is false", () => {
    devTemplate.resourceCountIs("AWS::Events::Rule", 0);
  });

  it("prod stack currently has zero EventBridge rules (Phase 1 will add them)", () => {
    prodTemplate.resourceCountIs("AWS::Events::Rule", 0);
  });
});
