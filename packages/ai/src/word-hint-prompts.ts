import type { Language, CefrLevel } from "@language-drill/shared";

// Bump in the same commit as any semantic edit below (CLAUDE.md "Prompt Editing").
export const WORD_HINT_PROMPT_VERSION = "word-hint@2026-07-13";

export const WORD_HINT_SYSTEM_PROMPT = `You help a language learner who is translating an English sentence into a target language. You are given the English source, the reference target translation, and the target language.

Break the ENGLISH source sentence into an ordered list of units that, read in order, cover the whole sentence. For each unit decide whether it is a MEANINGFUL vocabulary hint:
- Group a multi-word expression into ONE unit when it translates as a unit (e.g. "account for", "give up").
- Mark articles, pronouns, auxiliaries, prepositions, and punctuation as hintable:false (no lemma).
- For hintable units, give the target-language DICTIONARY (base, uninflected) form the reference translation uses for that word — no case endings, no person/tense suffixes, lowercase. Use the reference translation to pick the correct sense.

Return the result via the tool only.`;

export function buildWordHintUserPrompt(opts: {
  sourceText: string;
  referenceTranslation: string;
  sourceLanguage: string;
  targetLanguage: Language;
}): string {
  return [
    `Source language: ${opts.sourceLanguage}`,
    `Target language: ${opts.targetLanguage}`,
    `English source: ${opts.sourceText}`,
    `Reference target translation: ${opts.referenceTranslation}`,
  ].join("\n");
}
