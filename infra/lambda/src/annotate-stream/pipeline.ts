/**
 * Candidate-list pipeline for the streaming-annotate Lambda.
 *
 * Phase 1: pre-filter (server-side, ~50 ms). The passage is tokenized and
 * the per-language frequency dictionary drops anything at or below the
 * user's CEFR ceiling. Unknown-to-corpus words pass through with a
 * synthesized rank just above the ceiling (so they survive but never crowd
 * out actually-rare known words).
 *
 * Phase 2: post-filter (server-side, ~30 ms). The user's saved vocabulary
 * for the active language is fetched in parallel with the proficiency
 * lookup. Any candidate whose `lemma` or surface form is already in
 * `user_vocabulary` is dropped — saving a word means "I know it now."
 *
 * Phase 3: rarest-first cap. After post-filter we sort by `effectiveRank`
 * descending and take CANDIDATE_LIMIT (50 — see the constant for the
 * slim-card latency rationale). `effectiveRank` is retained on the returned
 * candidates (the handler uses it to populate `WordFlag.freq` on cache
 * hits with the authoritative server rank) even though the SSE wire only
 * echoes `matchedForm` + `lemma` back to the client.
 *
 * For ES/TR the pre-filter also drops capitalized non-sentence-initial tokens
 * as likely proper nouns before candidate selection (Req 2.2); German is
 * excluded because it capitalizes all nouns (Req 2.3).
 *
 * Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.8, 2.1–2.5.
 */

import { and, eq } from "drizzle-orm";
import {
  CefrLevel,
  Language,
  READ_CEFR_TOP_RANK,
  tokenize,
} from "@language-drill/shared";
import type { LearningLanguage } from "@language-drill/shared";
import { loadFrequency } from "@language-drill/ai";
import { userLanguageProfiles, userVocabulary } from "@language-drill/db";

import { db } from "../db";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PROFICIENCY_LEVEL = CefrLevel.B1;
const CEFR_LEVELS = new Set<string>(Object.values(CefrLevel));

/**
 * Cap chosen against the Lambda 29 s wall-clock budget, NOT the model's
 * `max_tokens` budget. PR #49 originally picked 40 against `max_tokens:
 * 8192` and missed that latency was the real constraint — a 40-entry
 * Sonnet call ran the full 29 s and timed out in production (PR #100).
 *
 * Raised 20 → 50 for Reading Deep Annotation: the skim card was slimmed
 * (dropped `example`), so each entry now emits ~30 output tokens instead of
 * ~175. 50 slim entries ≈ 1500 output tokens — *fewer* than the old 20 full
 * entries (~3500). Since wall-clock on Haiku 4.5 is dominated by output-token
 * streaming, the higher cap is faster than today's, not slower, so it does
 * not regress the latency budgets in
 * docs/perf/more-responsive-reading-2026-05-12.md. The handler's 25 s
 * soft-deadline remains the backstop; lower this cap if time-to-done
 * regresses empirically.
 */
const CANDIDATE_LIMIT = 50;

/**
 * Languages where a capitalized, non-sentence-initial token is a strong
 * proper-noun signal, so we drop it before it costs a Claude enrichment slot
 * (Req 2.2). German is deliberately excluded: it capitalizes ALL nouns, so
 * capitalization carries no proper-noun information there (Req 2.3) — German
 * relies on the model's POS judgment plus the server-side PROPN drop instead.
 */
const CAPITALIZATION_PROPN_LANGUAGES = new Set<LearningLanguage>([
  Language.ES,
  Language.TR,
]);

/** A separator run resets the next word to sentence-initial when it ends a sentence. */
const SENTENCE_END_RE = /[.!?]/;

/** First character is an uppercase letter (Unicode-aware: handles İ, Ü, Ñ, …). */
const UPPERCASE_START_RE = /^\p{Lu}/u;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Candidate = {
  matchedForm: string;
  lemma: string | null;
  effectiveRank: number;
};

export type Calibration = {
  cefr: CefrLevel;
  top: number;
};

export type BuildCandidateListInput = {
  userId: string;
  language: LearningLanguage;
  text: string;
};

