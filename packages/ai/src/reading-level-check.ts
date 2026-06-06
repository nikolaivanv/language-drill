import {
  CefrLevel,
  READ_CEFR_TOP_RANK,
  READING_TOO_HARD_THRESHOLD,
  tokenize,
} from "@language-drill/shared";
import type { LearningLanguage } from "@language-drill/shared";
import { loadFrequency } from "./frequency/index.js";

export type ScoreTextLevelInput = {
  language: LearningLanguage;
  cefr: CefrLevel;
  text: string;
};

export type TextLevelScore = {
  /** Fraction of content words above the target CEFR band, in [0,1]. */
  aboveLevelFraction: number;
  /** True when aboveLevelFraction exceeds READING_TOO_HARD_THRESHOLD. */
  tooHard: boolean;
  /** Count of content (non-stopword) word tokens considered. */
  contentWordCount: number;
};

/**
 * Deterministic, zero-cost lexical difficulty check. Mirrors the rank-gate in
 * the annotate pipeline: stopwords are ignored; a content word is "above level"
 * if it is unknown to the frequency corpus or ranks beyond the CEFR ceiling.
 */
export function scoreTextLevel(input: ScoreTextLevelInput): TextLevelScore {
  const { language, cefr, text } = input;
  const topRank = READ_CEFR_TOP_RANK[cefr];
  const freq = loadFrequency(language);

  let contentWordCount = 0;
  let aboveLevel = 0;

  for (const token of tokenize(text)) {
    if (token.kind !== "word") continue;
    const key = token.key;
    if (key === "") continue;
    if (freq.isStopword(key)) continue;

    contentWordCount += 1;
    const entry = freq.lookup(key);
    if (entry === null || entry.rank > topRank) {
      aboveLevel += 1;
    }
  }

  const aboveLevelFraction =
    contentWordCount === 0 ? 0 : aboveLevel / contentWordCount;

  return {
    aboveLevelFraction,
    tooHard: aboveLevelFraction > READING_TOO_HARD_THRESHOLD,
    contentWordCount,
  };
}
