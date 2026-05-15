/**
 * Static theory registry. Hand-authored TSX topics take precedence over
 * DB-stored rows; for DB-backed access use `useTheoryTopic` /
 * `useTheoryTopics` from `apps/web/lib/hooks/`.
 */
import type { LearningLanguage } from '@language-drill/shared';
import type { TheoryTopic } from '../../components/theory/types';
import subjunctive from './es/subjunctive';
import preteriteImperfect from './es/preterite-imperfect';
import conditional from './es/conditional';

export const theoryRegistry = {
  ES: {
    subjunctive,
    'preterite-imperfect': preteriteImperfect,
    conditional,
  },
  DE: {},
  TR: {},
} as const satisfies Record<LearningLanguage, Record<string, TheoryTopic>>;

export type TheoryTopicId =
  | keyof (typeof theoryRegistry)['ES']
  | keyof (typeof theoryRegistry)['DE']
  | keyof (typeof theoryRegistry)['TR'];

export function getStaticTheoryTopic(
  language: LearningLanguage,
  topicId: string,
): TheoryTopic | null {
  const langMap = theoryRegistry[language] as Record<string, TheoryTopic>;
  return langMap[topicId] ?? null;
}

export function listStaticTheoryTopics(
  language: LearningLanguage,
): Array<Pick<TheoryTopic, 'id' | 'title' | 'cefr'>> {
  const langMap = theoryRegistry[language] as Record<string, TheoryTopic>;
  return Object.values(langMap)
    .map((t) => ({ id: t.id, title: t.title, cefr: t.cefr }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
