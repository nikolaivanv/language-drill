import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadingCategory, CefrLevel, ReadingTextLength } from '@language-drill/shared';
import { ProvenanceHeader } from '../provenance-header';

// ---------------------------------------------------------------------------
// ProvenanceHeader — prompt + tags render; rewrite fires; rewriting disables
// ---------------------------------------------------------------------------

const defaultProps = {
  prompt: 'a short story about a cat',
  category: ReadingCategory.STORY,
  cefr: CefrLevel.B2,
  length: ReadingTextLength.MEDIUM,
  languageLabel: 'español',
  onRewrite: vi.fn(),
};

describe('ProvenanceHeader', () => {
  it('renders the prompt in italic quotes', () => {
    render(<ProvenanceHeader {...defaultProps} />);
    // The component renders typographic curly-quote entities (“ / ”)
    expect(screen.getByText(/a short story about a cat/)).toBeInTheDocument();
  });

  it('renders the category chip uppercased', () => {
    render(<ProvenanceHeader {...defaultProps} />);
    expect(screen.getByText('STORY')).toBeInTheDocument();
  });

  it('renders cefr chip', () => {
    render(<ProvenanceHeader {...defaultProps} />);
    expect(screen.getByText('B2')).toBeInTheDocument();
  });

  it('renders length chip uppercased', () => {
    render(<ProvenanceHeader {...defaultProps} />);
    expect(screen.getByText('MEDIUM')).toBeInTheDocument();
  });

  it('renders languageLabel chip uppercased', () => {
    render(<ProvenanceHeader {...defaultProps} />);
    expect(screen.getByText('ESPAÑOL')).toBeInTheDocument();
  });

  it('omits the category chip when category is null', () => {
    render(<ProvenanceHeader {...defaultProps} category={null} />);
    expect(screen.queryByText('STORY')).not.toBeInTheDocument();
    // Other chips still present
    expect(screen.getByText('B2')).toBeInTheDocument();
  });

  it('calls onRewrite when the rewrite button is clicked', () => {
    const onRewrite = vi.fn();
    render(<ProvenanceHeader {...defaultProps} onRewrite={onRewrite} />);
    const rewriteBtn = screen.getByRole('button', { name: /rewrite/i });
    fireEvent.click(rewriteBtn);
    expect(onRewrite).toHaveBeenCalledTimes(1);
  });

  it('disables the rewrite button while rewriting', () => {
    render(<ProvenanceHeader {...defaultProps} rewriting />);
    const rewriteBtn = screen.getByRole('button', { name: /rewrite/i });
    expect(rewriteBtn).toBeDisabled();
  });
});