export type BuildCandidateListResult = {
  candidates: Candidate[];
  calibration: Calibration;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCefrLevel(value: string | null | undefined): value is CefrLevel {
  return typeof value === "string" && CEFR_LEVELS.has(value);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function buildCandidateList(
  input: BuildCandidateListInput,
): Promise<BuildCandidateListResult> {
  const { userId, language, text } = input;

  // Parallel DB reads (Req 2.3): the proficiency lookup gates the rank
  // threshold; the vocab lookup gates the post-filter. Both must complete
  // before any candidate is finalised.
  //
  // The vocab query is wrapped in `.catch` so a transient Postgres error
  // degrades to "no post-filter" instead of failing the whole request —
  // mirrors the design's Error Handling row "Vocab query fails". The user
  // sees an honest candidate list (possibly including words they've already
  // saved) rather than a 500.
  const [profileRows, vocabRows] = await Promise.all([
    db
      .select({ proficiencyLevel: userLanguageProfiles.proficiencyLevel })
      .from(userLanguageProfiles)
      .where(
        and(
          eq(userLanguageProfiles.userId, userId),
          eq(userLanguageProfiles.language, language),
        ),
      )
      .limit(1),
    db
      .select({ word: userVocabulary.word, lemma: userVocabulary.lemma })
      .from(userVocabulary)
      .where(
        and(
          eq(userVocabulary.userId, userId),
          eq(userVocabulary.language, language),
        ),
      )
      .catch((err: unknown) => {
        console.error("[annotate-stream] vocab query failed", err);
        return [] as Array<{ word: string; lemma: string }>;
      }),
  ]);

  const proficiencyLevel = isCefrLevel(profileRows[0]?.proficiencyLevel)
    ? profileRows[0].proficiencyLevel
    : DEFAULT_PROFICIENCY_LEVEL;
  const topRank = READ_CEFR_TOP_RANK[proficiencyLevel];
  const calibration: Calibration = { cefr: proficiencyLevel, top: topRank };

  const freq = loadFrequency(language);

  // ---- Pre-filter: tokenize → dedupe → rank-gate (Req 1.1, 1.4, 1.5) ----
  const seen = new Set<string>();
  const survivors: Candidate[] = [];

  // Proper-noun pre-filter state (Req 2.2/2.3). `atSentenceStart` tracks
  // whether the next word token begins a sentence so a sentence-initial
  // capital (which every language uses) is never mistaken for a proper noun.
  const applyCapRule = CAPITALIZATION_PROPN_LANGUAGES.has(language);
  let atSentenceStart = true;

  for (const token of tokenize(text)) {
    if (token.kind !== "word") {
      // Separators don't enter the candidate set, but one ending in .!? marks
      // the next word as sentence-initial.
      if (SENTENCE_END_RE.test(token.raw)) atSentenceStart = true;
      continue;
    }

    const sentenceInitial = atSentenceStart;
    atSentenceStart = false;

    // Drop ES/TR capitalized non-sentence-initial tokens as likely proper
    // nouns (Req 2.2). Not added to `seen`, so a later lowercase occurrence of
    // the same form can still qualify as a candidate.
    if (applyCapRule && !sentenceInitial && UPPERCASE_START_RE.test(token.raw)) {
      continue;
    }

    const key = token.key;
    if (key === "") continue;
    if (seen.has(key)) continue;
    seen.add(key);

    if (freq.isStopword(key)) continue;

    const entry = freq.lookup(key);
    // Known and in-level → drop. Unknown words have entry === null and
    // pass through (Req 1.5: unknown-to-corpus forms become candidates).
    if (entry !== null && entry.rank <= topRank) continue;

    survivors.push({
      matchedForm: key,
      lemma: entry?.lemma ?? null,
      // Demote unknowns to `topRank + 1` so known rare words (rank > topRank+1)
      // always rank ahead of them in the rarest-first sort below.
      effectiveRank: entry?.rank ?? topRank + 1,
    });
  }

  if (survivors.length === 0) {
    return { candidates: [], calibration };
  }

  // ---- Post-filter: drop anything already in user_vocabulary (Req 2.1) ----
  const vocabKeys = new Set<string>();
  for (const row of vocabRows) {
    vocabKeys.add(row.word);
    vocabKeys.add(row.lemma);
  }
  const afterVocab = survivors.filter(
    (c) =>
      !vocabKeys.has(c.matchedForm) &&
      (c.lemma === null || !vocabKeys.has(c.lemma)),
  );

  // Rarest-first cap (Req 2.4). Stable sort by `effectiveRank` descending —
  // ties keep first-seen order since survivors was built in pre-filter (i.e.
  // token) order, and Array.sort is stable in modern V8/Node. `effectiveRank`
  // is retained on the returned candidates so the handler can populate
  // WordFlag.freq for cache hits from the authoritative server rank.
  afterVocab.sort((a, b) => b.effectiveRank - a.effectiveRank);
  const candidates: Candidate[] = afterVocab.slice(0, CANDIDATE_LIMIT);

  return { candidates, calibration };
}
