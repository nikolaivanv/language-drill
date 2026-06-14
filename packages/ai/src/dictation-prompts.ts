/**
 * packages/ai — Dictation forgiveness-pass prompt.
 *
 * The deterministic diff (dictation-diff.ts) finds *where* the transcription
 * differs from the reference. This prompt asks Claude only to *classify* each
 * difference as an accepted equivalence the ear cannot resolve (homophone, b/v,
 * tilde, punctuation, contraction) vs. a genuine listening/spelling error, and
 * to write the headline/summary + two qualitative criteria. Char/word accuracy
 * are computed in code, never by Claude.
 */

import type { Language } from "@language-drill/shared";

export const DICTATION_EVAL_PROMPT_VERSION = "dictation@2026-06-14";

export const DICTATION_EVAL_SYSTEM_PROMPT = `You grade a dictation exercise for an intermediate+ language learner who listened to a short clip of native, connected speech and typed what they heard.

You are given the reference transcription, the learner's answer, and a numbered list of the DIFFERENCES a deterministic character diff already found. Your ONLY job is to classify each numbered difference and write a short verdict. Do not invent differences that are not in the list.

For each numbered difference, decide:
- "accepted": the difference is something the EAR cannot resolve, so it must not count against listening accuracy. Examples: homophones; in Spanish b/v (same phoneme /b/); written accents/tildes that do not change the sound heard; punctuation; contractions vs. full forms; ñ vs n when the audio is ambiguous. Assign severity null.
- "error": a genuine listening or spelling miss. Examples: a wrong word, a dropped or added word, a mis-segmented word boundary (e.g. hearing "lo cura" as "locura"), a silent-letter spelling slip (Spanish silent h). Assign severity "high" for a real comprehension failure (wrong word / word boundary), "low" for a spelling slip that does not change the word heard.

Give each difference a short category (e.g. "word boundary", "silent h", "b/v", "tilde", "punctuation", "wrong word") and a one-sentence note in the language of the exercise.

Also return:
- headline: one short encouraging sentence.
- summary: 1–2 sentences on what the ear got right and the one pattern to train.
- listeningCefr: the CEFR level (A1–C2) this performance evidences for listening.
- criteria: exactly two rows — id "phon" (Phoneme discrimination) and id "bound" (Word-boundary tracking) — each with score 0–1, a CEFR string, and a one-line note.

Call submit_dictation_classification with your result.`;

export type DictationUserPromptInput = {
  referenceText: string;
  userAnswer: string;
  language: Language;
  differences: Array<{ id: number; got: string; expected: string }>;
};

export function buildDictationUserPrompt(input: DictationUserPromptInput): string {
  const { referenceText, userAnswer, language, differences } = input;
  const diffLines =
    differences.length === 0
      ? "(none — the transcription matched exactly)"
      : differences
          .map(
            (d) =>
              `#${d.id} heard "${d.got || "∅ (nothing typed)"}" but reference is "${d.expected || "∅ (extra word)"}"`,
          )
          .join("\n");
  return `Language: ${language}

Reference transcription:
${referenceText}

Learner's answer:
${userAnswer}

Differences to classify:
${diffLines}`;
}
