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
} from '@language-drill/ai';
import type { CefrLevel, GrammarPoint, LearningLanguage } from '@language-drill/shared';

import type { Db } from '../client';
import { loadFrequencyBand } from '../generation/vocab-band';
import { vocabLemma } from '../schema/index';
import type { NewVocabTarget } from '../schema/vocab';
import { deriveTier, validateProposedWord, type ProposedWord } from './validate';

const LANGUAGE_NAME: Record<LearningLanguage, string> = {
  ES: 'Spanish',
  DE: 'German',
  TR: 'Turkish',
};

/** Max anchor lemmas fed to the model as frequency inspiration. */
const ANCHOR_WORD_LIMIT = 40;

export type RunOneUmbrellaDeps = {
  db: Db;
  client: Pick<Anthropic, 'messages'>;
  umbrella: GrammarPoint;
  wordCount: number;
  avoidWords: readonly string[];
};

export type RunOneUmbrellaResult = {
  rows: NewVocabTarget[];
  rawCount: number;
  keptCount: number;
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

  const system = VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE.replace(
    /\{\{languageName\}\}/g,
    LANGUAGE_NAME[language],
  )
    .replace(/\{\{cefrLevel\}\}/g, cefr)
    .replace(/\{\{umbrellaName\}\}/g, umbrella.name)
    .replace(/\{\{umbrellaDescription\}\}/g, umbrella.description)
    .replace(/\{\{wordCount\}\}/g, String(wordCount));

  const user = buildVocabTargetUserPrompt({
    umbrellaName: umbrella.name,
    umbrellaDescription: umbrella.description,
    wordCount,
    freqAnchorWords,
    avoidWords,
  });

  const msg = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const raw = parseWords(extractText(msg as Anthropic.Messages.Message));
  const valid: ProposedWord[] = raw
    .map((w) => validateProposedWord(w))
    .filter((w): w is ProposedWord => w !== null);

  // De-dup within this batch and against the avoid-list (case-insensitive);
  // stricter than the DB's case-sensitive unique index, by design.
  const avoid = new Set(avoidWords.map((w) => w.toLowerCase()));
  const seen = new Set<string>();
  const deduped = valid.filter((w) => {
    const k = w.lemma.toLowerCase();
    if (avoid.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

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
    };
  });

  return { rows: targetRows, rawCount: raw.length, keptCount: targetRows.length };
}
