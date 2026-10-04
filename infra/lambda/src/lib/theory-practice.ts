import { and, eq, inArray, sql } from 'drizzle-orm';
import { exercises as exercisesTable } from '@language-drill/db';
import { PUBLIC_LEVELS_BY_LANGUAGE, type PublicLanguage } from '@language-drill/shared';
import { db } from '../db';
import { approvedStatusFilter } from './exercise-filters';

/** The prototype's quick check is three sentences; anything less is not shown. */
export const QUICK_CHECK_SIZE = 3;

export type QuickCheckItem = {
  sentence: string;
  instructions: string;
  correctAnswer: string;
  acceptableAnswers: string[];
  topicHint?: string;
};

/**
 * The grammar-point keys whose conjugation pool `/try/forms` can actually
 * serve: approved conjugation rows AND a difficulty the public level picker
 * offers for this language. Both conditions, because a point whose only rows
 * sit at a level the picker hides would produce a drill link that silently
 * falls back to another level and then 400s on the point key.
 *
 * Failure is non-fatal: an empty set means no drill card renders, which is the
 * same page a point with no pool gets.
 */
export async function fetchConjugationDrillKeys(
  lang: PublicLanguage,
): Promise<Set<string>> {
  try {
    const rows = await db
      .select({ key: exercisesTable.grammarPointKey })
      .from(exercisesTable)
      .where(
        and(
          eq(exercisesTable.language, lang),
          eq(exercisesTable.type, 'conjugation'),
          approvedStatusFilter(exercisesTable),
          // A bound array interpolated into a raw `sql` ANY(...) fragment is
          // the class of Drizzle bug that typechecks and passes a mocked test
          // but breaks against real Postgres — use the query-builder form.
          inArray(exercisesTable.difficulty, PUBLIC_LEVELS_BY_LANGUAGE[lang]),
        ),
      )
      .groupBy(exercisesTable.grammarPointKey);

    const keys = new Set<string>();
    for (const row of rows) {
      if (row.key) keys.add(row.key);
    }
    return keys;
  } catch (dbError) {
    const message = dbError instanceof Error ? dbError.message : String(dbError);
    console.warn(`public theory: conjugation-availability query failed for ${lang}: ${message}`);
    return new Set();
  }
}

/**
 * Three approved cloze rows for one grammar point, as a self-gradable check.
 *
 * Rows carrying an `options` array are excluded on purpose. Rendering their
 * options turns the exercise into multiple-choice recognition, which is the one
 * thing this product positions against; omitting the options can leave a blank
 * that is ambiguous without them. Either way the row is wrong for this surface.
 *
 * `ORDER BY id LIMIT QUICK_CHECK_SIZE * 2` so the published HTML is stable
 * across ISR refreshes while leaving room for a malformed row: a cell can have
 * dozens of usable rows, and letting the first three decided which were
 * usable would suppress the whole check on one bad row. All-or-nothing still
 * holds — fewer than `QUICK_CHECK_SIZE` usable rows in the window means no
 * quick check at all, never a one- or two-item stub.
 */
export async function fetchQuickCheck(
  lang: PublicLanguage,
  grammarPointKey: string,
): Promise<QuickCheckItem[]> {
  let rows: { contentJson: unknown }[];
  try {
    rows = await db
      .select({ contentJson: exercisesTable.contentJson })
      .from(exercisesTable)
      .where(
        and(
          eq(exercisesTable.language, lang),
          eq(exercisesTable.type, 'cloze'),
          eq(exercisesTable.grammarPointKey, grammarPointKey),
          approvedStatusFilter(exercisesTable),
          // NULL-safe in one expression: a missing `options` key makes `->`
          // yield NULL, `jsonb_typeof` yields NULL, and `IS DISTINCT FROM`
          // treats that as "not an array" rather than discarding the row (the
          // two-branch `NULL <> 'array'` form reads as false and excludes
          // option-free rows, the opposite of what's wanted).
          sql`jsonb_typeof(${exercisesTable.contentJson}->'options') IS DISTINCT FROM 'array'`,
        ),
      )
      .orderBy(exercisesTable.id)
      .limit(QUICK_CHECK_SIZE * 2);
  } catch (dbError) {
    const message = dbError instanceof Error ? dbError.message : String(dbError);
    console.warn(
      `public theory: quick-check query failed for ${lang}/${grammarPointKey}: ${message}`,
    );
    return [];
  }

  const items: QuickCheckItem[] = [];
  for (const row of rows) {
    const item = toQuickCheckItem(row.contentJson);
    if (item) items.push(item);
    if (items.length === QUICK_CHECK_SIZE) break;
  }

  return items.length === QUICK_CHECK_SIZE ? items : [];
}

/**
 * Explicit field pick — never the row. `glossEn` is deliberately absent: it is
 * present on only a minority of rows and it is exactly the field `audit:gloss`
 * exists to police for stating a rule's trigger or outcome, which on a check the
 * reader grades themselves would hand over the answer. `_dedupKey` / `seedWord`
 * are writer metadata and cannot be reached by this pick at all.
 */
function toQuickCheckItem(contentJson: unknown): QuickCheckItem | null {
  if (contentJson === null || typeof contentJson !== 'object' || Array.isArray(contentJson)) {
    return null;
  }
  const c = contentJson as Record<string, unknown>;
  if (
    typeof c.sentence !== 'string' ||
    c.sentence === '' ||
    typeof c.correctAnswer !== 'string' ||
    c.correctAnswer === ''
  ) {
    return null;
  }
  const acceptable = Array.isArray(c.acceptableAnswers)
    ? c.acceptableAnswers.filter((a): a is string => typeof a === 'string')
    : [];
  return {
    sentence: c.sentence,
    instructions: typeof c.instructions === 'string' ? c.instructions : 'Type the missing form.',
    correctAnswer: c.correctAnswer,
    acceptableAnswers: acceptable,
    ...(typeof c.topicHint === 'string' ? { topicHint: c.topicHint } : {}),
  };
}
