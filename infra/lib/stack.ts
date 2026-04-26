import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import { LambdaConstruct } from "./constructs/lambda";
import { ApiGatewayConstruct } from "./constructs/api-gateway";
import { StorageConstruct } from "./constructs/storage";
import { QueueConstruct } from "./constructs/queue";

export class LanguageDrillStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const lambda = new LambdaConstruct(this, "Lambda");

    const apiGateway = new ApiGatewayConstruct(this, "ApiGateway", {
      handler: lambda.handler,
      clerkIssuerUrl: process.env.CLERK_ISSUER_URL ?? "https://clerk.example.com",
      clerkAudience: (process.env.CLERK_AUDIENCE || "language-drill").split(",").filter(Boolean),
      productionOrigin: process.env.PRODUCTION_ORIGIN,
      apiDomainName: process.env.API_DOMAIN_NAME,
    });

    const storage = new StorageConstruct(this, "Storage");

    const queue = new QueueConstruct(this, "Queue");

    storage.bucket.grantRead(lambda.handler);
    queue.queue.grantSendMessages(lambda.handler);

    new CfnOutput(this, "ApiUrl", {
      value: apiGateway.httpApi.url ?? "",
      description: "API Gateway endpoint URL",
    });
  }
}
