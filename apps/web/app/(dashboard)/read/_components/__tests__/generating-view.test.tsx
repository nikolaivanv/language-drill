import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CefrLevel, ReadingTextLength, ReadingCategory } from '@language-drill/shared';
import { GeneratingView } from '../generating-view';

// ---------------------------------------------------------------------------
// GeneratingView — calm loading state during text generation
// ---------------------------------------------------------------------------

const baseProvenance = {
  category: null,
  cefr: CefrLevel.B2,
  length: ReadingTextLength.MEDIUM,
  prompt: 'a letter from someone leaving their hometown',
};

describe('GeneratingView — accessibility', () => {
  it('renders a role="status" region with aria-live="polite"', () => {
    render(
      <GeneratingView languageLabel="español" provenance={baseProvenance} />,
    );
    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-live', 'polite');
  });
});

describe('GeneratingView — heading copy', () => {
  it('renders the "writing your passage…" heading', () => {
    render(
      <GeneratingView languageLabel="español" provenance={baseProvenance} />,
    );
    expect(
      screen.getByRole('heading', { name: /writing your passage…/i }),
    ).toBeInTheDocument();
  });

  it('renders the "read at your level" eyebrow', () => {
    render(
      <GeneratingView languageLabel="español" provenance={baseProvenance} />,
    );
    expect(screen.getByText('read at your level')).toBeInTheDocument();
  });
});

describe('GeneratingView — subline with provenance', () => {
  it('reflects the cefr level in the subline', () => {
    render(
      <GeneratingView languageLabel="español" provenance={baseProvenance} />,
    );
    expect(screen.getByText(/B2/)).toBeInTheDocument();
  });

  it('reflects the language label in the subline', () => {
    render(
      <GeneratingView languageLabel="español" provenance={baseProvenance} />,
    );
    expect(screen.getByText(/español/)).toBeInTheDocument();
  });

  it('uses length name in the subline', () => {
    render(
      <GeneratingView languageLabel="español" provenance={baseProvenance} />,
    );
    expect(screen.getByText(/medium/)).toBeInTheDocument();
  });

  it('falls back to "passage" when category is null', () => {
    render(
      <GeneratingView languageLabel="español" provenance={{ ...baseProvenance, category: null }} />,
    );
    // The subline uses "passage" as the category fallback
    expect(screen.getByText(/tuning a medium passage to/)).toBeInTheDocument();
  });

  it('uses the category name when category is set', () => {
    render(
      <GeneratingView
        languageLabel="español"
        provenance={{ ...baseProvenance, category: ReadingCategory.STORY }}
      />,
    );
    expect(screen.getByText(/story/)).toBeInTheDocument();
  });

  it('renders the full subline with all provenance values', () => {
    render(
      <GeneratingView
        languageLabel="Deutsch"
        provenance={{
          category: ReadingCategory.NEWS,
          cefr: CefrLevel.C1,
          length: ReadingTextLength.LONG,
          prompt: 'a local festival',
        }}
      />,
    );
    expect(
      screen.getByText(
        /tuning a long news to C1 in Deutsch, then calibrating the words worth collecting\./,
      ),
    ).toBeInTheDocument();
  });
});

describe('GeneratingView — progress affordance', () => {
  it('renders a progress indicator', () => {
    render(
      <GeneratingView languageLabel="español" provenance={baseProvenance} />,
    );
    // The pulsing bar or spinner should be present in the DOM
    const status = screen.getByRole('status');
    expect(status.querySelector('[aria-label="generating"]') ?? status.querySelector('[data-testid="generating-progress"]')).not.toBeNull();
  });
});
