/**
 * Prompts for the curated vocab-target authoring pipeline (ES A1 pilot).
 * The model proposes learner-facing words for one curriculum vocab umbrella,
 * anchored on the umbrella metadata + a frequency band from vocab_lemma.
 * See docs/superpowers/specs/2026-07-09-vocab-coverage-hub-design.md.
 */

// 2026-10-17: word classes. The list was ~80% nouns: the prompt asked for
// "concrete" words, banned multi-word items and showed only a noun example,
// and the structural validator dropped verbs whose example sentence was
// conjugated. Each word now carries "pos", the requested mix (or class
// restriction) rides in the user prompt, fixed expressions up to 4 words are
// allowed, and the example must contain the citation form verbatim (relaxed
// 2026-10-18a, below).
//
// 2026-10-18: the word-class-group request line said "the topic is the word
// class itself — any level-appropriate word of that class qualifies", which
// licensed off-topic words for narrow groups ("Verbs with prepositions",
// "Case-governed verbs"). It now requires the declared class AND a fit with
// the umbrella description. The avoid list now tags each word with its class
// ("yemek (noun)"), so a homograph of another class (the verb "yemek") is no
// longer blocked.
//
// 2026-10-18a: examples must be grammatical with the word inflected as the
// sentence needs. Asking for the citation form verbatim produced
// "*No quiero arrepentirse" / "*Me alegro de alegrarse de" on the first
// prepositional-verb run; the validator now accepts a verb/adjective on its stem.
// Irregular / stem-changing verbs ("voy", "puedo", "me acuesto") never show
// their stem, so the prompt asks for the infinitive after a modal for those.
export const VOCAB_TARGET_GENERATION_PROMPT_VERSION =
  'vocab-target-generate@2026-10-18a';

export const VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE = `You are a lexicographer building a curated vocabulary list for {{languageName}} learners at CEFR {{cefrLevel}}.

Your task: propose exactly {{wordCount}} of the most useful words for the topic "{{umbrellaName}}" ({{umbrellaDescription}}).

Rules:
- Words MUST be squarely on-topic for "{{umbrellaName}}" and appropriate for CEFR {{cefrLevel}}: high-frequency words a learner needs to TALK about the topic — the things, but also the actions, qualities and set expressions.
- "pos" is one of: noun, verb, adjective, adverb, phrase, other ("other" = conjunctions, interjections and similar).
- "lemma" is the citation form. Nouns: bare singular, no article. Verbs: the infinitive, keeping a reflexive pronoun or governed preposition that belongs to the verb ("levantarse", "acordarse de", "sich freuen auf", "futbol oynamak"). Adjectives: the dictionary form (Spanish masculine singular, German uninflected). Phrases: the whole fixed expression ("de vez en cuando", "iyi ki").
- "displayForm" is how a learner sees it: nouns include their article where the language has one ("la manzana", "der Apfel"); for every other class it is identical to "lemma".
- Multi-word items are allowed ONLY as fixed expressions (pos "phrase") or verbs with their pronoun/preposition (pos "verb"), at most 4 words. No free combinations ("red apple").
- "gloss" is a 1-4 word English meaning. "exampleSentence" is one short, natural, fully grammatical {{languageName}} sentence that uses the word exactly once, inflected as the sentence requires: conjugate verbs and make reflexive pronouns agree with the subject ("No quiero arrepentirme.", "Me levanto a las siete.", "Ich freue mich auf den Urlaub."), make adjectives agree ("una casa blanca"). Never force the dictionary form where the grammar needs another form ("*No quiero arrepentirse" is wrong). Keep the word's stem recognisable: prefer a form that starts with the lemma's stem (for Turkish, a form that keeps the verb stem, e.g. "Okula gitmek istiyorum." rather than "gidiyorum"). For an irregular or stem-changing verb (ir, ser, hacer, poder, volver, acostarse; sein, gehen), use the infinitive after a modal or "ir a" / "möchten" ("Voy a hacer la tarea.", "Quiero acostarme pronto.", "Ich möchte nach Hause gehen.").
- No proper nouns, no duplicates. Prefer the words a learner at this level most needs first.

Return ONLY minified JSON: {"words":[{"displayForm":"...","lemma":"...","pos":"...","gloss":"...","exampleSentence":"..."}]}`;

export type VocabTargetRequest =
  | { kind: 'themed' }
  | { kind: 'only'; verb: number; adjectiveOrAdverb: number }
  | { kind: 'group'; pos: readonly string[] };

/**
 * An already-listed word. With a `pos` it blocks only that class, so a
 * homograph of another class (the verb "yemek" beside the noun) stays open;
 * a bare string or a null `pos` blocks the lemma in every class.
 */
export type VocabAvoidWord = string | { lemma: string; pos: string | null };

export type VocabTargetUserPromptInput = {
  umbrellaName: string;
  umbrellaDescription: string;
  wordCount: number;
  freqAnchorWords: readonly string[];
  avoidWords: readonly VocabAvoidWord[];
  request: VocabTargetRequest;
};

function formatAvoidWord(w: VocabAvoidWord): string {
  if (typeof w === 'string') return w;
  return w.pos ? `${w.lemma} (${w.pos})` : w.lemma;
}

function requestLine(request: VocabTargetRequest): string {
  switch (request.kind) {
    case 'themed':
      return 'Word-class mix: at most 60% nouns, at least 20% verbs, at least 15% adjectives or adverbs, and at most 10% fixed phrases.';
    case 'only': {
      const parts: string[] = [];
      if (request.verb > 0) parts.push(`${request.verb} verbs`);
      if (request.adjectiveOrAdverb > 0) parts.push(`${request.adjectiveOrAdverb} adjectives or adverbs`);
      return `Propose exactly ${parts.join(' and ')}. No nouns.`;
    }
    case 'group':
      return `Every word MUST be one of: ${request.pos.join(', ')}, AND fit the topic description above — when it names a narrower set (verbs that govern a stated preposition or case, verbs of movement), every word must belong to that set, not merely to the class.`;
  }
}

export function buildVocabTargetUserPrompt(
  input: VocabTargetUserPromptInput,
): string {
  const anchor =
    input.freqAnchorWords.length > 0
      ? `High-frequency candidate lemmas from our corpus (use as inspiration, not a hard constraint): ${input.freqAnchorWords.join(', ')}.`
      : '';
  const classTagged = input.avoidWords.some((w) => typeof w !== 'string' && w.pos);
  const avoid =
    input.avoidWords.length > 0
      ? `Do NOT propose any of these already-listed words: ${input.avoidWords.map(formatAvoidWord).join(', ')}.` +
        (classTagged
          ? ' A class in parentheses blocks only that class: the same lemma as a different class (e.g. the verb of a listed noun) is allowed; an untagged word is blocked in every class.'
          : '')
      : '';
  return [
    `Topic: ${input.umbrellaName}`,
    input.umbrellaDescription,
    requestLine(input.request),
    anchor,
    avoid,
    `Propose ${input.wordCount} words as JSON {"words":[...]}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
