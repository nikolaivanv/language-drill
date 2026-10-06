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
  InvokeMode,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import * as path from "path";

import { addAiFailureAlarm } from "./ai-failure-alarm";
import { addPromptFallbackAlarm } from "./prompt-fallback-alarm";

/**
 * Lambda timeout for the eval-submit Function URL. Sized to the free-writing
 * evaluator's worst case: a 135s Claude request timeout × (1 attempt + 1 retry)
 * plus DB work (`FREE_WRITING_EVAL_REQUEST_TIMEOUT_MS` /
 * `FREE_WRITING_EVAL_MAX_RETRIES` in `@language-drill/ai`). A typical essay
 * evaluates in ~50s — already beyond API Gateway's 30s integration cap, which
 * is why this route lives on a Function URL at all.
 */
export const EVAL_SUBMIT_TIMEOUT_SECONDS = 300;

/**
 * Long-running answer-evaluation Lambda + Function URL.
 *
 * Serves only `POST /exercises/:id/submit` (the shared Hono exercises router,
 * see `infra/lambda/src/eval-submit/handler.ts`). The web routes free-writing
 * submits here because grading an essay outlives API Gateway's hard 30s
 * integration timeout; a Function URL is bounded only by the Lambda timeout.
 *
 * Differences from the annotate-stream Function URL:
 *  - `InvokeMode.BUFFERED` — the response is one JSON body, not SSE.
 *  - No Function URL CORS config: Hono answers CORS (preflight included) with
 *    the API's exact origin matching rather than `*`, and does so before the
 *    in-handler JWT check so even a 401 is readable by the browser.
 *
 * JWT verification happens in the handler (`AuthType: NONE`), so — as with
 * annotate-stream — reserved concurrency and an invocation-flood alarm bound
 * what an anonymous caller hammering the URL can cost.
 */
export interface EvalSubmitLambdaConstructProps {
  secretsPrefix: string;
  additionalEnv?: Record<string, string>;
  /** Reserved concurrency cap; see annotate-stream. Defaults to 10. */
  reservedConcurrency?: number;
  /** SNS topic for the flood / prompt-fallback / AI-failure alarms. */
  alarmTopic?: sns.ITopic;
}

export class EvalSubmitLambdaConstruct extends Construct {
  public readonly handler: lambda.NodejsFunction;
  public readonly functionUrl: string;
  public readonly logGroup: logs.LogGroup;
  public readonly invocationAlarm: cloudwatch.Alarm;

  constructor(
    scope: Construct,
    id: string,
    props: EvalSubmitLambdaConstructProps,
  ) {
    super(scope, id);

    this.logGroup = new logs.LogGroup(this, "LogGroup", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const secretNames = [
      ["DatabaseUrl", "DATABASE_URL"],
      ["ClerkSecretKey", "CLERK_SECRET_KEY"],
      ["AnthropicApiKey", "ANTHROPIC_API_KEY"],
      ["LangfusePublicKey", "LANGFUSE_PUBLIC_KEY"],
      ["LangfuseSecretKey", "LANGFUSE_SECRET_KEY"],
    ] as const;
    const secrets = secretNames.map(([constructId, name]) => ({
      name,
      secret: secretsmanager.Secret.fromSecretNameV2(
        this,
        constructId,
        `${props.secretsPrefix}/${name}`,
      ),
    }));

    const projectRoot = path.join(__dirname, "../../..");

    this.handler = new lambda.NodejsFunction(this, "Handler", {
      entry: path.join(__dirname, "../../lambda/src/eval-submit/handler.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(EVAL_SUBMIT_TIMEOUT_SECONDS),
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
      // additionalEnv is spread first so secret-derived vars cannot be overridden.
      environment: {
        ...(props.additionalEnv ?? {}),
        ...Object.fromEntries(
          secrets.map(({ name, secret }) => [
            name,
            secret.secretValue.unsafeUnwrap(),
          ]),
        ),
        LANGFUSE_ENV:
          props.secretsPrefix === "language-drill" ? "prod" : "dev",
      },
    });

    for (const { secret } of secrets) secret.grantRead(this.handler);

    const url = new FunctionUrl(this, "Url", {
      function: this.handler,
      authType: FunctionUrlAuthType.NONE,
      invokeMode: InvokeMode.BUFFERED,
    });
    this.functionUrl = url.url;

    // Normal use is a handful of essay submits per day; a sustained burst
    // signals someone hammering the open URL (each rejected call is billed).
    this.invocationAlarm = new cloudwatch.Alarm(this, "InvocationFloodAlarm", {
      metric: this.handler.metricInvocations({
        period: Duration.hours(1),
        statistic: cloudwatch.Stats.SUM,
      }),
      threshold: 300,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        "Eval-submit Function URL invoked >300 times in an hour — possible flood of the unauthenticated URL.",
    });
    if (props.alarmTopic) {
      this.invocationAlarm.addAlarmAction(
        new cwactions.SnsAction(props.alarmTopic),
      );
    }

    const env = props.secretsPrefix === "language-drill" ? "prod" : "dev";

    addPromptFallbackAlarm(this, "EvalSubmitPromptFallbackAlarm", {
      logGroup: this.logGroup,
      env,
      surface: "eval-submit",
      alarmTopic: props.alarmTopic,
    });

    // Same log line the API Lambda's AI-failure alarm matches — the submit
    // route is shared code, so its caught Claude failures land here now.
    addAiFailureAlarm(this, "EvalSubmitAiFailureAlarm", {
      logGroup: this.logGroup,
      env,
      surface: "eval-submit",
      patterns: ["Claude evaluation failed:"],
      alarmDescription:
        "Eval-submit Lambda: >= 5 caught Claude evaluation failures (502 " +
        "AI_UNAVAILABLE) in 5 minutes — Anthropic outage, usage-limit, or a " +
        "systemic prompt/parse bug. These do not move the Lambda Errors metric.",
      alarmTopic: props.alarmTopic,
    });

    // Unlike the API Lambda (whose 5xx alarm sits on API Gateway), nothing
    // else would surface a timeout or crash here: alarm on Lambda Errors.
    const errorsAlarm = new cloudwatch.Alarm(this, "ErrorsAlarm", {
      metric: this.handler.metricErrors({
        period: Duration.hours(1),
        statistic: cloudwatch.Stats.SUM,
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        "Eval-submit Lambda errored (timeout or uncaught throw) — a learner's " +
        "submit failed. Check the EvalSubmit log group.",
    });
    if (props.alarmTopic) {
      errorsAlarm.addAlarmAction(new cwactions.SnsAction(props.alarmTopic));
    }
  }
}
