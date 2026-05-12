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
    type LambdaResource = {
      Properties: {
        Runtime?: string;
        Environment?: { Variables?: Record<string, string> };
      };
    };

    const lambdas = devTemplate.findResources("AWS::Lambda::Function");
    const fns = Object.values(lambdas) as LambdaResource[];

    // Phase 4 added two application Lambdas (Generation + Scheduler);
    // more-responsive-reading adds one more (AnnotateStream behind a Function
    // URL). All four run on nodejs20.x. CDK's logRetention shortcut also
    // synthesizes a maintenance Lambda on a different runtime (currently
    // nodejs22.x); filter it out so this assertion tracks application
    // Lambdas only.
    const appFns = fns.filter((f) => f.Properties.Runtime === "nodejs20.x");
    expect(appFns).toHaveLength(4);

    // The API Lambda is the only one with CLERK_SECRET_KEY in its env — the
    // generation pipeline Lambdas have a strict minimum-privilege secrets set.
    const apiFn = appFns.find(
      (f) =>
        !!f.Properties.Environment?.Variables &&
        "CLERK_SECRET_KEY" in f.Properties.Environment.Variables,
    );
    expect(apiFn).toBeDefined();

    const apiVars = apiFn!.Properties.Environment!.Variables!;
    expect(apiVars.ENV_NAME).toBe("dev");
    expect(apiVars.ALLOWED_ORIGINS).toBe(
      "https://*.vercel.app,http://localhost:3000",
    );
  });

  // Dev stays at 0 EventBridge rules regardless of how many prod gets.
  it("does not deploy any EventBridge rules when enableScheduledJobs is false", () => {
    devTemplate.resourceCountIs("AWS::Events::Rule", 0);
  });

  // Phase 4 wires the SchedulerLambda's daily refill rule when enableScheduledJobs=true.
  it("prod stack deploys exactly one EventBridge rule (the Phase 4 scheduler refill)", () => {
    prodTemplate.resourceCountIs("AWS::Events::Rule", 1);
  });
});
