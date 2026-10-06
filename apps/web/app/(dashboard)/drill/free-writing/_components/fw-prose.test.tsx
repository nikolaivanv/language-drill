import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkedProse, ImprovedProse } from './fw-prose';
import { reconstructMarked } from '../_lib/reconstruct';

describe('MarkedProse', () => {
  it('renders an error with its correction and number', () => {
    const paras = reconstructMarked('Si yo tendría la oportunidad.', [
      { n: 1, severity: 'high', type: 'Modo', original: 'tendría', correction: 'tuviera', note: 'n' },
    ], []);
    render(<MarkedProse paragraphs={paras} />);
    expect(screen.getByText('tendría')).toBeInTheDocument();
    expect(screen.getByText('tuviera')).toBeInTheDocument();
  });

  it('renders plain text segments', () => {
    const paras = reconstructMarked('Hello world', [], []);
    render(<MarkedProse paragraphs={paras} />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders good spans with fw-good class', () => {
    const paras = reconstructMarked('un buen día', [], ['buen']);
    render(<MarkedProse paragraphs={paras} />);
    const el = screen.getByText('buen');
    expect(el).toHaveClass('fw-good');
  });

  it('applies active class when activeErr matches errorRef', () => {
    const paras = reconstructMarked('tendría mucho éxito.', [
      { n: 2, severity: 'med', type: 'Modo', original: 'tendría', correction: 'tendré', note: 'n' },
    ], []);
    const { container } = render(<MarkedProse paragraphs={paras} activeErr={2} />);
    const errSpan = container.querySelector('.fw-err.active');
    expect(errSpan).not.toBeNull();
  });
});

describe('ImprovedProse', () => {
  it('highlights an upgrade substring', () => {
    render(<ImprovedProse improved={{ text: 'un texto mejor', upgrades: ['mejor'] }} />);
    const el = screen.getByText('mejor');
    expect(el).toHaveClass('fw-add');
  });

  it('renders plain text when there are no upgrades', () => {
    render(<ImprovedProse improved={{ text: 'texto sin mejoras', upgrades: [] }} />);
    expect(screen.getByText('texto sin mejoras')).toBeInTheDocument();
  });

  it('renders when upgrades is undefined', () => {
    render(<ImprovedProse improved={{ text: 'texto simple' }} />);
    expect(screen.getByText('texto simple')).toBeInTheDocument();
  });
});

// jsdom does not lay out text, so the wrap behaviour is pinned at the source.
// A correction can be a whole struck clause plus its rewrite; as a nowrap unit
// it widened the column past the card and the corrections view scrolled
// sideways on desktop.
describe('free-writing error span wrapping', () => {
  const css = readFileSync(join(__dirname, '..', 'free-writing.css'), 'utf8');
  const errRule = css.match(/\.fw-err\s*\{[^}]*\}/)?.[0] ?? '';

  it('lets error spans wrap like ordinary text', () => {
    expect(errRule).not.toBe('');
    expect(errRule).not.toMatch(/white-space:\s*nowrap/);
  });

  it('clones the box per line so a wrapped active highlight stays closed', () => {
    expect(errRule).toMatch(/(?<!-)box-decoration-break:\s*clone/);
  });
});
