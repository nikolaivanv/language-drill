// ---------------------------------------------------------------------------
// @language-drill/ai/frequency — per-language frequency-dictionary lookup
// ---------------------------------------------------------------------------
// Used by the streaming-annotate Lambda's pre-filter
// (more-responsive-reading spec Req 1.1, 1.2, 1.5). Surface forms are
// O(1)-looked-up against a JSON dictionary; closed-class words are O(1)-checked
// against a per-language Set of stopwords.
//
// The JSON files are imported as JS literals so esbuild inlines them into the
// Lambda bundle — no `fs.readFile` at runtime, no cold-start surprises. The
// build script (`packages/ai/scripts/build-frequency.ts`) is the canonical
// producer of the {es,de,tr}.json files; the stopword JSONs are hand-curated.
//
// Per the design's Error Handling row for "Frequency file load fails", any
// malformed JSON crashes the Lambda init rather than silently returning the
// wrong frequencies — the assertions below are the fast-fail guards.
// ---------------------------------------------------------------------------

import { type CefrLevel, Language, type LearningLanguage } from "@language-drill/shared";

import esFreq from "./es.json";
import deFreq from "./de.json";
import trFreq from "./tr.json";

import esStopwords from "./stopwords-es.json";
import deStopwords from "./stopwords-de.json";
import trStopwords from "./stopwords-tr.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FrequencyEntry = {
  lemma: string;
  rank: number;
  cefr?: CefrLevel;
};

export type FrequencyFile = Record<string /* lowercased surface form */, FrequencyEntry>;

export type FrequencyLookup = {
  /** Returns the entry for a lowercased surface form, or `null` if unknown. */
  lookup(form: string): FrequencyEntry | null;
  /** Returns true iff the form is a closed-class stopword for the language. */
  isStopword(form: string): boolean;
};

// ---------------------------------------------------------------------------
// Module-init guards — fail fast if any asset is malformed.
// ---------------------------------------------------------------------------

/**
 * Internal guard — fail fast if the per-language frequency JSON loaded into
 * the bundle is not an object. Exposed for unit tests; consumers should call
 * `loadFrequency` instead.
 * @internal
 */
export function assertFrequencyFile(language: LearningLanguage, value: unknown): FrequencyFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`[frequency] Malformed ${language} frequency JSON — expected an object`);
  }
  return value as FrequencyFile;
}

/**
 * Internal guard — fail fast if the per-language stopword JSON loaded into the
 * bundle is not an array. Exposed for unit tests; consumers should call
 * `loadFrequency` instead.
 * @internal
 */
export function assertStopwordList(language: LearningLanguage, value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`[frequency] Malformed ${language} stopword JSON — expected an array`);
  }
  return value as readonly string[];
}

// ---------------------------------------------------------------------------
// Per-language assets — built once at module init.
// ---------------------------------------------------------------------------

const FREQUENCY_BY_LANGUAGE: Record<LearningLanguage, FrequencyFile> = {
  [Language.ES]: assertFrequencyFile(Language.ES, esFreq),
  [Language.DE]: assertFrequencyFile(Language.DE, deFreq),
  [Language.TR]: assertFrequencyFile(Language.TR, trFreq),
};

const STOPWORDS_BY_LANGUAGE: Record<LearningLanguage, ReadonlySet<string>> = {
  [Language.ES]: new Set(assertStopwordList(Language.ES, esStopwords)),
  [Language.DE]: new Set(assertStopwordList(Language.DE, deStopwords)),
  [Language.TR]: new Set(assertStopwordList(Language.TR, trStopwords)),
};

// Cache the `FrequencyLookup` object per language so repeated calls return the
// same instance — cheap and lets callers safely close over the methods.
const LOOKUP_CACHE: Partial<Record<LearningLanguage, FrequencyLookup>> = {};

// ---------------------------------------------------------------------------
// CEFR → frequency-rank window (R5.2). Coarse, design-tunable proxy: the
// frequency `cefr` field is unpopulated, so word rank stands in for level. The
// windows are contiguous (A2 picks up where A1 leaves off); the shared boundary
// rank is harmless since the seed picker only consults one level's window per
// batch. Curriculum cells are A1–B2; C1/C2 extend the same pattern for totality.
// Distinct from `READ_CEFR_TOP_RANK` (a single ceiling for the reading
// pre-filter) — this is a [min, max] band, since seeds should sit AT the
// learner's level, not anywhere below it.
// ---------------------------------------------------------------------------

const CEFR_RANK_WINDOW = {
  A1: { rankMin: 1, rankMax: 1000 },
  A2: { rankMin: 1000, rankMax: 2500 },
  B1: { rankMin: 2500, rankMax: 5000 },
  B2: { rankMin: 5000, rankMax: 10000 },
  C1: { rankMin: 10000, rankMax: 20000 },
  C2: { rankMin: 20000, rankMax: 40000 },
} as const satisfies Record<CefrLevel, { rankMin: number; rankMax: number }>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function loadFrequency(language: LearningLanguage): FrequencyLookup {
  const cached = LOOKUP_CACHE[language];
  if (cached !== undefined) return cached;

  const freqMap = FREQUENCY_BY_LANGUAGE[language];
  const stopwordSet = STOPWORDS_BY_LANGUAGE[language];

  const lookup: FrequencyLookup = {
    lookup: (form) => {
      const entry = freqMap[form];
      return entry === undefined ? null : entry;
    },
    isStopword: (form) => stopwordSet.has(form),
  };

  LOOKUP_CACHE[language] = lookup;
  return lookup;
}

/**
 * The coarse `[rankMin, rankMax]` frequency-rank band that proxies a CEFR
 * level for seed-candidate selection (R5.2). Inclusive on both ends. Tunable
 * in one place — the seed picker is the only consumer.
 */
export function cefrRankWindow(cefr: CefrLevel): {
  rankMin: number;
  rankMax: number;
} {
  return CEFR_RANK_WINDOW[cefr];
}
