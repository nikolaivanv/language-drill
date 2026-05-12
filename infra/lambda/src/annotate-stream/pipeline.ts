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
 * descending and take 40 (the empirical worst-case budget for the 8192-
 * token enrichment call — see PR #49). `effectiveRank` is stripped from the
 * returned shape; the SSE wire only carries `matchedForm` + `lemma`.
 *
 * Requirements: 1.1, 1.4, 1.5, 1.6, 1.8, 2.1–2.5.
 */

import { and, eq } from "drizzle-orm";
import {
  CefrLevel,
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
 * Defense in depth: even with annotation on Haiku 4.5 (PR #100 — 2–3× faster
 * streaming than Sonnet), 20 entries × ~175 tokens ≈ 3500 output tokens fits
 * comfortably under both `max_tokens` and the 29 s ceiling. The handler also
 * runs a 25 s soft-deadline that emits a useful `error` frame before the
 * runtime would kill us — so this cap is the "make most requests fast"
 * lever, with the soft-deadline as the "make rare overruns surface
 * gracefully" lever.
 */
const CANDIDATE_LIMIT = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Candidate = {
  matchedForm: string;
  lemma: string | null;
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
  type Survivor = Candidate & { effectiveRank: number };
  const survivors: Survivor[] = [];

  for (const token of tokenize(text)) {
    if (token.kind !== "word") continue;
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

  // ---- Rarest-first cap (Req 2.4) ----
  // Stable sort by `effectiveRank` descending. Ties keep first-seen order
  // since survivors was built in pre-filter (i.e. token) order — Array.sort
  // is stable in modern V8/Node.
  afterVocab.sort((a, b) => b.effectiveRank - a.effectiveRank);
  const capped = afterVocab.slice(0, CANDIDATE_LIMIT);

  // Strip `effectiveRank` — the SSE wire shape carries only matchedForm + lemma.
  const candidates: Candidate[] = capped.map((c) => ({
    matchedForm: c.matchedForm,
    lemma: c.lemma,
  }));

  return { candidates, calibration };
}
