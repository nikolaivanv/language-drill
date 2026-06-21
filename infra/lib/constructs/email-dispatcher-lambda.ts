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

export interface EmailDispatcherLambdaConstructProps {
  queue: sqs.IQueue;
  secretsPrefix: string;
  enableScheduledJobs: boolean;
  /** Defaults to Monday 08:00 UTC. */
  scheduleExpression?: events.Schedule;
}

/**
 * Weekly-summary email dispatcher Lambda + optional EventBridge cron.
 *
 * The Lambda is always created so dev can invoke it manually; the cron rule is
 * gated on `enableScheduledJobs` (prod on, dev off). The dispatcher reads
 * confirmed subscribers from the DB and fans out one SQS message per user to
 * the email queue. DATABASE_URL only — no Claude, no Resend.
 */
export class EmailDispatcherLambdaConstruct extends Construct {
  public readonly handler: lambda.NodejsFunction;
  public readonly rule?: events.Rule;

  constructor(scope: Construct, id: string, props: EmailDispatcherLambdaConstructProps) {
    super(scope, id);

    const databaseUrl = secretsmanager.Secret.fromSecretNameV2(this, 'DatabaseUrl', `${props.secretsPrefix}/DATABASE_URL`);
    const projectRoot = path.join(__dirname, '../../..');

    this.handler = new lambda.NodejsFunction(this, 'Handler', {
      entry: path.join(__dirname, '../../lambda/src/email/dispatcher.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(60),
      memorySize: 256,
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
        EMAIL_QUEUE_URL: props.queue.queueUrl,
      },
    });

    databaseUrl.grantRead(this.handler);
    props.queue.grantSendMessages(this.handler);

    if (props.enableScheduledJobs) {
      this.rule = new events.Rule(this, 'EmailDispatcherRule', {
        schedule: props.scheduleExpression ?? events.Schedule.cron({ minute: '0', hour: '8', weekDay: 'MON' }),
        targets: [new targets.LambdaFunction(this.handler)],
        description: 'Weekly summary email dispatcher — fans out per confirmed subscriber.',
      });
    }
  }
}
