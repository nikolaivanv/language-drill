import * as path from 'path';

import { Duration } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

/**
 * Phase 4 — daily refill scheduler Lambda for the generation pipeline.
 *
 * The Lambda is always created (so dev can invoke it manually for ad-hoc
 * exercise of the same code path); the EventBridge cron rule is gated on
 * `enableScheduledJobs`. Prod = true (daily 04:00 UTC fill); dev = false (no
 * recurring spend on a quiet branch). Both stacks ship the Lambda + IAM with
 * `sqs:SendMessages` to the generation queue.
 *
 * Minimum-privilege secrets: DATABASE_URL only — the scheduler reads counts
 * from `exercises` and posts SQS messages, but does not call Claude.
 */
export interface SchedulerLambdaConstructProps {
  queue: sqs.IQueue;
  secretsPrefix: string;
  enableScheduledJobs: boolean;
  /** Defaults to `events.Schedule.cron({ minute: '0', hour: '4' })` (04:00 UTC daily). */
  scheduleExpression?: events.Schedule;
  additionalEnv?: Record<string, string>;
}

export class SchedulerLambdaConstruct extends Construct {
  public readonly handler: lambda.NodejsFunction;
  public readonly rule?: events.Rule;

  constructor(
    scope: Construct,
    id: string,
    props: SchedulerLambdaConstructProps,
  ) {
    super(scope, id);

    const databaseUrl = secretsmanager.Secret.fromSecretNameV2(
      this,
      'DatabaseUrl',
      `${props.secretsPrefix}/DATABASE_URL`,
    );

    const projectRoot = path.join(__dirname, '../../..');

    this.handler = new lambda.NodejsFunction(this, 'Handler', {
      entry: path.join(__dirname, '../../lambda/src/generation/scheduler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      memorySize: 512,
      depsLockFilePath: path.join(projectRoot, 'pnpm-lock.yaml'),
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
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
        DATABASE_URL: databaseUrl.secretValue.unsafeUnwrap(),
        GENERATION_QUEUE_URL: props.queue.queueUrl,
      },
    });

    databaseUrl.grantRead(this.handler);
    props.queue.grantSendMessages(this.handler);

    if (props.enableScheduledJobs) {
      this.rule = new events.Rule(this, 'SchedulerRule', {
        schedule:
          props.scheduleExpression ??
          events.Schedule.cron({ minute: '0', hour: '4' }),
        targets: [new targets.LambdaFunction(this.handler)],
        description:
          'Phase 4: daily refill scheduler — walks the curriculum and enqueues under-target cells.',
      });
    }
  }
}
