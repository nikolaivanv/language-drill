/**
 * Prompts for the curated vocab-target authoring pipeline (ES A1 pilot).
 * The model proposes learner-facing words for one curriculum vocab umbrella,
 * anchored on the umbrella metadata + a frequency band from vocab_lemma.
 * See docs/superpowers/specs/2026-07-09-vocab-coverage-hub-design.md.
 */

export const VOCAB_TARGET_GENERATION_PROMPT_VERSION =
  'vocab-target-generate@2026-07-09';

export const VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE = `You are a lexicographer building a curated vocabulary list for {{languageName}} learners at CEFR {{cefrLevel}}.

Your task: propose exactly {{wordCount}} of the most useful words for the topic "{{umbrellaName}}" ({{umbrellaDescription}}).

Rules:
- Words MUST be squarely on-topic for "{{umbrellaName}}" and appropriate for CEFR {{cefrLevel}} (high-frequency, concrete, everyday).
- "lemma" is the bare dictionary form (no article, singular, infinitive). "displayForm" is how a learner should see it (nouns include their article, e.g. "la manzana"; verbs are the infinitive).
- "gloss" is a 1-4 word English meaning. "exampleSentence" is one natural {{languageName}} sentence USING the word.
- No proper nouns, no multi-word phrases (single lexical items only), no duplicates.
- Prefer the words a beginner most needs first.

Return ONLY minified JSON: {"words":[{"displayForm":"...","lemma":"...","gloss":"...","exampleSentence":"..."}]}`;

export type VocabTargetUserPromptInput = {
  umbrellaName: string;
  umbrellaDescription: string;
  wordCount: number;
  freqAnchorWords: readonly string[];
  avoidWords: readonly string[];
};

export function buildVocabTargetUserPrompt(
  input: VocabTargetUserPromptInput,
): string {
  const anchor =
    input.freqAnchorWords.length > 0
      ? `High-frequency candidate lemmas from our corpus (use as inspiration, not a hard constraint): ${input.freqAnchorWords.join(', ')}.`
      : '';
  const avoid =
    input.avoidWords.length > 0
      ? `Do NOT propose any of these already-listed words: ${input.avoidWords.join(', ')}.`
      : '';
  return [
    `Topic: ${input.umbrellaName}`,
    input.umbrellaDescription,
    anchor,
    avoid,
    `Propose ${input.wordCount} words as JSON {"words":[...]}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
