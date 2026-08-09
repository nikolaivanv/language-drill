import * as path from 'path';
import { Duration } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface MasteryRebuildLambdaConstructProps {
  secretsPrefix: string;
  enableScheduledJobs: boolean;
  /** Deletes above this threshold abort the run without writing. Defaults to 5. */
  maxDeletes?: number;
  /** Defaults to daily 03:00 UTC. */
  scheduleExpression?: events.Schedule;
}

/**
 * Nightly mastery rebuild Lambda + optional EventBridge cron.
 *
 * The Lambda is always created so dev can invoke it manually; the cron rule
 * is gated on `enableScheduledJobs` (prod on, dev off). The rebuild replays
 * every learner's evidence and rewrites `user_grammar_mastery`, so stored
 * scores self-heal after an admin demotion revokes evidence — read-time
 * surfaces already re-derive per request, but the stored table does not.
 * DATABASE_URL only — no Claude, no cost beyond Postgres.
 */
export class MasteryRebuildLambdaConstruct extends Construct {
  public readonly handler: lambda.NodejsFunction;
  public readonly rule?: events.Rule;

  constructor(scope: Construct, id: string, props: MasteryRebuildLambdaConstructProps) {
    super(scope, id);

    const databaseUrl = secretsmanager.Secret.fromSecretNameV2(this, 'DatabaseUrl', `${props.secretsPrefix}/DATABASE_URL`);
    const projectRoot = path.join(__dirname, '../../..');

    this.handler = new lambda.NodejsFunction(this, 'Handler', {
      entry: path.join(__dirname, '../../lambda/src/mastery/rebuild-handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(300),
      memorySize: 512,
      depsLockFilePath: path.join(projectRoot, 'pnpm-lock.yaml'),
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
        esbuildArgs: {
          '--alias:@language-drill/shared': path.join(projectRoot, 'packages/shared/src/index.ts'),
          '--alias:@language-drill/db': path.join(projectRoot, 'packages/db/src/index.ts'),
          '--alias:@language-drill/ai': path.join(projectRoot, 'packages/ai/src/index.ts'),
          '--alias:@language-drill/email': path.join(projectRoot, 'packages/email/src/index.ts'),
        },
      },
      environment: {
        DATABASE_URL: databaseUrl.secretValue.unsafeUnwrap(),
        MASTERY_REBUILD_MAX_DELETES: String(props.maxDeletes ?? 5),
      },
    });

    databaseUrl.grantRead(this.handler);

    if (props.enableScheduledJobs) {
      this.rule = new events.Rule(this, 'MasteryRebuildRule', {
        schedule: props.scheduleExpression ?? events.Schedule.cron({ minute: '0', hour: '3' }),
        targets: [new targets.LambdaFunction(this.handler)],
        description: 'Nightly mastery rebuild — replays evidence so stored mastery self-heals after demotions.',
      });
    }
  }
}
