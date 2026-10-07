/**
 * Semantic dedup for free-writing generation. The dedup index keys on the
 * title, which let one essay question be reworded 5–10× in a cell under new
 * titles (#757). Before each free-writing INSERT the candidate is judged
 * against the cell's current prompts; the pool is re-read on every call so a
 * draft inserted earlier in the same batch is seen.
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  ZERO_USAGE,
  freeWritingSummary,
  judgeFreeWritingDuplicate,
  type ClaudeUsageBreakdown,
  type FreeWritingPromptSummary,
} from '@language-drill/ai';
import { and, eq, inArray } from 'drizzle-orm';

import type { Db } from '../client';
import { exercises } from '../schema/index';
import type { Cell } from './cells';

export const MAX_FW_PROMPTS_FOR_DEDUP = 60;

/** The cell's current free-writing prompts (approved, manual, flagged), summarized. */
export async function fetchFreeWritingPromptSummaries(
  db: Db,
  cell: Cell,
): Promise<FreeWritingPromptSummary[]> {
  const rows = await db
    .select({ contentJson: exercises.contentJson })
    .from(exercises)
    .where(
      and(
        eq(exercises.language, cell.language),
        eq(exercises.difficulty, cell.cefrLevel),
        eq(exercises.type, cell.exerciseType),
        eq(exercises.grammarPointKey, cell.grammarPoint.key),
        inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved', 'flagged']),
      ),
    )
    .orderBy(exercises.id)
    .limit(MAX_FW_PROMPTS_FOR_DEDUP);
  return rows.flatMap((r) => {
    const s = freeWritingSummary(r.contentJson);
    return s === null ? [] : [s];
  });
}

export type FreeWritingDuplicateCheck = {
  status: 'distinct' | 'duplicate' | 'unavailable';
  detail: string;
  usage: ClaudeUsageBreakdown;
};

/** Never throws: any failure is `unavailable`, which the caller inserts flagged. */
export async function checkFreeWritingDuplicate(
  db: Db,
  client: Anthropic,
  cell: Cell,
  content: unknown,
  signal?: AbortSignal,
): Promise<FreeWritingDuplicateCheck> {
  const candidate = freeWritingSummary(content);
  if (candidate === null) {
    return { status: 'unavailable', detail: 'draft has no usable title/task', usage: ZERO_USAGE };
  }
  try {
    const existing = await fetchFreeWritingPromptSummaries(db, cell);
    const { result, tokenUsage } = await judgeFreeWritingDuplicate(
      client,
      { candidate, existing, cefrLevel: cell.cefrLevel },
      { signal },
    );
    if (result.duplicateOf === null) {
      return { status: 'distinct', detail: result.reason, usage: tokenUsage };
    }
    return {
      status: 'duplicate',
      detail: `duplicate of "${existing[result.duplicateOf].title}": ${result.reason}`,
      usage: tokenUsage,
    };
  } catch (e) {
    return { status: 'unavailable', detail: (e as Error).message.slice(0, 200), usage: ZERO_USAGE };
  }
}
