import { App } from "aws-cdk-lib";
import { LanguageDrillStack } from "../lib/stack";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

const app = new App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const parseAudience = (raw: string | undefined, fallback: string): string[] =>
  (raw || fallback).split(",").map((s) => s.trim()).filter(Boolean);

new LanguageDrillStack(app, "LanguageDrillStack", {
  env,
  envName: "prod",
  secretsPrefix: "language-drill",
  apiName: "language-drill-api",
  apiDomainName: requireEnv("API_DOMAIN_NAME"),
  clerkIssuerUrl: requireEnv("CLERK_ISSUER_URL"),
  clerkAudience: parseAudience(process.env.CLERK_AUDIENCE, "language-drill"),
  allowedOrigins: [
    "https://*.vercel.app",
    "https://langdrill.app",
    "https://www.langdrill.app",
  ],
  enableScheduledJobs: true,
  adminUserIds: process.env.ADMIN_USER_IDS,
  aiKillSwitch: process.env.AI_KILL_SWITCH,
  aiGlobalDailyCap: process.env.AI_GLOBAL_DAILY_CAP,
});

new LanguageDrillStack(app, "LanguageDrillStack-dev", {
  env,
  envName: "dev",
  secretsPrefix: "language-drill-dev",
  apiName: "language-drill-api-dev",
  apiDomainName: requireEnv("API_DOMAIN_NAME_DEV"),
  clerkIssuerUrl: requireEnv("CLERK_ISSUER_URL_DEV"),
  clerkAudience: parseAudience(process.env.CLERK_AUDIENCE_DEV, "language-drill"),
  allowedOrigins: ["https://*.vercel.app", "http://localhost:3000"],
  enableScheduledJobs: false,
  adminUserIds: process.env.ADMIN_USER_IDS_DEV,
  aiKillSwitch: process.env.AI_KILL_SWITCH_DEV,
  aiGlobalDailyCap: process.env.AI_GLOBAL_DAILY_CAP_DEV,
});
