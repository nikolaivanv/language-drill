/**
 * Per-umbrella orchestration for the curated vocab-target authoring pipeline:
 * propose words via Claude, structurally validate them (Task 3), join corpus
 * frequency from `vocab_lemma`, and return ready-to-insert `NewVocabTarget`
 * rows (`status:'flagged'`, `source:'llm'`) for human review.
 * See docs/superpowers/specs/2026-07-09-vocab-coverage-hub-design.md.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import {
  GENERATION_MODEL,
  VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE,
  buildVocabTargetUserPrompt,
  cefrRankWindow,
  type VocabAvoidWord,
  type VocabTargetRequest,
} from '@language-drill/ai';
import type { CefrLevel, GrammarPoint, LearningLanguage, VocabPos } from '@language-drill/shared';

import type { Db } from '../client';
import { loadFrequencyBand } from '../generation/vocab-band';
import { vocabLemma } from '../schema/index';
import type { NewVocabTarget } from '../schema/vocab';
import {
  countPos,
  emptyPosCounts,
  fitToMix,
  mixShortfall,
  planFillMixRequest,
  type PosCounts,
  type Shortfall,
} from './mix';
import { deriveTier, validateProposedWord, type ProposedWord } from './validate';

const LANGUAGE_NAME: Record<LearningLanguage, string> = {
  ES: 'Spanish',
  DE: 'German',
  TR: 'Turkish',
};

/** Max anchor lemmas fed to the model as frequency inspiration. */
const ANCHOR_WORD_LIMIT = 40;

/**
 * An already-curated word of the language. Dedup keys on (lemma, pos): a noun
 * does not block its verb homograph (TR "yemek", DE "Essen"/"essen"). A null
 * `pos` (legacy, untagged row) blocks every class, and so does any row of the
 * umbrella being authored — the unique index is (language, umbrella, lemma).
 */
export type AvoidWord = { lemma: string; pos: VocabPos | null; umbrellaKey?: string };

export type RunOneUmbrellaDeps = {
  db: Db;
  client: Pick<Anthropic, 'messages'>;
  umbrella: GrammarPoint;
  wordCount: number;
  avoidWords: readonly AvoidWord[];
  /** Class counts of the umbrella's existing (flagged + approved) rows. */
  existing?: PosCounts;
  /** Top up an existing themed umbrella with non-nouns only. */
  fillMix?: boolean;
};

const NON_NOUN: readonly VocabPos[] = ['verb', 'adjective', 'adverb', 'phrase'];
const FOLLOW_UP_POS: readonly VocabPos[] = ['verb', 'adjective', 'adverb'];

function addCounts(a: PosCounts, b: PosCounts): PosCounts {
  const c = emptyPosCounts();
  for (const p of Object.keys(c) as VocabPos[]) c[p] = a[p] + b[p];
  return c;
}

export type RunOneUmbrellaResult = {
  rows: NewVocabTarget[];
  rawCount: number;
  keptCount: number;
  followUp: boolean;
  remainingShortfall: Shortfall;
  /** True only for a fill-mix themed umbrella whose plan asked for nothing (no call made). */
  requestedNothing: boolean;
};

function extractText(msg: Anthropic.Messages.Message): string {
  const block = msg.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text : '';
}

function parseWords(text: string): unknown[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { words?: unknown };
    return Array.isArray(parsed.words) ? parsed.words : [];
  } catch {
    return [];
  }
}

