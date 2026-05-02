'use client';

import type { MouseEvent } from 'react';
import type { LearningLanguage } from '@language-drill/shared';
import {
  getTheoryTopic,
  type TheoryTopicId,
} from '../../content/theory';

type TheoryTriggerProps = {
  topicId: TheoryTopicId;
  language: LearningLanguage;
  onOpen: (topicId: TheoryTopicId, triggerEl: HTMLElement) => void;
};

export function TheoryTrigger({
  topicId,
  language,
  onOpen,
}: TheoryTriggerProps) {
  const topic = getTheoryTopic(language, topicId);

  // Defensive: the drill page calls topicIdForHint() before rendering the
  // trigger, so this branch shouldn't be reachable. If it ever is, render
  // nothing rather than a broken pill (FR-1.2 — no trigger when topic is
  // unmapped).
  if (!topic) return null;

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
