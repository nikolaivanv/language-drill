import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import {
  FunctionUrl,
  FunctionUrlAuthType,
  HttpMethod,
  InvokeMode,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import * as path from "path";
// Imported via relative source path rather than the `@language-drill/shared`
// bare specifier. The shared package compiles to ESM under
// `packages/shared/dist/`, and its internal re-exports omit `.js` extensions —
// fine for bundlers (Next.js, esbuild) but Node's ESM resolver, which
// ts-node invokes when compiling this file during `cdk synth`, rejects the
// extensionless references and fails with ERR_MODULE_NOT_FOUND. Resolving
// directly to the .ts source sidesteps the dist/ entry entirely.
import { FALLBACK_ORIGINS } from "../../../packages/shared/src/cors";

/**
 * Streaming-annotate Lambda + Function URL.
 *
 * Lives behind its own Lambda Function URL (NOT API Gateway) because the
 * response is Server-Sent Events — API Gateway HTTP API buffers Lambda
 * integrations and would defeat the streaming UX. The Function URL has
 * `InvokeMode.RESPONSE_STREAM` so the runtime forwards each `responseStream.write`
 * to the client as it lands. JWT verification happens inside the handler
 * via `@clerk/backend` (the Function URL itself uses `AuthType: NONE`).
 *
 * Secrets / IAM / esbuild aliases mirror `LambdaConstruct` so the two
 * Lambdas stay deployable from the same pnpm-managed monorepo.
 */
export interface AnnotateStreamLambdaConstructProps {
  secretsPrefix: string;
  additionalEnv?: Record<string, string>;
}

export class AnnotateStreamLambdaConstruct extends Construct {
  public readonly handler: lambda.NodejsFunction;
  public readonly functionUrl: string;

  constructor(
    scope: Construct,
    id: string,
    props: AnnotateStreamLambdaConstructProps,
  ) {
    super(scope, id);

    const databaseUrl = secretsmanager.Secret.fromSecretNameV2(
      this,
      "DatabaseUrl",
      `${props.secretsPrefix}/DATABASE_URL`,
    );
    const clerkSecretKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ClerkSecretKey",
      `${props.secretsPrefix}/CLERK_SECRET_KEY`,
    );
    const anthropicApiKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AnthropicApiKey",
      `${props.secretsPrefix}/ANTHROPIC_API_KEY`,
    );

    const projectRoot = path.join(__dirname, "../../..");

    this.handler = new lambda.NodejsFunction(this, "Handler", {
      entry: path.join(
        __dirname,
        "../../lambda/src/annotate-stream/handler.ts",
      ),
      handler: "handler",
      runtime: Runtime.NODEJS_20_X,
      // 29s is the Function URL's max useful timeout (CloudFront fronting
      // Function URLs drops idle connections at 30s). The pipeline targets
      // p95 ≤ 18s end-to-end, so 29s leaves headroom for slow Claude responses
      // without ever letting CloudFront cut the stream first.
      timeout: Duration.seconds(29),
      memorySize: 512,
      depsLockFilePath: path.join(projectRoot, "pnpm-lock.yaml"),
      bundling: {
        minify: true,
        sourceMap: true,
        esbuildArgs: {
          "--alias:@language-drill/shared": path.join(
            projectRoot,
            "packages/shared/src/index.ts",
          ),
          "--alias:@language-drill/db": path.join(
            projectRoot,
            "packages/db/src/index.ts",
          ),
          "--alias:@language-drill/ai": path.join(
            projectRoot,
            "packages/ai/src/index.ts",
          ),
        },
      },
      environment: {
        ...(props.additionalEnv ?? {}),
        DATABASE_URL: databaseUrl.secretValue.unsafeUnwrap(),
        CLERK_SECRET_KEY: clerkSecretKey.secretValue.unsafeUnwrap(),
        ANTHROPIC_API_KEY: anthropicApiKey.secretValue.unsafeUnwrap(),
      },
    });

    databaseUrl.grantRead(this.handler);
    clerkSecretKey.grantRead(this.handler);
    anthropicApiKey.grantRead(this.handler);

    const url = new FunctionUrl(this, "Url", {
      function: this.handler,
      authType: FunctionUrlAuthType.NONE,
      invokeMode: InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: [...FALLBACK_ORIGINS],
        // AWS Lambda Function URL CORS rejects `OPTIONS` in `AllowMethods`
        // — only [GET, PUT, HEAD, POST, PATCH, DELETE, *] are accepted.
        // Preflight `OPTIONS` is handled implicitly by the platform when
        // `AllowMethods` lists any method; we don't need to enumerate it.
        allowedMethods: [HttpMethod.POST],
        allowedHeaders: ["Authorization", "Content-Type"],
        maxAge: Duration.hours(1),
      },
    });

    this.functionUrl = url.url;
  }
}
