import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GlossedText } from '../glossed-text';
import { ENGLISH_GLOSS } from '../../../../../lib/translation/gloss-en';

describe('GlossedText', () => {
  it('returns null for an empty string', () => {
    const { container } = render(<GlossedText text="" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders plain text when no tokens have a gloss entry', () => {
    const { container } = render(<GlossedText text="hello there friend" />);
    expect(container.textContent).toBe('hello there friend');
    expect(container.querySelector('.gloss')).toBeNull();
  });

  it('wraps a known glossed word in a .gloss span', () => {
    render(<GlossedText text="afford" />);
    const span = screen.getByText('afford');
    expect(span.tagName).toBe('SPAN');
    expect(span.className).toContain('gloss');
  });

  it('renders a tooltip with the gloss text in the DOM (always present, not display:none)', () => {
    render(<GlossedText text="afford" />);
    const expectedGloss = ENGLISH_GLOSS['afford']?.gloss;
    expect(expectedGloss).toBeDefined();
    expect(screen.getByText(expectedGloss!)).toBeInTheDocument();
    const tooltip = screen.getByText(expectedGloss!);
    expect(tooltip.className).toContain('gloss-tooltip');
  });

  it('makes the gloss span keyboard-reachable via tabIndex=0', () => {
    render(<GlossedText text="afford" />);
    const span = screen.getByText('afford');
    expect(span).toHaveAttribute('tabIndex', '0');
  });

  it('only wraps the glossed token, leaving plain words plain', () => {
    const { container } = render(<GlossedText text="we afford this" />);
    const glossSpans = container.querySelectorAll('.gloss');
    expect(glossSpans).toHaveLength(1);
    expect(glossSpans[0].firstChild?.textContent).toBe('afford');
  });

  it('preserves whitespace between tokens (using non-glossed words to avoid tooltip text noise)', () => {
    // Using words not in the gloss list so textContent reflects only the source text.
    const { container } = render(<GlossedText text="we  go   home" />);
    expect(container.textContent).toBe('we  go   home');
  });

  it('looks up tokens case-insensitively (via lookupGloss)', () => {
    render(<GlossedText text="Afford" />);
    const span = screen.getByText('Afford');
    expect(span.className).toContain('gloss');
  });

  it('strips trailing punctuation when looking up tokens', () => {
    render(<GlossedText text="afford," />);
    const span = screen.getByText('afford,');
    expect(span.className).toContain('gloss');
  });
});
