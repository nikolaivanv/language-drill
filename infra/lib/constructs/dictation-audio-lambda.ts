import * as path from 'path';

import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwactions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

/**
 * Phase 2 — SQS-consumer Lambda for the dictation audio-synth pipeline.
 *
 * Consumes `{ exerciseId }` messages enqueued by the generation handler once a
 * dictation row is inserted as approved/flagged with `audio_s3_key = null`. For
 * each record it loads the row, calls Polly to synthesize `referenceText`,
 * uploads the MP3 to S3 under `dictation/<id>.mp3`, and sets `audio_s3_key` — at
 * which point PR 1's serve gate releases the row to learners. Idempotent under
 * SQS at-least-once redelivery (skips rows that already have audio), reports
 * per-record outcomes via `reportBatchItemFailures`.
 *
 * Minimum-privilege: DATABASE_URL only (no Anthropic/Langfuse/Clerk — this
 * Lambda never calls Claude). Polly is account-scoped (no resource ARN); S3
 * write is scoped to the content bucket. Reserved concurrency is modest to stay
 * within Polly's per-account TPS for `SynthesizeSpeech`.
 */
export interface DictationAudioLambdaConstructProps {
  queue: sqs.IQueue;
  /** Content bucket — the Lambda gets `s3:PutObject` here + `CONTENT_BUCKET_NAME`. */
  contentBucket: s3.IBucket;
  secretsPrefix: string;
  /** Caps Polly concurrency. 2–3 keeps us well within the SynthesizeSpeech TPS. */
  reservedConcurrency: number;
  /** SNS topic for the Lambda-errors alarm action. */
  readonly alarmTopic?: sns.ITopic;
}

export class DictationAudioLambdaConstruct extends Construct {
  public readonly handler: lambda.NodejsFunction;
  public readonly errorsAlarm: cloudwatch.Alarm;

  constructor(
    scope: Construct,
    id: string,
    props: DictationAudioLambdaConstructProps,
  ) {
    super(scope, id);

    const databaseUrl = secretsmanager.Secret.fromSecretNameV2(
      this,
      'DatabaseUrl',
      `${props.secretsPrefix}/DATABASE_URL`,
    );

    const projectRoot = path.join(__dirname, '../../..');

    this.handler = new lambda.NodejsFunction(this, 'Handler', {
      entry: path.join(
        __dirname,
        '../../lambda/src/dictation-audio/handler.ts',
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      // Polly synth + S3 put is a few seconds; 90 s leaves headroom for a cold
      // start + a long clip while staying under the queue's 120 s visibility
      // timeout (SQS must not redeliver a still-running message).
      timeout: Duration.seconds(90),
      memorySize: 512,
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
          // The handler imports only @language-drill/db, but the db source
          // barrel transitively imports @language-drill/ai (run-one-cell /
          // validate-and-insert). Aliasing db to source means esbuild follows
          // that edge, so ai must be aliased to source too — otherwise the
          // bare import is unresolvable when ai's dist isn't built (CI).
          '--alias:@language-drill/ai': path.join(
            projectRoot,
            'packages/ai/src/index.ts',
          ),
        },
      },
      environment: {
        DATABASE_URL: databaseUrl.secretValue.unsafeUnwrap(),
        CONTENT_BUCKET_NAME: props.contentBucket.bucketName,
      },
    });

    databaseUrl.grantRead(this.handler);

    // Polly is account-scoped — `SynthesizeSpeech` does not support
    // resource-level permissions, so the resource must be `*`.
    this.handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['polly:SynthesizeSpeech'],
        resources: ['*'],
      }),
    );

    // Write the synthesized MP3 to the content bucket (scoped to this bucket).
    props.contentBucket.grantPut(this.handler);

    this.handler.addEventSource(
      new SqsEventSource(props.queue, {
        batchSize: 5,
        reportBatchItemFailures: true,
        // Match `reservedConcurrency` so the SQS poller never fetches more
        // messages than the Lambda can invoke on — otherwise pre-fetched
        // excess messages expire visibility and silently DLQ. See the
        // generation Lambda's note for the live incident this guards against.
        maxConcurrency: props.reservedConcurrency,
      }),
    );

    this.errorsAlarm = new cloudwatch.Alarm(
      this,
      'DictationAudioErrorsAlarm',
      {
        metric: this.handler.metricErrors({
          period: Duration.days(1),
          statistic: cloudwatch.Stats.SUM,
        }),
        threshold: 5,
        evaluationPeriods: 1,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription:
          'Phase 2: dictation audio-synth Lambda recorded > 5 errors in a single day.',
      },
    );

    if (props.alarmTopic) {
      this.errorsAlarm.addAlarmAction(new cwactions.SnsAction(props.alarmTopic));
    }
  }
}
