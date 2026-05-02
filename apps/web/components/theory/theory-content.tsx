import { Component, type ReactNode, type RefObject } from 'react';
import type { LearningLanguage } from '@language-drill/shared';
import type { TheoryTopicId } from '../../content/theory';
import { Button } from '../ui/button';
import { TheoryEmpty } from './theory-empty';
import type { TheoryTopic } from './types';

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------
//
// Catches render-time errors inside topic content (e.g., a typo in a primitive
// usage, a broken table row). The footer is rendered *outside* this boundary
// so the "back to drill" CTA still works even if every section crashes.
// Reliability NFR — design.md §"Error Handling · Scenario 3".

class TheoryErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[theory] section render failed:', error);
    }
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Content column
// ---------------------------------------------------------------------------

type TheoryContentProps = {
  topic: TheoryTopic;
  scrollRef: RefObject<HTMLDivElement | null>;
  language: LearningLanguage;
  onSwitchTopic: (topicId: TheoryTopicId) => void;
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
      <TheoryErrorBoundary
        fallback={
          <TheoryEmpty
            attemptedTopicId={topic.id}
            language={language}
            onSwitchTopic={onSwitchTopic}
          />
        }
      >
        {topic.sections.map((s) => (
          <section key={s.id} id={s.id} className="theory-section">
            <h3 className="theory-section-title">{s.title}</h3>
            <div className="theory-content">{s.body}</div>
          </section>
        ))}
      </TheoryErrorBoundary>

      <div style={{ height: 80 }} aria-hidden="true" />

      <div className="theory-footer-cta">
        <Button variant="primary" size="sm" onClick={onClose}>
          back to drill →
        </Button>
      </div>
    </div>
  );
}
