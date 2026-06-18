import { Component, type ReactNode } from 'react';
import type { LearningLanguage } from '@language-drill/shared';
import { TheoryEmpty } from './theory-empty';
import type { TheoryTopic } from './types';

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------
//
// Catches render-time errors inside topic content (e.g., a typo in a primitive
// usage, a broken table row) and falls back to <TheoryEmpty>. Extracted from
// `theory-content.tsx` so both the in-drill panel (`TheoryContent`) and the
// standalone library detail page can render the same section list + boundary
// without duplicating it. Reliability NFR — design.md §"Error Handling".

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
// Section list
// ---------------------------------------------------------------------------

type TheorySectionsProps = {
  topic: TheoryTopic;
  language: LearningLanguage;
  onSwitchTopic: (topicId: string) => void;
};

/**
 * The error-boundary-wrapped list of theory sections — and nothing else. The
 * scroll container and any surface-specific chrome live in the *consumer*
 * (`TheoryContent` for the panel, `TheoryDetail` for the library page), so each
 * surface supplies its own chrome around this shared body.
 */
export function TheorySections({
  topic,
  language,
  onSwitchTopic,
}: TheorySectionsProps) {
  return (
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
  );
}
