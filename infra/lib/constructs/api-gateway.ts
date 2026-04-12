import { Construct } from "constructs";
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { IFunction } from "aws-cdk-lib/aws-lambda";

export interface ApiGatewayConstructProps {
  handler: IFunction;
  clerkIssuerUrl: string;
  clerkAudience: string[];
  productionOrigin?: string;
}

export class ApiGatewayConstruct extends Construct {
  public readonly httpApi: HttpApi;

  constructor(scope: Construct, id: string, props: ApiGatewayConstructProps) {
    super(scope, id);

    const authorizer = new HttpJwtAuthorizer(
      "ClerkJwtAuthorizer",
      props.clerkIssuerUrl,
      {
        jwtAudience: props.clerkAudience,
      }
    );

    const allowOrigins = ["https://*.vercel.app"];
    if (props.productionOrigin) {
      allowOrigins.push(props.productionOrigin);
    }

    this.httpApi = new HttpApi(this, "HttpApi", {
      apiName: "language-drill-api",
      corsPreflight: {
        allowOrigins,
        allowMethods: [CorsHttpMethod.ANY],
        allowHeaders: ["Authorization", "Content-Type"],
      },
      defaultAuthorizer: authorizer,
    });

    const lambdaIntegration = new HttpLambdaIntegration(
      "LambdaIntegration",
      props.handler
    );

    this.httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [HttpMethod.ANY],
      integration: lambdaIntegration,
    });
  }
}
