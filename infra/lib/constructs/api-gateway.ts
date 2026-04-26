import { CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  ApiMapping,
  DomainName,
  HttpApi,
  HttpMethod,
  HttpNoneAuthorizer,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import * as acm from "aws-cdk-lib/aws-certificatemanager";

export interface ApiGatewayConstructProps {
  handler: IFunction;
  clerkIssuerUrl: string;
  clerkAudience: string[];
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

    this.httpApi = new HttpApi(this, "HttpApi", {
      apiName: "language-drill-api",
      defaultAuthorizer: authorizer,
    });

    const lambdaIntegration = new HttpLambdaIntegration(
      "LambdaIntegration",
      props.handler
    );

    this.httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [
        HttpMethod.GET,
        HttpMethod.POST,
        HttpMethod.PUT,
        HttpMethod.PATCH,
        HttpMethod.DELETE,
      ],
      integration: lambdaIntegration,
    });

    this.httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [HttpMethod.OPTIONS],
      integration: lambdaIntegration,
      authorizer: new HttpNoneAuthorizer(),
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
