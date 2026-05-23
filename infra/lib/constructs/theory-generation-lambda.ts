import * as path from 'path';

import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

/**
 * Phase 4 — SQS-consumer Lambda for the theory generation pipeline.
 *
 * Consumes one `TheoryGenerationJobMessage` per invocation (`BatchSize=1`
 * makes the partial-batch-failure mechanism trivial), runs the shared
 * `runOneTheoryCell` from `@language-drill/db`, and reports per-record
 * outcomes via `reportBatchItemFailures`. Reserved concurrency is capped at
 * 2 so the theory pipeline shares the Anthropic rate-limit budget with
 * exercise generation (3) and the live evaluator without exceeding the
 * Sonnet 4.6 org-tier ceiling.
 *
 * Minimum-privilege secrets: DATABASE_URL + ANTHROPIC_API_KEY only — no
 * Clerk, no Upstash. The theory generation Lambda has no end-user request
 * path.
 */
export interface TheoryGenerationLambdaConstructProps {
  queue: sqs.IQueue;
  secretsPrefix: string;
  /** Wired into `environment.ENV_NAME` — keys the handler's prod-cli guard (Req 2.3). */
  envName: 'prod' | 'dev';
  /** Caps cell-level parallelism. 2 in both stacks per Phase 4 plan §1.5. */
  reservedConcurrency: number;
  additionalEnv?: Record<string, string>;
}

export class TheoryGenerationLambdaConstruct extends Construct {
  public readonly handler: lambda.NodejsFunction;
  public readonly errorsAlarm: cloudwatch.Alarm;

  constructor(
    scope: Construct,
    id: string,
    props: TheoryGenerationLambdaConstructProps,
  ) {
    super(scope, id);

    const databaseUrl = secretsmanager.Secret.fromSecretNameV2(
      this,
      'DatabaseUrl',
      `${props.secretsPrefix}/DATABASE_URL`,
    );
    const anthropicApiKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      'AnthropicApiKey',
      `${props.secretsPrefix}/ANTHROPIC_API_KEY`,
    );
    // Required for the `withLlmTrace` wiring in
    // `infra/lambda/src/theory-generation/handler.ts` — without these env
    // vars `getLangfuse()` returns null and the Anthropic Proxy passes
    // through silently. The `language-drill/LANGFUSE_*` entries already
    // exist in both dev and prod Secrets Manager (used by the exercise
    // Lambda since Phase 1 Langfuse shipped).
    const langfusePublicKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      'TheoryLangfusePublicKey',
      `${props.secretsPrefix}/LANGFUSE_PUBLIC_KEY`,
    );
    const langfuseSecretKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      'TheoryLangfuseSecretKey',
      `${props.secretsPrefix}/LANGFUSE_SECRET_KEY`,
    );

    const projectRoot = path.join(__dirname, '../../..');

    this.handler = new lambda.NodejsFunction(this, 'Handler', {
      entry: path.join(
        __dirname,
        '../../lambda/src/theory-generation/handler.ts',
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      // 900 s is the AWS Lambda hard maximum. Matches the exercise-side
      // PR #71 fix from day 1: cells with retry storms can run several
      // hundred seconds, and `visibilityTimeout` on the queue is set to
      // the same value so SQS doesn't redeliver a still-running message.
      timeout: Duration.seconds(900),
      memorySize: 1024,
      reservedConcurrentExecutions: props.reservedConcurrency,
      depsLockFilePath: path.join(projectRoot, 'pnpm-lock.yaml'),
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        // The Lambda runtime ships AWS SDK v3; bundling it would double the
        // payload and cold-start latency.
        externalModules: ['@aws-sdk/*'],
        esbuildArgs: {
          '--alias:@language-drill/shared': path.join(
            projectRoot,
            'packages/shared/src/index.ts',
          ),
          '--alias:@language-drill/db': path.join(
            projectRoot,
            'packages/db/src/index.ts',
          ),
          '--alias:@language-drill/ai': path.join(
            projectRoot,
            'packages/ai/src/index.ts',
          ),
        },
      },
      environment: {
        ...(props.additionalEnv ?? {}),
        ENV_NAME: props.envName,
        DATABASE_URL: databaseUrl.secretValue.unsafeUnwrap(),
        ANTHROPIC_API_KEY: anthropicApiKey.secretValue.unsafeUnwrap(),
        LANGFUSE_PUBLIC_KEY: langfusePublicKey.secretValue.unsafeUnwrap(),
        LANGFUSE_SECRET_KEY: langfuseSecretKey.secretValue.unsafeUnwrap(),
        // Non-secret derived from `secretsPrefix` — single source of truth
        // for prod vs dev so trace `env` tags are consistent across the
        // exercise + theory + read-annotate Lambdas.
        LANGFUSE_ENV:
          props.secretsPrefix === 'language-drill' ? 'prod' : 'dev',
      },
    });

    databaseUrl.grantRead(this.handler);
    anthropicApiKey.grantRead(this.handler);
    langfusePublicKey.grantRead(this.handler);
    langfuseSecretKey.grantRead(this.handler);

    this.handler.addEventSource(
      new SqsEventSource(props.queue, {
        batchSize: 1,
        reportBatchItemFailures: true,
        // Match `reservedConcurrency` so the SQS poller never fetches more
        // messages than the Lambda can actually invoke on. Without this,
        // SQS pre-fetches up to its internal limit, holds the excess
        // "in-flight" until `visibilityTimeout` expires, releases them,
        // re-fetches, and after `maxReceiveCount` of those visibility-
        // expiry cycles silently DLQs the messages — even though the
        // Lambda never ran on them. The exercise-side PR #76 fix; theory
        // ships with it from day 1.
        maxConcurrency: props.reservedConcurrency,
      }),
    );

    this.errorsAlarm = new cloudwatch.Alarm(
      this,
      'TheoryGenerationErrorsAlarm',
      {
        metric: this.handler.metricErrors({
          period: Duration.days(1),
          statistic: cloudwatch.Stats.SUM,
        }),
        threshold: 5,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription:
          'Phase 4 (theory): theory generation Lambda recorded > 5 errors in a single day.',
      },
    );
  }
}
