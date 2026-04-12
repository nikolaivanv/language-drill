import { App } from "aws-cdk-lib";
import { LanguageDrillStack } from "../lib/stack";

const app = new App();

new LanguageDrillStack(app, "LanguageDrillStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
