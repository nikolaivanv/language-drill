import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Language } from '@language-drill/shared';

// Regression: the in-drill panel's "open in new tab" link must point at the
// route/lookup SLUG (`b1-present-subjunctive`), not the loaded topic's content
// `id`. DB-backed topics embed the FULL grammar-point key (`es-b1-…`) as their
// JSON `id`, and `/theory/<id>` resolves against the unprefixed `topic_id`
// column — so a prefixed link 404s ("no theory written yet") even though the
// drawer rendered the topic fine. Static topics keep id === slug, so the
// divergence only surfaces by mocking a prefixed content id here.
vi.mock('../../../content/theory', () => ({
  getStaticTheoryTopic: (_language: unknown, topicId: string) =>
    topicId === 'b1-present-subjunctive'
      ? {
          id: 'es-b1-present-subjunctive', // full grammar-point key (DB JSON shape)
          title: 'present subjunctive',
          subtitle: 'the subjunctive mood',
          cefr: 'B1',
          sections: [],
        }
      : null,
  listStaticTheoryTopics: () => [],
}));

vi.mock('../../../lib/responsive', () => ({
  useIsMobile: () => false,
}));

import { TheoryPanel } from '../theory-panel';

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('TheoryPanel — open-in-new-tab link', () => {
  it('links to the route slug, not the prefixed content id', () => {
    render(
      <TheoryPanel
        topicId="b1-present-subjunctive"
        language={Language.ES}
        triggerEl={null}
        onClose={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    const link = screen.getByRole('link', {
      name: /open present subjunctive in theory hub \(new tab\)/i,
    });
    // Must be the unprefixed slug the same-page drawer resolved against — the
    // prefixed `/theory/es-b1-present-subjunctive` is exactly the 404 URL.
    expect(link).toHaveAttribute('href', '/theory/b1-present-subjunctive');
  });
});
