import type { FreeWritingPromptSummary } from "./free-writing-summary.js";

// Bump in the same commit as any semantic edit to the prompt below.
export const FREE_WRITING_DEDUP_PROMPT_VERSION = "free-writing-dedup@2026-10-07";

export const FREE_WRITING_DEDUP_TOOL_NAME = "submit_dedup_verdict";

// No examples on purpose: the judge is measured against the #757 clusters
// (docs/analysis/fw-round3-dedup-proposals-2026-10-07.json), so examples drawn
// from that data would contaminate the check.
export const FREE_WRITING_DEDUP_SYSTEM_PROMPT = `You decide whether a candidate free-writing prompt duplicates a prompt already in the pool for the same topic.

Two prompts are DUPLICATES when a learner answering them would write essentially the same essay: the same question, the same position to argue or situation to describe, and the same content to produce. A different title, different wording, a different angle label, a different framing sentence, or a different number of required elements does NOT make a prompt distinct when the essay a learner writes would be essentially the same.

Two prompts are DISTINCT when they ask for a genuinely different essay: a different question, a different situation, a different text type (for example a letter versus an opinion piece), or a clearly different focus within the topic.

At CEFR A1 and A2, where prompts are short and concrete, two prompts that require clearly different content are DISTINCT even when they share the topic — for example describing a place versus narrating an event.

The prompts may be written in any language. Judge the meaning, not the wording.

Compare the candidate with every existing prompt. If it duplicates one or more, set duplicateOf to the index of the closest one; otherwise set it to null. Give a one-sentence reason either way.

Use the ${FREE_WRITING_DEDUP_TOOL_NAME} tool.`;

export type FreeWritingDedupInput = {
  candidate: FreeWritingPromptSummary;
  existing: readonly FreeWritingPromptSummary[];
  cefrLevel: string;
};

function renderPrompt(s: FreeWritingPromptSummary, indent: string): string {
  const req = s.requiredElements.length > 0 ? s.requiredElements.join("; ") : "(none)";
  return `Title: ${s.title}\n${indent}Task: ${s.task}\n${indent}Required elements: ${req}`;
}

export function buildFreeWritingDedupUserPrompt(input: FreeWritingDedupInput): string {
  const existing = input.existing
    .map((s, i) => `[${i}] ${renderPrompt(s, "    ")}`)
    .join("\n\n");
  return `CEFR level: ${input.cefrLevel}

Candidate prompt:
${renderPrompt(input.candidate, "")}

Existing prompts in this cell:
${existing}`;
}
