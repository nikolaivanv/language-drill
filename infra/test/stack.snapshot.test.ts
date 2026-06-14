import { describe, expect, it } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { LanguageDrillStack } from "../lib/stack";

/**
 * Snapshot test for the production LanguageDrillStack.
 *
 * Locks in the current CFN resource shape so any future refactor that would
 * force-replace prod resources (e.g. construct ID change, logical ID drift)
 * makes this test fail visibly at PR time.
 *
 * The placeholder values below are intentional — the test asserts CFN shape,
 * not deploy correctness. Update the snapshot only when an intentional CFN
 * change is reviewed and approved.
 *
 * Asset hashes (Lambda bundle S3Key, CDK Metadata Modules) are scrubbed
 * because they change per bundling run — they reflect the build, not the
 * stack shape we want to lock in.
 */

const ASSET_HASH_PLACEHOLDER = "<asset-hash>";

/**
 * Recursively replace any 64-hex-char `.zip` asset key with a placeholder so
 * the snapshot does not depend on bundling output that varies between runs.
 */
function scrubAssetHashes(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(scrubAssetHashes);
  }
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (
        typeof value === "string" &&
        /^[0-9a-f]{64}\.zip$/.test(value)
      ) {
        out[key] = `${ASSET_HASH_PLACEHOLDER}.zip`;
      } else if (key === "aws:cdk:path") {
        out[key] = value;
      } else {
        out[key] = scrubAssetHashes(value);
      }
    }
    return out;
  }
  return node;
}

describe("LanguageDrillStack (prod) CFN snapshot", () => {
  it("matches the locked CFN template", () => {
    const app = new App();
    const stack = new LanguageDrillStack(app, "LanguageDrillStack", {
      env: { account: "123456789012", region: "us-east-1" },
      envName: "prod",
      secretsPrefix: "language-drill",
      apiName: "language-drill-api",
      apiDomainName: "api.langdrill.app",
      clerkIssuerUrl: "https://clerk.example.com",
      clerkAudience: ["language-drill"],
      allowedOrigins: [
        "https://*.vercel.app",
        "https://langdrill.app",
        "https://www.langdrill.app",
      ],
      enableScheduledJobs: true,
      alertEmail: "alerts@example.com",
      createBudget: true,
    });

    const template = scrubAssetHashes(Template.fromStack(stack).toJSON());
    expect(template).toMatchSnapshot();
  });
});
