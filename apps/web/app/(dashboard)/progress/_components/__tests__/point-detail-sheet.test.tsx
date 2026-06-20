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
  it('renders the mastery readout (40% / 50% / 3) for a learning point', () => {
    render(
      <PointDetailSheet
        point={makePoint()}
        language={Language.TR}
        onClose={noop}
      />,
    );
    expect(screen.getByText('40%')).toBeDefined();
    expect(screen.getByText('50%')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
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
});
