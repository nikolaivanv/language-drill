import { Construct } from "constructs";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwactions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import {
  FunctionUrl,
  FunctionUrlAuthType,
  HttpMethod,
  InvokeMode,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import * as path from "path";

import { addPromptFallbackAlarm } from "./prompt-fallback-alarm";

/**
 * Streaming-annotate Lambda + Function URL.
 *
 * Lives behind its own Lambda Function URL (NOT API Gateway) because the
 * response is Server-Sent Events — API Gateway HTTP API buffers Lambda
 * integrations and would defeat the streaming UX. The Function URL has
 * `InvokeMode.RESPONSE_STREAM` so the runtime forwards each `responseStream.write`
 * to the client as it lands. JWT verification happens inside the handler
 * via `@clerk/backend` (the Function URL itself uses `AuthType: NONE`).
 *
 * Secrets / IAM / esbuild aliases mirror `LambdaConstruct` so the two
 * Lambdas stay deployable from the same pnpm-managed monorepo.
 */
export interface AnnotateStreamLambdaConstructProps {
  secretsPrefix: string;
  additionalEnv?: Record<string, string>;
  /**
   * Reserved concurrency cap (audit §1.2). The Function URL is
   * `AuthType.NONE`, so anyone with the URL can invoke it; the in-handler JWT
   * check rejects unauthorized calls, but each rejection is still a billed
   * invocation. Without a cap a flood could exhaust the account's unreserved
   * concurrency pool and starve the main API. Defaults to 10.
   */
  reservedConcurrency?: number;
  /** SNS topic for the invocation-flood + prompt-fallback alarms. */
  alarmTopic?: sns.ITopic;
}

export class AnnotateStreamLambdaConstruct extends Construct {
  public readonly handler: lambda.NodejsFunction;
  public readonly functionUrl: string;
  public readonly logGroup: logs.LogGroup;
  public readonly invocationAlarm: cloudwatch.Alarm;

  constructor(
    scope: Construct,
    id: string,
    props: AnnotateStreamLambdaConstructProps,
  ) {
    super(scope, id);

    // Finite log retention (audit §4.2) — this is the second-hottest, and
    // CLAUDE.md-relevant, log group. The handle also backs the prompt-fallback
    // metric filter below.
    this.logGroup = new logs.LogGroup(this, "LogGroup", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const databaseUrl = secretsmanager.Secret.fromSecretNameV2(
      this,
      "DatabaseUrl",
      `${props.secretsPrefix}/DATABASE_URL`,
    );
    const clerkSecretKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ClerkSecretKey",
      `${props.secretsPrefix}/CLERK_SECRET_KEY`,
    );
    const anthropicApiKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AnthropicApiKey",
      `${props.secretsPrefix}/ANTHROPIC_API_KEY`,
    );
    const langfusePublicKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "LangfusePublicKey",
      `${props.secretsPrefix}/LANGFUSE_PUBLIC_KEY`,
    );
    const langfuseSecretKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "LangfuseSecretKey",
      `${props.secretsPrefix}/LANGFUSE_SECRET_KEY`,
    );

    const projectRoot = path.join(__dirname, "../../..");

    this.handler = new lambda.NodejsFunction(this, "Handler", {
      entry: path.join(
        __dirname,
        "../../lambda/src/annotate-stream/handler.ts",
      ),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      // 29s is the Function URL's max useful timeout (CloudFront fronting
      // Function URLs drops idle connections at 30s). The pipeline targets
      // p95 ≤ 18s end-to-end, so 29s leaves headroom for slow Claude responses
      // without ever letting CloudFront cut the stream first.
      timeout: Duration.seconds(29),
      memorySize: 512,
      logGroup: this.logGroup,
      reservedConcurrentExecutions: props.reservedConcurrency ?? 10,
      depsLockFilePath: path.join(projectRoot, "pnpm-lock.yaml"),
      bundling: {
        minify: true,
        sourceMap: true,
        esbuildArgs: {
          "--alias:@language-drill/shared": path.join(
            projectRoot,
            "packages/shared/src/index.ts",
          ),
          "--alias:@language-drill/db": path.join(
            projectRoot,
            "packages/db/src/index.ts",
          ),
          "--alias:@language-drill/ai": path.join(
            projectRoot,
            "packages/ai/src/index.ts",
          ),
        },
      },
      environment: {
        ...(props.additionalEnv ?? {}),
        DATABASE_URL: databaseUrl.secretValue.unsafeUnwrap(),
        CLERK_SECRET_KEY: clerkSecretKey.secretValue.unsafeUnwrap(),
        ANTHROPIC_API_KEY: anthropicApiKey.secretValue.unsafeUnwrap(),
        LANGFUSE_PUBLIC_KEY: langfusePublicKey.secretValue.unsafeUnwrap(),
        LANGFUSE_SECRET_KEY: langfuseSecretKey.secretValue.unsafeUnwrap(),
        // Non-secret derived from `secretsPrefix` — single source of truth
        // for prod vs dev so trace `env` tags are consistent across all
        // three Lambda runtimes (design.md §Component 3).
        LANGFUSE_ENV:
          props.secretsPrefix === "language-drill" ? "prod" : "dev",
      },
    });

    databaseUrl.grantRead(this.handler);
    clerkSecretKey.grantRead(this.handler);
    anthropicApiKey.grantRead(this.handler);
    langfusePublicKey.grantRead(this.handler);
    langfuseSecretKey.grantRead(this.handler);

    const url = new FunctionUrl(this, "Url", {
      function: this.handler,
      authType: FunctionUrlAuthType.NONE,
      invokeMode: InvokeMode.RESPONSE_STREAM,
      cors: {
        // AWS Lambda Function URL CORS doesn't support subdomain wildcards
        // like `https://*.vercel.app` (unlike API Gateway HTTP API CORS,
        // which does). It accepts only full URLs, `https://*`, or `*`.
        // Using `*` here is acceptable because JWT verification + the daily
        // usage-event rate-limit are the real security boundary; browser
        // CORS is a politeness filter, not an authorization check. See
        // docs/tech-debt.md for the follow-up to implement per-origin
        // matching in the handler instead.
        allowedOrigins: ["*"],
        // Function URL CORS rejects `OPTIONS` in `AllowMethods` — only
        // [GET, PUT, HEAD, POST, PATCH, DELETE, *] are accepted. Preflight
        // is handled implicitly by the platform.
        allowedMethods: [HttpMethod.POST],
        allowedHeaders: ["Authorization", "Content-Type"],
        maxAge: Duration.hours(1),
      },
    });

    this.functionUrl = url.url;

    // Audit §1.2 — invocation-flood alarm on the unauthenticated Function URL.
    // Normal personal use is a handful of annotations per session; a sustained
    // burst (>1000 invocations/hour) signals someone hammering the open URL
    // (each rejected call is still billed). Heuristic threshold — tune as real
    // traffic establishes a baseline.
    this.invocationAlarm = new cloudwatch.Alarm(this, "InvocationFloodAlarm", {
      metric: this.handler.metricInvocations({
        period: Duration.hours(1),
        statistic: cloudwatch.Stats.SUM,
      }),
      threshold: 1000,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        "Streaming-annotate Function URL invoked >1000 times in an hour — possible flood of the unauthenticated URL (audit §1.2).",
    });
    if (props.alarmTopic) {
      this.invocationAlarm.addAlarmAction(
        new cwactions.SnsAction(props.alarmTopic),
      );
    }

    // Audit §3.2 — alarm when this runtime serves a non-keys_unset Langfuse
    // prompt fallback (the annotate path resolves prompts too).
    addPromptFallbackAlarm(this, "AnnotatePromptFallbackAlarm", {
      logGroup: this.logGroup,
      env: props.secretsPrefix === "language-drill" ? "prod" : "dev",
      surface: "annotate",
      alarmTopic: props.alarmTopic,
    });
  }
}
