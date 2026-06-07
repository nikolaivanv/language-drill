import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { READING_IDEAS } from '@language-drill/shared';
import { EmptyView } from '../empty-view';

// ---------------------------------------------------------------------------
// EmptyView (redesigned) — title + body; onGenerate; onPaste; onPickIdea
// ---------------------------------------------------------------------------

const defaultProps = {
  onGenerate: () => {},
  onPaste: () => {},
  onPickIdea: () => {},
  languageLabel: 'español',
};

describe('EmptyView — copy and language label', () => {
  it('renders the eyebrow, title, and body paragraph with languageLabel', () => {
    render(<EmptyView {...defaultProps} languageLabel="español" />);
    expect(screen.getByText('read at your level')).toBeInTheDocument();
    expect(screen.getByText('nothing to read yet.')).toBeInTheDocument();
    expect(
      screen.getByText(
        /I'll write a passage in español at just the right difficulty/,
      ),
    ).toBeInTheDocument();
  });

  it('interpolates languageLabel into the body for German', () => {
    render(<EmptyView {...defaultProps} languageLabel="Deutsch" />);
    expect(
      screen.getByText(/I'll write a passage in Deutsch at just the right difficulty/),
    ).toBeInTheDocument();
  });
});

describe('EmptyView — CTAs', () => {
  it('calls onGenerate when the primary CTA is clicked', () => {
    const onGenerate = vi.fn();
    render(<EmptyView {...defaultProps} onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole('button', { name: /generate a passage/i }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('calls onPaste when the "or paste your own" link is clicked', () => {
    const onPaste = vi.fn();
    render(<EmptyView {...defaultProps} onPaste={onPaste} />);
    fireEvent.click(screen.getByRole('button', { name: /or paste your own/i }));
    expect(onPaste).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyView — popular starts', () => {
  it('renders the POPULAR STARTS section label', () => {
    render(<EmptyView {...defaultProps} />);
    expect(screen.getByText('POPULAR STARTS')).toBeInTheDocument();
  });

  it('calls onPickIdea with the correct idea when a popular start is clicked', () => {
    const onPickIdea = vi.fn();
    render(<EmptyView {...defaultProps} onPickIdea={onPickIdea} />);
    // Click the first idea
    const firstIdea = READING_IDEAS[0];
    fireEvent.click(screen.getByText(firstIdea.prompt));
    expect(onPickIdea).toHaveBeenCalledTimes(1);
    expect(onPickIdea).toHaveBeenCalledWith(firstIdea);
  });

  it('renders all 6 popular starts via IdeaCards', () => {
    render(<EmptyView {...defaultProps} />);
    // All 6 READING_IDEAS prompts should be present
    for (const idea of READING_IDEAS) {
      expect(screen.getByText(idea.prompt)).toBeInTheDocument();
    }
  });
});
