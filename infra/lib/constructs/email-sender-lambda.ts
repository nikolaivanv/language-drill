import * as path from 'path';
import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwactions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface EmailSenderLambdaConstructProps {
  queue: sqs.IQueue;
  secretsPrefix: string;
  reservedConcurrency: number;
  /** Base URL for unsubscribe links (API domain). */
  emailLinkBaseUrl: string;
  /** Base URL for the "Practice now" CTA (web app). */
  emailAppUrl: string;
  readonly alarmTopic?: sns.ITopic;
}

/**
 * SQS-consumer Lambda for weekly-summary sends.
 *
 * Consumes one message per invocation (batchSize=1), renders the email via
 * `@language-drill/email`, and sends via the Resend API. Reserved concurrency
 * is capped at 2 to throttle outbound Resend API calls. Minimum-privilege
 * secrets: DATABASE_URL + RESEND_API_KEY only.
 */
export class EmailSenderLambdaConstruct extends Construct {
  public readonly handler: lambda.NodejsFunction;
  public readonly errorsAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: EmailSenderLambdaConstructProps) {
    super(scope, id);

    const databaseUrl = secretsmanager.Secret.fromSecretNameV2(this, 'DatabaseUrl', `${props.secretsPrefix}/DATABASE_URL`);
    const resendApiKey = secretsmanager.Secret.fromSecretNameV2(this, 'ResendApiKey', `${props.secretsPrefix}/RESEND_API_KEY`);
    const projectRoot = path.join(__dirname, '../../..');

    this.handler = new lambda.NodejsFunction(this, 'Handler', {
      entry: path.join(__dirname, '../../lambda/src/email/sender.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(60),
      memorySize: 512,
      reservedConcurrentExecutions: props.reservedConcurrency,
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
        RESEND_API_KEY: resendApiKey.secretValue.unsafeUnwrap(),
        EMAIL_LINK_BASE_URL: props.emailLinkBaseUrl,
        EMAIL_APP_URL: props.emailAppUrl,
      },
    });

    databaseUrl.grantRead(this.handler);
    resendApiKey.grantRead(this.handler);

    this.handler.addEventSource(
      new SqsEventSource(props.queue, {
        batchSize: 1,
        reportBatchItemFailures: true,
        maxConcurrency: props.reservedConcurrency,
      }),
    );

    this.errorsAlarm = new cloudwatch.Alarm(this, 'EmailSenderErrorsAlarm', {
      metric: this.handler.metricErrors({ period: Duration.days(1), statistic: cloudwatch.Stats.SUM }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Weekly-summary sender Lambda recorded > 5 errors in a single day.',
    });

    if (props.alarmTopic) {
      this.errorsAlarm.addAlarmAction(new cwactions.SnsAction(props.alarmTopic));
    }
  }
}
