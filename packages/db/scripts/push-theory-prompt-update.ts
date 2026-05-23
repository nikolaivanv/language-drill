/**
 * One-off — push the updated THEORY_SYSTEM_PROMPT_TEMPLATE to Langfuse as a
 * new version of `theory-generate-system-prompt`, labelled `production`.
 *
 * Reads the template body directly from the in-repo constant so the live
 * Langfuse prompt and the in-repo fallback stay byte-identical (Anthropic
 * prompt cache + byte-parity test depend on this).
 *
 * Requires LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY in env.
 *
 * Usage:
 *   source /tmp/load-prod-secrets.sh
 *   ./node_modules/.bin/tsx scripts/push-theory-prompt-update.ts
 */

import { Langfuse } from "langfuse";
import {
  THEORY_SYSTEM_PROMPT_TEMPLATE,
  THEORY_GENERATION_PROMPT_VERSION,
} from "@language-drill/ai";

async function main() {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  const baseUrl = (
    process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com"
  ).trim();
  if (!publicKey || !secretKey) {
    console.error("LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY required");
    process.exit(1);
  }

  const langfuse = new Langfuse({ publicKey, secretKey, baseUrl });

  // Mirror the config bootstrap-prompts.ts writes so dashboards stay consistent.
  const config = {
    surface: "theory-generation",
    localVersion: THEORY_GENERATION_PROMPT_VERSION,
  };

  console.log(
    `Pushing theory-generate-system-prompt (${THEORY_GENERATION_PROMPT_VERSION}, ${THEORY_SYSTEM_PROMPT_TEMPLATE.length} chars)…`,
  );

  const created = await langfuse.createPrompt({
    name: "theory-generate-system-prompt",
    prompt: THEORY_SYSTEM_PROMPT_TEMPLATE,
    labels: ["production"],
    config,
    type: "text",
  });

  console.log(
    `OK. version=${created.version} name=${created.name} labels=${JSON.stringify(created.labels)}`,
  );
  await langfuse.flushAsync();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
