import { Stack, StackProps, CfnOutput, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import { AlertsConstruct } from "./constructs/alerts";
import { LambdaConstruct } from "./constructs/lambda";
import { ApiGatewayConstruct } from "./constructs/api-gateway";
import { StorageConstruct } from "./constructs/storage";
import { QueueConstruct } from "./constructs/queue";
import { GenerationQueueConstruct } from "./constructs/generation-queue";
import { GenerationLambdaConstruct } from "./constructs/generation-lambda";
import { DictationAudioQueueConstruct } from "./constructs/dictation-audio-queue";
import { DictationAudioLambdaConstruct } from "./constructs/dictation-audio-lambda";
import { SchedulerLambdaConstruct } from "./constructs/scheduler-lambda";
import { AnnotateStreamLambdaConstruct } from "./constructs/annotate-stream-lambda";
import { TheoryGenerationQueueConstruct } from "./constructs/theory-generation-queue";
import { TheoryGenerationLambdaConstruct } from "./constructs/theory-generation-lambda";
import { TheorySchedulerLambdaConstruct } from "./constructs/theory-scheduler-lambda";
import { EmailQueueConstruct } from "./constructs/email-queue";
import { EmailDispatcherLambdaConstruct } from "./constructs/email-dispatcher-lambda";
import { EmailSenderLambdaConstruct } from "./constructs/email-sender-lambda";

export interface LanguageDrillStackProps extends StackProps {
  envName: "prod" | "dev";
  secretsPrefix: string;
  apiName: string;
  apiDomainName: string;
  clerkIssuerUrl: string;
  clerkAudience: string[];
  allowedOrigins: string[];
  enableScheduledJobs: boolean;
  // Per-pipeline override for the daily exercise-generation cron. Defaults to
  // `enableScheduledJobs` when unset, so dev/prod behaviour is unchanged unless
  // a stack explicitly opts out. Lets us pause exercise refill independently of
  // the weekly theory-generation cron (which stays on `enableScheduledJobs`).
  enableScheduledExerciseGeneration?: boolean;
  // Comma-separated list of Clerk user IDs allowed to call /admin/* routes
  // (Phase 5). Plain env var, not a Secrets Manager secret — values are user
  // IDs, not credentials.
  adminUserIds?: string;
  // Global AI cost brakes. Both plain env vars (not secrets). AI_KILL_SWITCH='on'
  // hard-stops AI for non-admins; AI_GLOBAL_DAILY_CAP caps free-tier usage by the
  // trailing-24h global event count. Omit/empty to disable.
  aiKillSwitch?: string;
  aiGlobalDailyCap?: string;
  // Operational alerting (audit §1.2 / §3.2 / §4.1). Email that receives the
  // new CloudWatch alarm notifications and AWS Budget alerts.
  alertEmail: string;
  // Create the account-wide monthly cost budget on this stack. True for exactly
  // one stack (prod) — budgets track total account spend, so two would
  // double-count.
  createBudget: boolean;
  // Monthly cost-budget ceiling in USD (prod only). Defaults to 50.
  monthlyBudgetUsd?: number;
}

export class LanguageDrillStack extends Stack {
  constructor(scope: Construct, id: string, props: LanguageDrillStackProps) {
    super(scope, id, props);

    const storage = new StorageConstruct(this, "Storage");

    // Alerting fan-in: SNS topic for the new alarm actions + (prod-only) the
    // account-wide monthly cost budget.
    const alerts = new AlertsConstruct(this, "Alerts", {
      envName: props.envName,
      alertEmail: props.alertEmail,
      createBudget: props.createBudget,
      monthlyBudgetUsd: props.monthlyBudgetUsd,
    });

    const lambda = new LambdaConstruct(this, "Lambda", {
      secretsPrefix: props.secretsPrefix,
      alarmTopic: alerts.topic,
      additionalEnv: {
        ALLOWED_ORIGINS: props.allowedOrigins.join(","),
        ENV_NAME: props.envName,
        ADMIN_USER_IDS: props.adminUserIds ?? "",
        AI_KILL_SWITCH: props.aiKillSwitch ?? "",
        AI_GLOBAL_DAILY_CAP: props.aiGlobalDailyCap ?? "",
        CONTENT_BUCKET_NAME: storage.bucket.bucketName,
        EMAIL_LINK_BASE_URL: `https://${props.apiDomainName}`,
        EMAIL_FROM: "Language Drill <summary@langdrill.app>",
      },
    });

    const apiGateway = new ApiGatewayConstruct(this, "ApiGateway", {
      handler: lambda.handler,
      apiName: props.apiName,
      apiDomainName: props.apiDomainName,
      clerkIssuerUrl: props.clerkIssuerUrl,
      clerkAudience: props.clerkAudience,
    });

    const queue = new QueueConstruct(this, "Queue");

    storage.bucket.grantRead(lambda.handler);
    queue.queue.grantSendMessages(lambda.handler);

    // Phase 4 — generation pipeline (SQS + consumer Lambda + scheduler).
    // The Lambda is created on both stacks; the EventBridge rule is gated on
    // enableScheduledJobs (true in prod, false in dev).
    const generationQueue = new GenerationQueueConstruct(
      this,
      "GenerationQueue",
      { alarmTopic: alerts.topic },
    );
    // On-demand admin generation: the API Lambda enqueues trigger:'admin' jobs onto the
    // generation queue (POST /admin/generate). addEnvironment avoids reordering construct creation.
    generationQueue.queue.grantSendMessages(lambda.handler);
    lambda.handler.addEnvironment("GENERATION_QUEUE_URL", generationQueue.queue.queueUrl);

    // Phase 2 — dictation audio-synth pipeline (SQS + consumer Lambda). The
    // generation handler enqueues approved dictation ids here; this Lambda
    // synthesizes the MP3 via Polly, uploads it to the content bucket, and sets
    // `audio_s3_key` so PR 1's serve gate releases the row to learners.
    const dictationAudioQueue = new DictationAudioQueueConstruct(
      this,
      "DictationAudioQueue",
      { alarmTopic: alerts.topic },
    );
    new DictationAudioLambdaConstruct(this, "DictationAudioLambdaWrap", {
      queue: dictationAudioQueue.queue,
      contentBucket: storage.bucket,
      secretsPrefix: props.secretsPrefix,
      reservedConcurrency: 2,
      alarmTopic: alerts.topic,
    });

    const generationLambda = new GenerationLambdaConstruct(
      this,
      "GenerationLambdaWrap",
      {
        queue: generationQueue.queue,
        secretsPrefix: props.secretsPrefix,
        envName: props.envName,
        reservedConcurrency: 3,
        alarmTopic: alerts.topic,
        // The generation handler batches newly-approved dictation ids to this
        // queue (PR 2, Task 6).
        additionalEnv: {
          DICTATION_AUDIO_QUEUE_URL: dictationAudioQueue.queue.queueUrl,
        },
      },
    );
    // Let the generation Lambda enqueue audio-synth jobs.
    dictationAudioQueue.queue.grantSendMessages(generationLambda.handler);
    new SchedulerLambdaConstruct(this, "SchedulerLambdaWrap", {
      queue: generationQueue.queue,
      secretsPrefix: props.secretsPrefix,
      // Exercise refill can be paused independently of theory generation.
      enableScheduledJobs:
        props.enableScheduledExerciseGeneration ?? props.enableScheduledJobs,
    });

    // more-responsive-reading — streaming-annotate Lambda + Function URL.
    // Sits OUTSIDE the API Gateway path because the response is SSE; the
    // Function URL's RESPONSE_STREAM invoke mode forwards bytes as the
    // handler writes them, which API Gateway's Lambda integration cannot do.
    const annotateStream = new AnnotateStreamLambdaConstruct(
      this,
      "AnnotateStream",
      {
        secretsPrefix: props.secretsPrefix,
        alarmTopic: alerts.topic,
        additionalEnv: {
          AI_KILL_SWITCH: props.aiKillSwitch ?? "",
          AI_GLOBAL_DAILY_CAP: props.aiGlobalDailyCap ?? "",
        },
      },
    );

    // Phase 4 (theory) — parallel theory generation pipeline. Independent
    // queue + DLQ + reserved-concurrency budget from the exercise pipeline.
    // Cron gating stays on `enableScheduledJobs`; the exercise pipeline above
    // can be paused independently via `enableScheduledExerciseGeneration`.
    const theoryQueue = new TheoryGenerationQueueConstruct(
      this,
      "TheoryGenerationQueue",
      { alarmTopic: alerts.topic },
    );
    new TheoryGenerationLambdaConstruct(this, "TheoryGenerationLambdaWrap", {
      queue: theoryQueue.queue,
      secretsPrefix: props.secretsPrefix,
      envName: props.envName,
      reservedConcurrency: 2,
      alarmTopic: alerts.topic,
    });
    new TheorySchedulerLambdaConstruct(this, "TheorySchedulerLambdaWrap", {
      queue: theoryQueue.queue,
      secretsPrefix: props.secretsPrefix,
      enableScheduledJobs: props.enableScheduledJobs,
    });

    // Weekly summary email pipeline — independent SQS + dispatcher (weekly
    // cron) + sender. Cron gated on enableScheduledJobs (prod on, dev off).
    const emailQueue = new EmailQueueConstruct(this, "EmailQueue", {
      alarmTopic: alerts.topic,
    });
    new EmailDispatcherLambdaConstruct(this, "EmailDispatcherWrap", {
      queue: emailQueue.queue,
      secretsPrefix: props.secretsPrefix,
      enableScheduledJobs: props.enableScheduledJobs,
    });
    new EmailSenderLambdaConstruct(this, "EmailSenderWrap", {
      queue: emailQueue.queue,
      secretsPrefix: props.secretsPrefix,
      reservedConcurrency: 2,
      emailLinkBaseUrl: `https://${props.apiDomainName}`,
      // Web app the "Practice now" CTA links to. Both envs point at the prod
      // web app (there is no separate dev web domain); adjust if one is added.
      emailAppUrl: "https://langdrill.app",
    });

    new CfnOutput(this, "ApiUrl", {
      value: apiGateway.httpApi.url ?? "",
      description: "API Gateway endpoint URL",
    });
    new CfnOutput(this, "GenerationQueueUrl", {
      value: generationQueue.queue.queueUrl,
      description:
        "SQS queue for generation jobs (Phase 4). Set GENERATION_QUEUE_URL to this for the CLI --queue flag.",
    });
    new CfnOutput(this, "AnnotateStreamUrl", {
      value: annotateStream.functionUrl,
      description:
        "Function URL for the SSE read endpoints: /read/annotate (skim) and /read/annotate-span (deep card)",
    });
    new CfnOutput(this, "DictationAudioQueueUrl", {
      value: dictationAudioQueue.queue.queueUrl,
      description:
        "SQS queue URL for dictation audio synthesis (Phase 2). Set DICTATION_AUDIO_QUEUE_URL to this to enqueue audio-synth jobs.",
    });
    new CfnOutput(this, "TheoryGenerationQueueUrl", {
      value: theoryQueue.queue.queueUrl,
      description:
        "SQS queue URL for theory generation (Phase 4). Set THEORY_GENERATION_QUEUE_URL to this for `pnpm generate:theory --queue`.",
    });
    new CfnOutput(this, "EmailQueueUrl", {
      value: emailQueue.queue.queueUrl,
      description: "SQS queue URL for weekly-summary email sends.",
    });

    Tags.of(this).add("env", props.envName);
  }
}
