import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Language } from '@language-drill/shared';
import type { CurriculumMapPoint } from '@language-drill/api-client';
import { PointDetailSheet } from '../point-detail-sheet';

// next/link renders as <a> in jsdom
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...(rest as Record<string, unknown>)}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const noop = () => {};

function makePoint(over: Partial<CurriculumMapPoint> = {}): CurriculumMapPoint {
  return {
    key: 'tr-a1-locative',
    name: 'Locative case',
    cefrLevel: 'A1',
    order: 3,
    state: 'learning',
    mastery: 0.4,
    confidence: 0.5,
    evidenceCount: 3,
    errorProne: true,
    recentErrorCount: 2,
    lastPracticedAt: null,
    prereqKeys: [],
    prereqNames: [],
    prereqUnmet: false,
    compatibleTypes: ['cloze', 'translation', 'conjugation'],
    hasTheory: true,
    errorSample: { wrongText: 'kitaplar', correction: 'kitapları' },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PointDetailSheet', () => {
  it('renders the mastery readout (40% / building / 3) for a learning point', () => {
    render(
      <PointDetailSheet
        point={makePoint()}
        language={Language.TR}
        onClose={noop}
      />,
    );
    // mastery % kept
    expect(screen.getByText('40%')).toBeDefined();
    // confidence shows band label, not raw %
    expect(screen.getByText('building')).toBeDefined();
    expect(screen.queryByText('50%')).toBeNull();
    // evidence count unchanged
    expect(screen.getByText('3')).toBeDefined();
  });

  it('locks background scroll while open and restores it on close', () => {
    expect(document.body.style.overflow).toBe('');
    const { unmount } = render(
      <PointDetailSheet
        point={makePoint()}
        language={Language.TR}
        onClose={noop}
      />,
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('renders the error sample (kitaplar → kitapları)', () => {
    render(
      <PointDetailSheet
        point={makePoint()}
        language={Language.TR}
        onClose={noop}
      />,
    );
    expect(screen.getByText('kitaplar')).toBeDefined();
    expect(screen.getByText('kitapları')).toBeDefined();
  });

  it('renders a "read the theory" link with href="/theory/a1-locative"', () => {
    render(
      <PointDetailSheet
        point={makePoint()}
        language={Language.TR}
        onClose={noop}
      />,
    );
    const theoryLink = screen.getByRole('link', { name: /read the theory/i });
    expect(theoryLink).toBeDefined();
    expect(theoryLink.getAttribute('href')).toBe('/theory/a1-locative');
  });

  it('renders a mixed drill link to /drill?start=quick&grammarPoint=tr-a1-locative', () => {
    render(
      <PointDetailSheet
        point={makePoint()}
        language={Language.TR}
        onClose={noop}
      />,
    );
    const mixedLink = screen.getByRole('link', { name: /mixed drill/i });
    expect(mixedLink).toBeDefined();
    expect(mixedLink.getAttribute('href')).toBe(
      '/drill?start=quick&grammarPoint=tr-a1-locative',
    );
  });

  it('renders a cloze chip link to /drill?...&exerciseType=cloze', () => {
    render(
      <PointDetailSheet
        point={makePoint()}
        language={Language.TR}
        onClose={noop}
      />,
    );
    const clozeLink = screen.getByRole('link', { name: /cloze/i });
    expect(clozeLink).toBeDefined();
    expect(clozeLink.getAttribute('href')).toBe(
      '/drill?start=quick&grammarPoint=tr-a1-locative&exerciseType=cloze',
    );
  });

  it('renders a conjugation chip link to /drill/conjugation?grammarPoint=tr-a1-locative', () => {
    render(
      <PointDetailSheet
        point={makePoint()}
        language={Language.TR}
        onClose={noop}
      />,
    );
    const conjugationLink = screen.getByRole('link', { name: /conjugation/i });
    expect(conjugationLink).toBeDefined();
    expect(conjugationLink.getAttribute('href')).toBe(
      '/drill/conjugation?grammarPoint=tr-a1-locative',
    );
  });

  it('renders as a dialog with aria-modal and aria-label', () => {
    render(
      <PointDetailSheet
        point={makePoint()}
        language={Language.TR}
        onClose={noop}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Locative case');
  });

  it('does not render the mastery readout for a not-started point', () => {
    render(
      <PointDetailSheet
        point={makePoint({ state: 'not-started', mastery: null, confidence: null, evidenceCount: 0 })}
        language={Language.TR}
        onClose={noop}
      />,
    );
    expect(screen.queryByText('mastery')).toBeNull();
  });

  it('omits the theory link when hasTheory is false', () => {
    render(
      <PointDetailSheet
        point={makePoint({ hasTheory: false })}
        language={Language.TR}
        onClose={noop}
      />,
    );
    expect(screen.queryByRole('link', { name: /read the theory/i })).toBeNull();
  });

  it('mixed drill link has primary variant (bg-ink class)', () => {
    render(
      <PointDetailSheet
        point={makePoint()}
        language={Language.TR}
        onClose={noop}
      />,
    );
    const mixedLink = screen.getByRole('link', { name: /mixed drill/i });
    expect(mixedLink.className).toContain('bg-ink');
    expect(mixedLink.className).toContain('w-full');
  });

  it('mode buttons (cloze / translation) have ghost variant (bg-transparent class)', () => {
    render(
      <PointDetailSheet
        point={makePoint()}
        language={Language.TR}
        onClose={noop}
      />,
    );
    const clozeLink = screen.getByRole('link', { name: /cloze/i });
    expect(clozeLink.className).toContain('bg-transparent');
    const translationLink = screen.getByRole('link', { name: /translation/i });
    expect(translationLink.className).toContain('bg-transparent');
  });

  it('theory link uses .link-arrow class', () => {
    render(
      <PointDetailSheet
        point={makePoint()}
        language={Language.TR}
        onClose={noop}
      />,
    );
    const theoryLink = screen.getByRole('link', { name: /read the theory/i });
    expect(theoryLink.className).toContain('link-arrow');
  });

  it('shows mastery hint text', () => {
    render(
      <PointDetailSheet
        point={makePoint()}
        language={Language.TR}
        onClose={noop}
      />,
    );
    expect(
      screen.getByText(/mastery = your recent accuracy on this point/i),
    ).toBeDefined();
  });

  it('shows high confidence label when confidence >= 0.70', () => {
    render(
      <PointDetailSheet
        point={makePoint({ confidence: 0.75 })}
        language={Language.TR}
        onClose={noop}
      />,
    );
    expect(screen.getByText('high')).toBeDefined();
  });
});
