import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FwBrief } from './fw-brief';
import { ExerciseType, type FreeWritingContent } from '@language-drill/shared';

const content: FreeWritingContent = {
  type: ExerciseType.FREE_WRITING,
  instructions: 'i',
  title: 'El teletrabajo',
  task: 'Argumenta.',
  domain: 'opinión',
  register: 'formal',
  minWords: 150,
  maxWords: 200,
  suggestedMinutes: 20,
  requiredElements: [{ id: 'cond', label: 'Usa dos condicionales' }],
};

describe('FwBrief', () => {
  it('shows the prompt, constraints and required elements', () => {
    render(
      <FwBrief content={content} examMode={false} onToggleExam={() => {}} onBegin={() => {}} />,
    );
    expect(screen.getByText('El teletrabajo')).toBeInTheDocument();
    expect(screen.getByText(/150/)).toBeInTheDocument();
    expect(screen.getByText('Usa dos condicionales')).toBeInTheDocument();
  });

  it('links to past attempts only when given a history href', () => {
    const { rerender } = render(
      <FwBrief content={content} examMode={false} onToggleExam={() => {}} onBegin={() => {}} />,
    );
    expect(screen.queryByRole('link', { name: /past attempts/i })).toBeNull();
    rerender(
      <FwBrief
        content={content}
        examMode={false}
        onToggleExam={() => {}}
        onBegin={() => {}}
        historyHref="/drill/free-writing/history"
      />,
    );
    expect(screen.getByRole('link', { name: /past attempts/i })).toHaveAttribute(
      'href',
      '/drill/free-writing/history',
    );
  });

  it('begins on click', () => {
    const onBegin = vi.fn();
    render(
      <FwBrief content={content} examMode={false} onToggleExam={() => {}} onBegin={onBegin} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /begin/i }));
    expect(onBegin).toHaveBeenCalled();
  });

  it('labels the spec rows in English, not Spanish', () => {
    render(
      <FwBrief content={content} examMode={false} onToggleExam={() => {}} onBegin={() => {}} />,
    );
    // English chrome present
    expect(screen.getByText('topic')).toBeInTheDocument();
    expect(screen.getByText('register')).toBeInTheDocument();
    expect(screen.getByText('length')).toBeInTheDocument();
    expect(screen.getByText('required elements')).toBeInTheDocument();
    expect(screen.getByText(/words/)).toBeInTheDocument();
    expect(screen.getByText(/address a general reader/i)).toBeInTheDocument();
    // Spanish gone
    expect(screen.queryByText('tema')).toBeNull();
    expect(screen.queryByText('registro')).toBeNull();
    expect(screen.queryByText('longitud')).toBeNull();
    expect(screen.queryByText('elementos obligatorios')).toBeNull();
    expect(screen.queryByText(/palabras/)).toBeNull();
    expect(screen.queryByText(/dirígete/)).toBeNull();
  });
});

// jsdom does not cascade stylesheets, so the primary-hover contrast is pinned
// at the source: each `.btn.primary:hover` rule must restate its text colour,
// or the base `.btn:hover { color: ink }` wins and the CTA reads ink-on-ink.
describe('free-writing primary button hover', () => {
  const css = readFileSync(join(__dirname, '..', 'free-writing.css'), 'utf8');
  it('keeps paper text on the light-theme hover fill', () => {
    expect(css).toMatch(
      /(?<!\.dark )\.btn\.primary:hover:not\(:disabled\)\s*\{[^}]*color:\s*var\(--color-paper\)/,
    );
  });
  it('keeps white text on the dark-theme hover fill', () => {
    expect(css).toMatch(/\.dark \.btn\.primary:hover:not\(:disabled\)\s*\{[^}]*color:\s*#fff/);
  });
});
