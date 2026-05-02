import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as path from "path";

export interface LambdaConstructProps {
  secretsPrefix: string;
  additionalEnv?: Record<string, string>;
}

export class LambdaConstruct extends Construct {
  public readonly handler: lambda.NodejsFunction;

  constructor(scope: Construct, id: string, props: LambdaConstructProps) {
    super(scope, id);

    const databaseUrl = secretsmanager.Secret.fromSecretNameV2(
      this,
      "DatabaseUrl",
      `${props.secretsPrefix}/DATABASE_URL`
    );
    const clerkSecretKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ClerkSecretKey",
      `${props.secretsPrefix}/CLERK_SECRET_KEY`
    );
    const clerkWebhookSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ClerkWebhookSecret",
      `${props.secretsPrefix}/CLERK_WEBHOOK_SECRET`
    );
    const anthropicApiKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AnthropicApiKey",
      `${props.secretsPrefix}/ANTHROPIC_API_KEY`
    );
    const upstashRedisRestUrl = secretsmanager.Secret.fromSecretNameV2(
      this,
      "UpstashRedisRestUrl",
      `${props.secretsPrefix}/UPSTASH_REDIS_REST_URL`
    );
    const upstashRedisRestToken = secretsmanager.Secret.fromSecretNameV2(
      this,
      "UpstashRedisRestToken",
      `${props.secretsPrefix}/UPSTASH_REDIS_REST_TOKEN`
    );

    const projectRoot = path.join(__dirname, "../../..");

    this.handler = new lambda.NodejsFunction(this, "Handler", {
      entry: path.join(__dirname, "../../lambda/src/index.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      memorySize: 256,
      depsLockFilePath: path.join(projectRoot, "pnpm-lock.yaml"),
      bundling: {
        minify: true,
        sourceMap: true,
        esbuildArgs: {
          "--alias:@language-drill/shared": path.join(
            projectRoot,
            "packages/shared/src/index.ts"
          ),
          "--alias:@language-drill/db": path.join(
            projectRoot,
            "packages/db/src/index.ts"
          ),
          "--alias:@language-drill/ai": path.join(
            projectRoot,
            "packages/ai/src/index.ts"
          ),
        },
      },
      // additionalEnv is spread first so secret-derived vars below cannot be overridden by callers.
      environment: {
        ...(props.additionalEnv ?? {}),
        DATABASE_URL: databaseUrl.secretValue.unsafeUnwrap(),
        CLERK_SECRET_KEY: clerkSecretKey.secretValue.unsafeUnwrap(),
        CLERK_WEBHOOK_SECRET: clerkWebhookSecret.secretValue.unsafeUnwrap(),
        ANTHROPIC_API_KEY: anthropicApiKey.secretValue.unsafeUnwrap(),
        UPSTASH_REDIS_REST_URL: upstashRedisRestUrl.secretValue.unsafeUnwrap(),
        UPSTASH_REDIS_REST_TOKEN:
          upstashRedisRestToken.secretValue.unsafeUnwrap(),
      },
    });

    databaseUrl.grantRead(this.handler);
    clerkSecretKey.grantRead(this.handler);
    clerkWebhookSecret.grantRead(this.handler);
    anthropicApiKey.grantRead(this.handler);
    upstashRedisRestUrl.grantRead(this.handler);
    upstashRedisRestToken.grantRead(this.handler);
  }
}
