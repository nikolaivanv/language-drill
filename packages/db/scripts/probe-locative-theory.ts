/**
 * One-off diagnostic probe — calls the live theory generator + validator
 * for the `tr-a1-locative` cell against the production prompt registry
 * (Langfuse `production` label, fallback to in-repo templates).
 *
 * Does NOT write to the DB. Hits Anthropic — costs ~$0.08 per run.
 *
 * Run with prod env loaded:
 *   source /tmp/load-prod-secrets.sh
 *   ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value \
 *     --secret-id language-drill/ANTHROPIC_API_KEY --region eu-central-1 \
 *     --query SecretString --output text) \
 *   pnpm tsx .claude/worktrees/bug-tr-a1-locative-theory-gen/scripts/probe-locative-theory.mts
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  generateTheoryTopic,
  validateTheoryDraft,
} from "@language-drill/ai";
import { getGrammarPoint } from "../src/curriculum";
import { Language } from "@language-drill/shared";
import { routeTheoryValidationResult } from "../src/theory-generation/routing";

async function main() {
  const KEY = "tr-a1-locative";
  const grammarPoint = getGrammarPoint(KEY);
  if (!grammarPoint) {
    console.error(`Unknown grammar point: ${KEY}`);
    process.exit(1);
  }

  const spec = {
    language: Language.TR as Exclude<Language, Language.EN>,
    cefrLevel: "A1" as const,
    grammarPoint,
    batchSeed: process.env.PROBE_SEED ?? "probe-2026-05-23",
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });

  console.error("# generating draft…");
  const gen = await generateTheoryTopic(client, spec);
  console.error(
    `# generated. input=${gen.tokenUsage.inputTokens} output=${gen.tokenUsage.outputTokens}`,
  );

  console.error("# validating…");
  const val = await validateTheoryDraft(client, gen.draft, spec);
  console.error(
    `# validated. input=${val.tokenUsage.inputTokens} output=${val.tokenUsage.outputTokens}`,
  );

  const decision = routeTheoryValidationResult(val.result);

  const report = {
    spec: {
      language: spec.language,
      cefrLevel: spec.cefrLevel,
      grammarPointKey: spec.grammarPoint.key,
    },
    decision,
    validation: val.result,
    draftPreview: {
      id: gen.draft.id,
      topicId: gen.draft.topicId,
      sectionHeadings: (gen.draft.contentJson?.sections || []).map(
        (s: { heading?: string }) => s.heading,
      ),
    },
    draftContentJson: gen.draft.contentJson,
    tokenUsage: {
      generation: gen.tokenUsage,
      validation: val.tokenUsage,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
