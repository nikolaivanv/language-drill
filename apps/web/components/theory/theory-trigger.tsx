'use client';

import type { MouseEvent } from 'react';
import type { LearningLanguage } from '@language-drill/shared';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { type TheoryTopicId } from '../../content/theory';
import { useTheoryTopic } from '../../lib/hooks/use-theory-topic';

type TheoryTriggerProps = {
  topicId: TheoryTopicId;
  language: LearningLanguage;
  onOpen: (topicId: TheoryTopicId, triggerEl: HTMLElement) => void;
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
