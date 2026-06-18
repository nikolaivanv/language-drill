import { type RefObject } from 'react';
import type { LearningLanguage } from '@language-drill/shared';
import { TheorySections } from './theory-sections';
import type { TheoryTopic } from './types';

// ---------------------------------------------------------------------------
// Content column (in-drill panel)
// ---------------------------------------------------------------------------
//
// Owns the panel's scroll container. The error-boundary-wrapped section list
// itself is the shared <TheorySections> (also used by the standalone library
// detail page). The panel is dismissed via the header ×, the backdrop, or
// Escape (all wired in <TheoryPanel>), so no in-content "back to drill" footer
// is needed here.

type TheoryContentProps = {
  topic: TheoryTopic;
  scrollRef: RefObject<HTMLDivElement | null>;
  language: LearningLanguage;
  onSwitchTopic: (topicId: string) => void;
};

export function TheoryContent({
  topic,
  scrollRef,
  language,
  onSwitchTopic,
}: TheoryContentProps) {
  return (
    <div ref={scrollRef} className="theory-scroll">
      <TheorySections
        topic={topic}
        language={language}
        onSwitchTopic={onSwitchTopic}
      />
    </div>
  );
}
