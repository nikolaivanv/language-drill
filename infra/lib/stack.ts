import { Stack, StackProps, CfnOutput, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import { LambdaConstruct } from "./constructs/lambda";
import { ApiGatewayConstruct } from "./constructs/api-gateway";
import { StorageConstruct } from "./constructs/storage";
import { QueueConstruct } from "./constructs/queue";

export interface LanguageDrillStackProps extends StackProps {
  envName: "prod" | "dev";
  secretsPrefix: string;
  apiName: string;
  apiDomainName: string;
  clerkIssuerUrl: string;
  clerkAudience: string[];
  allowedOrigins: string[];
  enableScheduledJobs: boolean;
}

export class LanguageDrillStack extends Stack {
  constructor(scope: Construct, id: string, props: LanguageDrillStackProps) {
    super(scope, id, props);

    const lambda = new LambdaConstruct(this, "Lambda", {
      secretsPrefix: props.secretsPrefix,
      additionalEnv: {
        ALLOWED_ORIGINS: props.allowedOrigins.join(","),
        ENV_NAME: props.envName,
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

    new CfnOutput(this, "ApiUrl", {
      value: apiGateway.httpApi.url ?? "",
      description: "API Gateway endpoint URL",
    });

    Tags.of(this).add("env", props.envName);
  }
}
