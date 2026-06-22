import { Construct } from "constructs";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as path from "path";

import { addPromptFallbackAlarm } from "./prompt-fallback-alarm";
import { addAiFailureAlarm } from "./ai-failure-alarm";

export interface LambdaConstructProps {
  secretsPrefix: string;
  additionalEnv?: Record<string, string>;
  /** Optional SNS topic for the prompt-fallback alarm (audit §3.2). */
  alarmTopic?: sns.ITopic;
}

export class LambdaConstruct extends Construct {
  public readonly handler: lambda.NodejsFunction;
  public readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: LambdaConstructProps) {
    super(scope, id);

    // Explicit log group with a finite retention (audit §4.2). Without this the
    // default log group never expires — unbounded CloudWatch storage cost on
    // the busiest, CLAUDE.md-designated API error inbox. The handle also backs
    // the prompt-fallback metric filter below.
    this.logGroup = new logs.LogGroup(this, "LogGroup", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const databaseUrl = secretsmanager.Secret.fromSecretNameV2(
      this,
      "DatabaseUrl",
      `${props.secretsPrefix}/DATABASE_URL`
    );
    const clerkSecretKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ClerkSecretKey",
      `${props.secretsPrefix}/CLERK_SECRET_KEY`
    );
    const clerkWebhookSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ClerkWebhookSecret",
      `${props.secretsPrefix}/CLERK_WEBHOOK_SECRET`
    );
    const anthropicApiKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AnthropicApiKey",
      `${props.secretsPrefix}/ANTHROPIC_API_KEY`
    );
    const upstashRedisRestUrl = secretsmanager.Secret.fromSecretNameV2(
      this,
      "UpstashRedisRestUrl",
      `${props.secretsPrefix}/UPSTASH_REDIS_REST_URL`
    );
    const upstashRedisRestToken = secretsmanager.Secret.fromSecretNameV2(
      this,
      "UpstashRedisRestToken",
      `${props.secretsPrefix}/UPSTASH_REDIS_REST_TOKEN`
    );
    const langfusePublicKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "LangfusePublicKey",
      `${props.secretsPrefix}/LANGFUSE_PUBLIC_KEY`
    );
    const langfuseSecretKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "LangfuseSecretKey",
      `${props.secretsPrefix}/LANGFUSE_SECRET_KEY`
    );
    // The API Lambda sends the opt-in confirmation email on toggle-on
    // (POST /email/preferences), so it needs the Resend API key.
    const resendApiKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ResendApiKey",
      `${props.secretsPrefix}/RESEND_API_KEY`
    );

    const projectRoot = path.join(__dirname, "../../..");

    this.handler = new lambda.NodejsFunction(this, "Handler", {
      entry: path.join(__dirname, "../../lambda/src/index.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      // 29 s is the max API Gateway HTTP API will wait for an integration.
      // Claude tool-use calls in /read/annotate and /exercises/:id/submit can
      // exceed 15 s with cold containers + cross-region DB round-trips.
      timeout: Duration.seconds(29),
      memorySize: 512,
      logGroup: this.logGroup,
      depsLockFilePath: path.join(projectRoot, "pnpm-lock.yaml"),
      bundling: {
        minify: true,
        sourceMap: true,
        esbuildArgs: {
          "--alias:@language-drill/shared": path.join(
            projectRoot,
            "packages/shared/src/index.ts"
          ),
          "--alias:@language-drill/db": path.join(
            projectRoot,
            "packages/db/src/index.ts"
          ),
          "--alias:@language-drill/ai": path.join(
            projectRoot,
            "packages/ai/src/index.ts"
          ),
          // The API Lambda imports the email package (routes/email.ts sends the
          // opt-in confirmation email). Alias to src like the others so esbuild
          // never needs a built packages/email/dist (which doesn't exist on the
          // CDK-deploy CI runner — only a local build produces it).
          "--alias:@language-drill/email": path.join(
            projectRoot,
            "packages/email/src/index.ts"
          ),
        },
      },
      // additionalEnv is spread first so secret-derived vars below cannot be overridden by callers.
      environment: {
        ...(props.additionalEnv ?? {}),
        DATABASE_URL: databaseUrl.secretValue.unsafeUnwrap(),
        CLERK_SECRET_KEY: clerkSecretKey.secretValue.unsafeUnwrap(),
        CLERK_WEBHOOK_SECRET: clerkWebhookSecret.secretValue.unsafeUnwrap(),
        ANTHROPIC_API_KEY: anthropicApiKey.secretValue.unsafeUnwrap(),
        UPSTASH_REDIS_REST_URL: upstashRedisRestUrl.secretValue.unsafeUnwrap(),
        UPSTASH_REDIS_REST_TOKEN:
          upstashRedisRestToken.secretValue.unsafeUnwrap(),
        LANGFUSE_PUBLIC_KEY: langfusePublicKey.secretValue.unsafeUnwrap(),
        LANGFUSE_SECRET_KEY: langfuseSecretKey.secretValue.unsafeUnwrap(),
        RESEND_API_KEY: resendApiKey.secretValue.unsafeUnwrap(),
        // Non-secret derived from `secretsPrefix` — single source of truth
        // for "are we prod or dev?" so trace `env` tags stay consistent
        // without scattering stack-name checks across handlers
        // (design.md §Component 3).
        LANGFUSE_ENV:
          props.secretsPrefix === "language-drill" ? "prod" : "dev",
        // Phase 5 — plain env var (not a secret); flows from stack.ts via
        // additionalEnv. Defaults to empty so the env key is always present
        // and the admin middleware can fail closed without a redeploy.
        ADMIN_USER_IDS: props.additionalEnv?.ADMIN_USER_IDS ?? "",
      },
    });

    databaseUrl.grantRead(this.handler);
    clerkSecretKey.grantRead(this.handler);
    clerkWebhookSecret.grantRead(this.handler);
    anthropicApiKey.grantRead(this.handler);
    upstashRedisRestUrl.grantRead(this.handler);
    upstashRedisRestToken.grantRead(this.handler);
    langfusePublicKey.grantRead(this.handler);
    langfuseSecretKey.grantRead(this.handler);
    resendApiKey.grantRead(this.handler);

    // Audit §3.2 — alarm when the API runtime serves a non-keys_unset Langfuse
    // prompt fallback (timeout / fetch_error).
    addPromptFallbackAlarm(this, "ApiPromptFallbackAlarm", {
      logGroup: this.logGroup,
      env: props.secretsPrefix === "language-drill" ? "prod" : "dev",
      surface: "api",
      alarmTopic: props.alarmTopic,
    });

    // Alarm on sustained caught AI-call failures (eval / reading / writing
    // helpers) — these return 502 but the invocation succeeds, so the runtime
    // Errors metric never sees them.
    // Two NON-OVERLAPPING substrings cover all four caught AI-call failure
    // lines without double-counting: "Claude evaluation failed:" (submit/eval)
    // and " generation failed:" (reading `Reading generation failed:` + the
    // writing-helper trio `[brainstorm]/[vocab-boost]/[start-my-paragraph]
    // generation failed:`).
    addAiFailureAlarm(this, "ApiAiFailureAlarm", {
      logGroup: this.logGroup,
      env: props.secretsPrefix === "language-drill" ? "prod" : "dev",
      surface: "api",
      patterns: ["Claude evaluation failed:", " generation failed:"],
      alarmDescription:
        "API Lambda: >= 5 caught AI-call failures (eval / reading / writing-helper " +
        "502 AI_UNAVAILABLE) in 5 minutes — Anthropic outage, usage-limit, or a " +
        "systemic prompt/parse bug. These do not move the Lambda Errors metric.",
      alarmTopic: props.alarmTopic,
    });
  }
}
