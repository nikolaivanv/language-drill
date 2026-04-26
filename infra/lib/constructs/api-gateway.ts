import { CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  ApiMapping,
  CorsHttpMethod,
  DomainName,
  HttpApi,
  HttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import * as acm from "aws-cdk-lib/aws-certificatemanager";

export interface ApiGatewayConstructProps {
  handler: IFunction;
  clerkIssuerUrl: string;
  clerkAudience: string[];
  productionOrigin?: string;
  apiDomainName?: string;
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

    const allowOrigins = ["https://*.vercel.app", "https://langdrill.app"];
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

    if (props.apiDomainName) {
      const certificate = new acm.Certificate(this, "ApiCertificate", {
        domainName: props.apiDomainName,
        validation: acm.CertificateValidation.fromDns(),
      });

      const domain = new DomainName(this, "ApiDomain", {
        domainName: props.apiDomainName,
        certificate,
      });

      new ApiMapping(this, "ApiMapping", {
        api: this.httpApi,
        domainName: domain,
      });

      new CfnOutput(this, "ApiDomainTarget", {
        value: domain.regionalDomainName,
        description:
          "Add a CNAME in Cloudflare: api.langdrill.app → this value",
      });
    }
  }
}
