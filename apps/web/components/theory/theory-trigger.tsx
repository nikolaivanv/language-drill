'use client';

import type { MouseEvent } from 'react';
import type { LearningLanguage } from '@language-drill/shared';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { useTheoryTopic } from '../../lib/hooks/use-theory-topic';

// `topicId` is `string` (not the closed `TheoryTopicId` enum) because
// DB-backed theory topics — generated from the curriculum — are not part
// of the hand-authored static registry. `useTheoryTopic` accepts any
// string and decides whether to render based on static-or-DB lookup.
type TheoryTriggerProps = {
  topicId: string;
  language: LearningLanguage;
  onOpen: (topicId: string, triggerEl: HTMLElement) => void;
  fetchFn?: AuthenticatedFetch;
};

export function TheoryTrigger({
  topicId,
  language,
  onOpen,
  fetchFn,
}: TheoryTriggerProps) {
  const { topic, isLoading } = useTheoryTopic({ language, topicId, fetchFn });

  // Render nothing while loading or when no topic is available — preserves
  // "no flash of broken pill" (Req 6.5) and the FR-1.2 unmapped-trigger
  // behavior.
  if (isLoading || !topic) return null;

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    onOpen(topicId, e.currentTarget);
  }

  return (
    <button
      type="button"
      className="theory-trigger"
      aria-haspopup="dialog"
      onClick={handleClick}
    >
      theory · {topic.title}
    </button>
  );
}
