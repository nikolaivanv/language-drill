import { type RefObject } from 'react';
import type { LearningLanguage } from '@language-drill/shared';
import { Button } from '../ui/button';
import { TheorySections } from './theory-sections';
import type { TheoryTopic } from './types';

// ---------------------------------------------------------------------------
// Content column (in-drill panel)
// ---------------------------------------------------------------------------
//
// Owns the panel's scroll container, bottom spacer, and "back to drill" footer.
// The error-boundary-wrapped section list itself is the shared <TheorySections>
// (also used by the standalone library detail page) — kept outside the footer
// so the CTA still works even if every section crashes. DOM output is
// unchanged from before the extraction (reliability NFR — panel behavior
// preserved by composition, not rewrite).

type TheoryContentProps = {
  topic: TheoryTopic;
  scrollRef: RefObject<HTMLDivElement | null>;
  language: LearningLanguage;
  onSwitchTopic: (topicId: string) => void;
  onClose: () => void;
};

export function TheoryContent({
  topic,
  scrollRef,
  language,
  onSwitchTopic,
  onClose,
}: TheoryContentProps) {
  return (
    <div ref={scrollRef} className="theory-scroll">
      <TheorySections
        topic={topic}
        language={language}
        onSwitchTopic={onSwitchTopic}
      />

      <div style={{ height: 80 }} aria-hidden="true" />

      <div className="theory-footer-cta">
        <Button variant="primary" size="sm" onClick={onClose}>
          back to drill →
        </Button>
      </div>
    </div>
  );
}
