import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as path from "path";

export class LambdaConstruct extends Construct {
  public readonly handler: lambda.NodejsFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const databaseUrl = secretsmanager.Secret.fromSecretNameV2(
      this,
      "DatabaseUrl",
      "language-drill/DATABASE_URL"
    );
    const clerkSecretKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ClerkSecretKey",
      "language-drill/CLERK_SECRET_KEY"
    );
    const clerkWebhookSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ClerkWebhookSecret",
      "language-drill/CLERK_WEBHOOK_SECRET"
    );
    const anthropicApiKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AnthropicApiKey",
      "language-drill/ANTHROPIC_API_KEY"
    );
    const upstashRedisUrl = secretsmanager.Secret.fromSecretNameV2(
      this,
      "UpstashRedisUrl",
      "language-drill/UPSTASH_REDIS_URL"
    );

    this.handler = new lambda.NodejsFunction(this, "Handler", {
      entry: path.join(__dirname, "../../lambda/src/index.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      memorySize: 256,
      bundling: {
        minify: true,
        sourceMap: true,
      },
      environment: {
        DATABASE_URL: databaseUrl.secretValue.unsafeUnwrap(),
        CLERK_SECRET_KEY: clerkSecretKey.secretValue.unsafeUnwrap(),
        CLERK_WEBHOOK_SECRET: clerkWebhookSecret.secretValue.unsafeUnwrap(),
        ANTHROPIC_API_KEY: anthropicApiKey.secretValue.unsafeUnwrap(),
        UPSTASH_REDIS_URL: upstashRedisUrl.secretValue.unsafeUnwrap(),
      },
    });

    databaseUrl.grantRead(this.handler);
    clerkSecretKey.grantRead(this.handler);
    clerkWebhookSecret.grantRead(this.handler);
    anthropicApiKey.grantRead(this.handler);
    upstashRedisUrl.grantRead(this.handler);
  }
}
