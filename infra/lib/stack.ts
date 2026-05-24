import { Stack, StackProps, CfnOutput, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import { LambdaConstruct } from "./constructs/lambda";
import { ApiGatewayConstruct } from "./constructs/api-gateway";
import { StorageConstruct } from "./constructs/storage";
import { QueueConstruct } from "./constructs/queue";
import { GenerationQueueConstruct } from "./constructs/generation-queue";
import { GenerationLambdaConstruct } from "./constructs/generation-lambda";
import { SchedulerLambdaConstruct } from "./constructs/scheduler-lambda";
import { AnnotateStreamLambdaConstruct } from "./constructs/annotate-stream-lambda";
import { TheoryGenerationQueueConstruct } from "./constructs/theory-generation-queue";
import { TheoryGenerationLambdaConstruct } from "./constructs/theory-generation-lambda";
import { TheorySchedulerLambdaConstruct } from "./constructs/theory-scheduler-lambda";

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
}

export class LanguageDrillStack extends Stack {
  constructor(scope: Construct, id: string, props: LanguageDrillStackProps) {
    super(scope, id, props);

    const lambda = new LambdaConstruct(this, "Lambda", {
      secretsPrefix: props.secretsPrefix,
      additionalEnv: {
        ALLOWED_ORIGINS: props.allowedOrigins.join(","),
        ENV_NAME: props.envName,
        ADMIN_USER_IDS: props.adminUserIds ?? "",
      },
    });

    const apiGateway = new ApiGatewayConstruct(this, "ApiGateway", {
      handler: lambda.handler,
      apiName: props.apiName,
      apiDomainName: props.apiDomainName,
      clerkIssuerUrl: props.clerkIssuerUrl,
      clerkAudience: props.clerkAudience,
    });

    const storage = new StorageConstruct(this, "Storage");

    const queue = new QueueConstruct(this, "Queue");

    storage.bucket.grantRead(lambda.handler);
    queue.queue.grantSendMessages(lambda.handler);

    // Phase 4 — generation pipeline (SQS + consumer Lambda + scheduler).
    // The Lambda is created on both stacks; the EventBridge rule is gated on
    // enableScheduledJobs (true in prod, false in dev).
    const generationQueue = new GenerationQueueConstruct(
      this,
      "GenerationQueue",
    );
    new GenerationLambdaConstruct(this, "GenerationLambdaWrap", {
      queue: generationQueue.queue,
      secretsPrefix: props.secretsPrefix,
      envName: props.envName,
      reservedConcurrency: 3,
    });
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
      { secretsPrefix: props.secretsPrefix },
    );

    // Phase 4 (theory) — parallel theory generation pipeline. Independent
    // queue + DLQ + reserved-concurrency budget from the exercise pipeline.
    // Cron gating stays on `enableScheduledJobs`; the exercise pipeline above
    // can be paused independently via `enableScheduledExerciseGeneration`.
    const theoryQueue = new TheoryGenerationQueueConstruct(
      this,
      "TheoryGenerationQueue",
    );
    new TheoryGenerationLambdaConstruct(this, "TheoryGenerationLambdaWrap", {
      queue: theoryQueue.queue,
      secretsPrefix: props.secretsPrefix,
      envName: props.envName,
      reservedConcurrency: 2,
    });
    new TheorySchedulerLambdaConstruct(this, "TheorySchedulerLambdaWrap", {
      queue: theoryQueue.queue,
      secretsPrefix: props.secretsPrefix,
      enableScheduledJobs: props.enableScheduledJobs,
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
      description: "Function URL for /read/annotate streaming endpoint",
    });
    new CfnOutput(this, "TheoryGenerationQueueUrl", {
      value: theoryQueue.queue.queueUrl,
      description:
        "SQS queue URL for theory generation (Phase 4). Set THEORY_GENERATION_QUEUE_URL to this for `pnpm generate:theory --queue`.",
    });

    Tags.of(this).add("env", props.envName);
  }
}
