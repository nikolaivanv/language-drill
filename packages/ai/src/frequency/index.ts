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

// Cache the computed `frequencyBand` result per `(language, rankMin, rankMax)`.
// The scan-dedupe-sort below is O(file) per band; caching makes repeated calls
// for the same band (every ordinal in a cell) return the identical frozen
// instance — mirroring `LOOKUP_CACHE`.
const BAND_CACHE: Map<string, readonly string[]> = new Map();

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

/**
 * Returns the content-word **lemmas** whose frequency rank falls inside the
 * `[rankMin, rankMax]` band (inclusive), for use as deterministic generation
 * seeds (R5.1, R5.2). The frequency files are keyed by *surface form* and are
 * not pre-sorted, and many surfaces share one lemma+rank — so this:
 *   1. scans the file once,
 *   2. drops closed-class words via the stopword list (either the surface key
 *      or the lemma matching a stopword excludes the entry),
 *   3. dedupes by lemma (keeping the lowest rank seen),
 *   4. restricts to the rank window,
 *   5. sorts by rank ascending (lemma as a deterministic tie-break),
 * and caches the frozen result per `(language, band)` so repeated calls for the
 * same band return the identical instance.
 */
export function frequencyBand(
  language: LearningLanguage,
  rankMin: number,
  rankMax: number,
): readonly string[] {
  const cacheKey = `${language}:${rankMin}:${rankMax}`;
  const cached = BAND_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;

  const freqMap = FREQUENCY_BY_LANGUAGE[language];
  const stopwordSet = STOPWORDS_BY_LANGUAGE[language];

  // lemma -> lowest rank seen for it within the window
  const byLemma = new Map<string, number>();
  for (const [surface, entry] of Object.entries(freqMap)) {
    if (entry.rank < rankMin || entry.rank > rankMax) continue;
    if (stopwordSet.has(surface) || stopwordSet.has(entry.lemma)) continue;
    const existing = byLemma.get(entry.lemma);
    if (existing === undefined || entry.rank < existing) {
      byLemma.set(entry.lemma, entry.rank);
    }
  }

  const band = Object.freeze(
    [...byLemma.entries()]
      .sort(([lemmaA, rankA], [lemmaB, rankB]) =>
        rankA !== rankB ? rankA - rankB : lemmaA < lemmaB ? -1 : lemmaA > lemmaB ? 1 : 0,
      )
      .map(([lemma]) => lemma),
  );

  BAND_CACHE.set(cacheKey, band);
  return band;
}

// ---------------------------------------------------------------------------
// Verb detection (TEMPORARY — see
// docs/superpowers/specs/2026-06-19-es-conjugation-verb-seeding-design.md).
// The frequency files carry no part-of-speech, so verbs are inferred from
// surface morphology: an infinitive-suffix match PLUS an inflection-count
// floor (verbs inflect across person/tense/mood → many surface forms; nouns
// have ~2: singular + plural). Collapses to a `pos === 'verb'` filter once the
// vocab file gains a `pos` field. ES-only for now.
// ---------------------------------------------------------------------------

const VERB_SUFFIXES_BY_LANGUAGE: Partial<Record<LearningLanguage, readonly string[]>> = {
  [Language.ES]: ["ar", "er", "ir"],
};

// A lemma must map to at least this many distinct surface forms (of length ≥ 4)
// to count as a verb. Tuned against es.json: nouns top out at ~2 (sg+pl);
// verbs have many. The ≥ 4-char length gate filters corpus noise — foreign words
// and very short accidentals that the lemmatiser wrongly collapses under a
// 3-letter lemma (e.g. "mar": surfaces include "man", "mars" which aren't Spanish
// verb conjugations). Final value: 4.
const MIN_VERB_SURFACES = 4;
// Minimum character length a surface must have to be counted towards
// MIN_VERB_SURFACES. Filters corpus noise without discarding real conjugations.
const MIN_SURFACE_LEN = 4;

type VerbStat = { minRank: number; surfaces: number };

// lemma -> { minRank, surface count } over the WHOLE file. A verb's surfaces
// span many ranks (most fall outside any one band), so this scan is global,
// not windowed; the band filter below uses `minRank`. Cached per language.
const VERB_STATS_CACHE: Partial<Record<LearningLanguage, ReadonlyMap<string, VerbStat>>> = {};

function verbStats(language: LearningLanguage): ReadonlyMap<string, VerbStat> {
  const cached = VERB_STATS_CACHE[language];
  if (cached !== undefined) return cached;

  const freqMap = FREQUENCY_BY_LANGUAGE[language];
  const acc = new Map<string, { minRank: number; surfaces: Set<string> }>();
  for (const [surface, entry] of Object.entries(freqMap)) {
    const cur = acc.get(entry.lemma);
    if (cur === undefined) {
      acc.set(entry.lemma, {
        minRank: entry.rank,
        surfaces: surface.length >= MIN_SURFACE_LEN ? new Set([surface]) : new Set(),
      });
    } else {
      if (surface.length >= MIN_SURFACE_LEN) cur.surfaces.add(surface);
      if (entry.rank < cur.minRank) cur.minRank = entry.rank;
    }
  }
  const out = new Map<string, VerbStat>();
  for (const [lemma, s] of acc) out.set(lemma, { minRank: s.minRank, surfaces: s.surfaces.size });
  VERB_STATS_CACHE[language] = out;
  return out;
}

const VERB_BAND_CACHE = new Map<string, readonly string[]>();
const EMPTY_BAND: readonly string[] = Object.freeze([]);

/**
 * Verb lemmas whose minimum frequency rank falls in `[rankMin, rankMax]`
 * (inclusive), sorted by rank asc with lemma tie-break, cached per
 * `(language, band)`. A lemma qualifies as a verb when its infinitive suffix
 * matches the language AND it has at least `MIN_VERB_SURFACES` distinct surface
 * forms. Returns the empty band for languages without a verb config.
 */
export function verbBand(
  language: LearningLanguage,
  rankMin: number,
  rankMax: number,
): readonly string[] {
  const suffixes = VERB_SUFFIXES_BY_LANGUAGE[language];
  if (suffixes === undefined) return EMPTY_BAND;

  const cacheKey = `${language}:${rankMin}:${rankMax}`;
  const cached = VERB_BAND_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;

  const stopwordSet = STOPWORDS_BY_LANGUAGE[language];
  const stats = verbStats(language);

  const picked: { lemma: string; rank: number }[] = [];
  for (const [lemma, s] of stats) {
    if (s.minRank < rankMin || s.minRank > rankMax) continue;
    if (s.surfaces < MIN_VERB_SURFACES) continue;
    if (stopwordSet.has(lemma)) continue;
    if (!suffixes.some((suf) => lemma.endsWith(suf))) continue;
    picked.push({ lemma, rank: s.minRank });
  }

  const band = Object.freeze(
    picked
      .sort((a, b) =>
        a.rank !== b.rank ? a.rank - b.rank : a.lemma < b.lemma ? -1 : a.lemma > b.lemma ? 1 : 0,
      )
      .map((p) => p.lemma),
  );

  VERB_BAND_CACHE.set(cacheKey, band);
  return band;
}
