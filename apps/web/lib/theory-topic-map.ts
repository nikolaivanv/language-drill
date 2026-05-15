import type { LearningLanguage } from '@language-drill/shared';
import {
  getStaticTheoryTopic,
  type TheoryTopicId,
} from '../content/theory';

// Maps the free-text `topicHint` field on `ExerciseContent` to a closed enum of
// theory topic ids known to the registry. Entries are added alongside their
// corresponding content files (see `apps/web/content/theory/es/*.tsx`).
export const HINT_TO_TOPIC: Record<string, TheoryTopicId> = {
  subjunctive: 'subjunctive',
  'present-subjunctive': 'subjunctive',
  'preterite-vs-imperfect': 'preterite-imperfect',
  'pret-imp': 'preterite-imperfect',
  conditional: 'conditional',
};

const warnedHints = new Set<string>();

export function topicIdForHint(
  hint: string | undefined,
  language: LearningLanguage,
): TheoryTopicId | null {
  if (!hint) return null;

  const id = HINT_TO_TOPIC[hint];

  if (!id) {
    if (process.env.NODE_ENV === 'development' && !warnedHints.has(hint)) {
      warnedHints.add(hint);
      console.warn(
        `[theory] Unmapped topic hint: "${hint}". ` +
          `Add to HINT_TO_TOPIC in apps/web/lib/theory-topic-map.ts ` +
          `or to the registry in apps/web/content/theory/index.ts.`,
      );
    }
    return null;
  }

  return getStaticTheoryTopic(language, id) ? id : null;
}
