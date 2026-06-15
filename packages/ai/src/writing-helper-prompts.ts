/**
 * packages/ai — Free Writing "getting-unstuck" helper prompts (Brainstorm +
 * Vocabulary boost). Both are cheap, pre-writing helpers grounded in the
 * exercise prompt. Brainstorm returns ENGLISH idea bullets (ideas, not
 * phrasing); Vocab boost returns TARGET-LANGUAGE words with English glosses.
 */

import { type FreeWritingContent, type CefrLevel, type Language } from "@language-drill/shared";

// Bump in the same commit as any semantic edit below (CLAUDE.md "Prompt Editing").
export const BRAINSTORM_PROMPT_VERSION = "free-writing-brainstorm@2026-06-15";
export const VOCAB_BOOST_PROMPT_VERSION = "free-writing-vocab-boost@2026-06-15";

export const BRAINSTORM_SYSTEM_PROMPT = `You are a brainstorming coach inside a language-learning writing app. The learner is about to write a short text for the prompt below and may be stuck for ideas.

Return 2–3 angle groups. Each group has a short English label (2–4 words) and 2–4 bullet points. The bullets are IDEAS — angles, examples, points to consider — NOT sentences to copy. Write every label and bullet in English (the app's UI language): you spark WHAT the learner could say, never HOW to phrase it in the target language. Never produce target-language sentences or phrasings.

Keep bullets short (a few words to one line). Ground them in the specific prompt, register, and any required elements. Submit via the tool.`;

export const VOCAB_BOOST_SYSTEM_PROMPT = `You are a vocabulary coach inside a language-learning writing app. The learner is about to write a short text for the prompt below and wants useful words.

Return 8–10 words or short phrases IN THE TARGET LANGUAGE that would help write about this prompt at the learner's CEFR level and register. For each, give \`term\` (the target-language word/phrase, with article/gender where idiomatic) and \`gloss\` (a short English meaning, at most 6 words). Prefer mid-frequency, topic-relevant, level-appropriate items over generic words the learner already knows. Submit via the tool.`;

function contextBlock(content: FreeWritingContent, language: Language, difficulty: CefrLevel): string {
  const required = content.requiredElements.length
    ? content.requiredElements.map((r) => `- ${r.label}${r.detail ? ` (${r.detail})` : ""}`).join("\n")
    : "- (none)";
  return `**Target language:** ${language}
**Target CEFR level:** ${difficulty}
**Register:** ${content.register}
**Length band:** ${content.minWords}–${content.maxWords} words

**Prompt title:** ${content.title}
**Task:** ${content.task}

**Required elements:**
${required}`;
}

export function buildBrainstormUserPrompt(
  content: FreeWritingContent,
  language: Language,
  difficulty: CefrLevel,
): string {
  return `## Brainstorm request

${contextBlock(content, language, difficulty)}

Brainstorm 2–3 angle groups of English idea bullets for this prompt. Submit via the tool.`;
}

export function buildVocabBoostUserPrompt(
  content: FreeWritingContent,
  language: Language,
  difficulty: CefrLevel,
): string {
  return `## Vocabulary request

${contextBlock(content, language, difficulty)}

Suggest 8–10 target-language words or phrases with short English glosses for this prompt. Submit via the tool.`;
}