export async function runOneUmbrella(
  deps: RunOneUmbrellaDeps,
): Promise<RunOneUmbrellaResult> {
  const { db, client, umbrella, wordCount, avoidWords } = deps;
  const language = umbrella.language as LearningLanguage;
  const cefr = umbrella.cefrLevel as CefrLevel;
  const { rankMin, rankMax } = cefrRankWindow(cefr);

  const anchorAll = await loadFrequencyBand(db, language, rankMin, rankMax);
  const freqAnchorWords = anchorAll.slice(0, ANCHOR_WORD_LIMIT);

  // Built per call so the system prompt's count always matches that call's request.
  const buildSystem = (count: number): string =>
    VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE.replace(
    /\{\{languageName\}\}/g,
    LANGUAGE_NAME[language],
  )
    .replace(/\{\{cefrLevel\}\}/g, cefr)
    .replace(/\{\{umbrellaName\}\}/g, umbrella.name)
    .replace(/\{\{umbrellaDescription\}\}/g, umbrella.description)
    .replace(/\{\{wordCount\}\}/g, String(count));

  // Case-insensitive throughout (stricter than the DB's case-sensitive unique
  // index, by design). `blockedLemma` blocks every class; `blockedPair` one.
  const blockedLemma = new Set<string>();
  const blockedPair = new Set<string>();
  const pairKey = (lemma: string, pos: VocabPos): string => `${lemma}\u0000${pos}`;
  const promptAvoid: VocabAvoidWord[] = [];
  for (const w of avoidWords) {
    const lk = w.lemma.toLowerCase();
    if (w.pos === null || w.umbrellaKey === umbrella.key) {
      blockedLemma.add(lk);
      promptAvoid.push({ lemma: w.lemma, pos: null });
    } else {
      blockedPair.add(pairKey(lk, w.pos));
      promptAvoid.push({ lemma: w.lemma, pos: w.pos });
    }
  }
  let rawCount = 0;

  // One Claude call -> validated words not yet seen. A kept word blocks its
  // lemma in every class: a later homograph would land in this same umbrella.
  async function propose(
    count: number,
    request: VocabTargetRequest,
    allowedPos: readonly VocabPos[] | undefined,
  ): Promise<ProposedWord[]> {
    const user = buildVocabTargetUserPrompt({
      umbrellaName: umbrella.name,
      umbrellaDescription: umbrella.description,
      wordCount: count,
      freqAnchorWords,
      avoidWords: promptAvoid,
      request,
    });
    const msg = await client.messages.create({
      model: GENERATION_MODEL,
      // 30 words with example sentences run to ~1,900 output tokens; 2000 truncated
      // the JSON (no words parsed) on 2 of 60 umbrellas in the 2026-10-18 run.
      max_tokens: 4000,
      system: buildSystem(count),
      messages: [{ role: 'user', content: user }],
    });
    const raw = parseWords(extractText(msg as Anthropic.Messages.Message));
    rawCount += raw.length;
    const out: ProposedWord[] = [];
    for (const w of raw) {
      const v = validateProposedWord(w, allowedPos);
      if (!v) continue;
      const lk = v.lemma.toLowerCase();
      if (blockedLemma.has(lk) || blockedPair.has(pairKey(lk, v.pos))) continue;
      blockedLemma.add(lk);
      promptAvoid.push({ lemma: v.lemma, pos: null });
      out.push(v);
    }
    return out;
  }

  const existing = deps.existing ?? emptyPosCounts();
  const existingTotal = Object.values(existing).reduce((n, x) => n + x, 0);
  const group = umbrella.vocabGroup;

  let deduped: ProposedWord[];
  let followUp = false;
  let requestedNothing = false;
  if (group) {
    deduped = await propose(wordCount, { kind: 'group', pos: group.pos }, group.pos);
  } else {
    let first: ProposedWord[];
    let nothingToAsk = false;
    if (deps.fillMix) {
      const plan = planFillMixRequest(existing, wordCount);
      // Nothing to ask for: no model call (an "exactly 0" request is meaningless).
      nothingToAsk = plan.verb + plan.adjectiveOrAdverb === 0;
      requestedNothing = nothingToAsk;
      // The plan can total more than wordCount (it grows to meet the quota at
      // the final size); the prompts must ask for what the plan says.
      first = nothingToAsk
        ? []
        : await propose(plan.verb + plan.adjectiveOrAdverb, { kind: 'only', ...plan }, NON_NOUN);
    } else {
      first = await propose(wordCount, { kind: 'themed' }, undefined);
    }
    let batch = first;
    const short = mixShortfall(addCounts(existing, countPos(batch)), existingTotal + batch.length);
    const moreCount = short.verb + short.adjectiveOrAdverb;
    if (moreCount > 0 && !nothingToAsk) {
      followUp = true;
      const more = await propose(moreCount, { kind: 'only', ...short }, FOLLOW_UP_POS);
      batch = [...batch, ...more];
    }
    deduped = fitToMix(existing, batch);
  }

  const remainingShortfall = group
    ? { verb: 0, adjectiveOrAdverb: 0 }
    : mixShortfall(addCounts(existing, countPos(deduped)), existingTotal + deduped.length);

  // Frequency-join: one query for all kept lemmas.
  const rankByLemma = new Map<string, number>();
  if (deduped.length > 0) {
    const rows = await db
      .select({ lemma: vocabLemma.lemma, rank: vocabLemma.rank })
      .from(vocabLemma)
      .where(
        and(
          eq(vocabLemma.language, language),
          inArray(
            vocabLemma.lemma,
            deduped.map((w) => w.lemma),
          ),
        ),
      );
    for (const r of rows) rankByLemma.set(r.lemma, r.rank);
  }

  const targetRows: NewVocabTarget[] = deduped.map((w) => {
    const freqRank = rankByLemma.get(w.lemma) ?? null;
    return {
      language,
      umbrellaKey: umbrella.key,
      cefrLevel: cefr,
      lemma: w.lemma,
      displayForm: w.displayForm,
      gloss: w.gloss,
      exampleSentence: w.exampleSentence,
      freqRank,
      tier: deriveTier(freqRank),
      status: 'flagged',
      source: 'llm',
      pos: w.pos,
    };
  });

  return {
    rows: targetRows,
    rawCount,
    keptCount: targetRows.length,
    followUp,
    remainingShortfall,
    requestedNothing,
  };
}
