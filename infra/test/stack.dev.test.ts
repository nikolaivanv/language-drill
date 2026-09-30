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
    operationalEmails: ["ops@example.com"],
    billingEmails: ["billing@example.com"],
    createCostMonitoring: false,
    enableApiClientErrorAlarm: false,
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
    operationalEmails: ["ops@example.com"],
    billingEmails: ["billing@example.com"],
    createCostMonitoring: true,
    enableApiClientErrorAlarm: true,
    // Mirrors the committed default in `bin/app.ts`: prod ships a free-tier
    // global AI cap, dev does not.
    aiGlobalDailyCap: "1500",
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

    // The dev stack runs ten application Lambdas: API, Generation (consumer),
    // Scheduler (exercise), AnnotateStream (SSE Function URL), TheoryGeneration
    // (consumer), TheoryScheduler, DictationAudio (Phase 2 audio-synth
    // consumer — has DATABASE_URL but no Anthropic/Langfuse secrets),
    // EmailDispatcher, EmailSender, and MasteryRebuild (nightly
    // user_grammar_mastery self-heal — DATABASE_URL only, no AI cost). CDK's
    // logRetention shortcut also synthesizes a maintenance Lambda on the same
    // runtime; filter by the presence of DATABASE_URL in env so this
    // assertion tracks application Lambdas only (the LogRetention provider
    // has no app env vars).
    const appFns = fns.filter(
      (f) => !!f.Properties.Environment?.Variables?.DATABASE_URL,
    );
    expect(appFns).toHaveLength(10);

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

  // Phase 4 wires two EventBridge rules when enableScheduledJobs=true: the
  // exercise scheduler (daily) and the theory scheduler (weekly Mondays).
  // The email pipeline adds a third: the weekly-summary dispatcher (Mon 08:00 UTC).
  // The mastery-rebuild pipeline adds a fourth: the nightly 03:00 UTC rebuild
  // of user_grammar_mastery.
  it("prod stack deploys exactly four EventBridge rules (exercise + theory + email + mastery-rebuild schedulers)", () => {
    prodTemplate.resourceCountIs("AWS::Events::Rule", 4);
  });

  // Regression: public email routes must have no JWT authorizer so that
  // confirm/unsubscribe links work without a Clerk token in the browser.
  it("GET /email/confirm is a public API Gateway route (no JWT authorizer)", () => {
    prodTemplate.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /email/confirm",
      AuthorizationType: "NONE",
    });
  });

  it("GET /email/unsubscribe is a public API Gateway route (no JWT authorizer)", () => {
    prodTemplate.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /email/unsubscribe",
      AuthorizationType: "NONE",
    });
  });

  it("POST /email/unsubscribe is a public API Gateway route (no JWT authorizer)", () => {
    prodTemplate.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /email/unsubscribe",
      AuthorizationType: "NONE",
    });
  });

  // Regression: the public drill surface must have no JWT authorizer. A
  // `{proxy+}` path under /public keeps future public routes free, and a
  // more-specific path takes precedence over the catch-all /{proxy+}.
  it("GET /public/{proxy+} is a public API Gateway route (no JWT authorizer)", () => {
    prodTemplate.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /public/{proxy+}",
      AuthorizationType: "NONE",
    });
  });

  it("OPTIONS /public/{proxy+} is a public API Gateway route (no JWT authorizer)", () => {
    prodTemplate.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "OPTIONS /public/{proxy+}",
      AuthorizationType: "NONE",
    });
  });

  // The free-tier global AI brake must reach BOTH Lambdas that can spend money
  // on Anthropic: the Hono API (POST /exercises/:id/submit) and the
  // annotate-stream Function URL. `checkGlobalCapacity` reads it from
  // `process.env`, so a Lambda missing the variable silently has no cap — and
  // the cap being silently absent is exactly the bug this guards (nothing in
  // `.github/workflows/` ever passed `AI_GLOBAL_DAILY_CAP`, so prod ran
  // uncapped from the day the feature shipped).
  it("propagates the free-tier AI daily cap to every AI-spending Lambda (prod)", () => {
    const lambdas = prodTemplate.findResources("AWS::Lambda::Function");
    const capped = Object.values(lambdas)
      .map(
        (f) =>
          (f as { Properties: { Environment?: { Variables?: Record<string, string> } } })
            .Properties.Environment?.Variables,
      )
      .filter((vars): vars is Record<string, string> => !!vars && "AI_GLOBAL_DAILY_CAP" in vars);

    // API handler + annotate-stream. If this count changes, a new AI-spending
    // Lambda was added and must be checked for the cap rather than silently
    // shifting the expectation.
    expect(capped).toHaveLength(2);
    for (const vars of capped) {
      expect(vars.AI_GLOBAL_DAILY_CAP).toBe("1500");
    }
  });

  // Dev has no real users, so it deliberately carries no cap — an empty string
  // means "no cap" to `checkGlobalCapacity` (it parses to NaN, which fails the
  // `> 0` check).
  it("leaves the AI daily cap unset on dev", () => {
    const lambdas = devTemplate.findResources("AWS::Lambda::Function");
    const values = Object.values(lambdas)
      .map(
        (f) =>
          (f as { Properties: { Environment?: { Variables?: Record<string, string> } } })
            .Properties.Environment?.Variables,
      )
      .filter((vars): vars is Record<string, string> => !!vars && "AI_GLOBAL_DAILY_CAP" in vars)
      .map((vars) => vars.AI_GLOBAL_DAILY_CAP);

    expect(values).toHaveLength(2);
    expect(new Set(values)).toEqual(new Set([""]));
  });
  // Regression: GET /public/{proxy+} has no JWT authorizer and no per-user rate
  // limit, so a stage route throttle is the only layer that rejects anonymous
  // traffic BEFORE the Lambda is invoked. It must bound only the public route —
  // authenticated routes share the same stage and must keep full capacity.
  it("GET /public/{proxy+} carries route-level throttling on the default stage", () => {
    prodTemplate.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      RouteSettings: {
        "GET /public/{proxy+}": {
          ThrottlingRateLimit: 20,
          ThrottlingBurstLimit: 50,
        },
      },
    });
  });

  // THE assertion that guards the outage. A RouteSettings key must name a route
  // that already exists; without an explicit DependsOn, CloudFormation updates
  // the stage first and API Gateway rejects it with
  // "Unable to find Route by key GET /public/{proxy+}" — which failed PR #740's
  // prod deploy, then failed the rollback, wedging the stack in
  // UPDATE_ROLLBACK_FAILED. Synth and snapshot both passed on that code, so this
  // ordering is the only thing a test can pin.
  it("orders the default stage AFTER the public routes it throttles", () => {
    const routes = prodTemplate.findResources("AWS::ApiGatewayV2::Route");
    const publicRouteIds = Object.entries(routes)
      .filter(([, r]) =>
        String(
          (r as { Properties: { RouteKey?: string } }).Properties.RouteKey ?? "",
        ).includes("/public/{proxy+}"),
      )
      .map(([logicalId]) => logicalId);

    // GET + OPTIONS.
    expect(publicRouteIds).toHaveLength(2);

    const stages = prodTemplate.findResources("AWS::ApiGatewayV2::Stage");
    const stageEntries = Object.values(stages) as { DependsOn?: string[] }[];
    expect(stageEntries).toHaveLength(1);
    const dependsOn = stageEntries[0]!.DependsOn ?? [];

    for (const routeId of publicRouteIds) {
      expect(dependsOn).toContain(routeId);
    }
  });
});
