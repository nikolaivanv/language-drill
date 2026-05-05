import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  AnnotatedFooter,
  ZeroFlaggedStrip,
} from '../annotated-footer';

// ---------------------------------------------------------------------------
// AnnotatedFooter — tally + button gating + click wiring.
// ZeroFlaggedStrip — sage CTA for passages with zero flagged words.
// (Requirements 6.2, 6.9, 8.1, 8.7)
// ---------------------------------------------------------------------------

const baseFooter = {
  flaggedCount: 5,
  savedCount: 2,
  onClearBank: () => {},
  onSave: () => {},
  isSaving: false,
} as const;

describe('AnnotatedFooter — tally', () => {
  it('renders "N flagged · N saved · M skipped" with M = flagged - saved', () => {
    render(<AnnotatedFooter {...baseFooter} flaggedCount={5} savedCount={2} />);
    expect(screen.getByText('5 flagged · 2 saved · 3 skipped')).toBeInTheDocument();
  });

  it('clamps skipped to 0 if savedCount somehow exceeds flaggedCount (defensive)', () => {
    render(<AnnotatedFooter {...baseFooter} flaggedCount={2} savedCount={5} />);
    expect(screen.getByText('2 flagged · 5 saved · 0 skipped')).toBeInTheDocument();
  });

  it('updates the save-button label to include savedCount', () => {
    render(<AnnotatedFooter {...baseFooter} savedCount={3} />);
    expect(
      screen.getByRole('button', { name: /save 3 to bank →/i }),
    ).toBeInTheDocument();
  });
});

describe('AnnotatedFooter — gating', () => {
  it('disables both action buttons when savedCount === 0', () => {
    render(<AnnotatedFooter {...baseFooter} savedCount={0} />);
    expect(screen.getByRole('button', { name: /clear bank/i })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /save 0 to bank →/i }),
    ).toBeDisabled();
  });

  it('enables both buttons when savedCount > 0 and not saving', () => {
    render(<AnnotatedFooter {...baseFooter} savedCount={2} />);
    expect(screen.getByRole('button', { name: /clear bank/i })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: /save 2 to bank →/i }),
    ).toBeEnabled();
  });

  it('disables the save button while isSaving (clear bank stays available)', () => {
    render(<AnnotatedFooter {...baseFooter} savedCount={2} isSaving={true} />);
    expect(screen.getByRole('button', { name: /saving…/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /clear bank/i })).toBeEnabled();
  });
});

describe('AnnotatedFooter — callbacks', () => {
  it('clicking save fires onSave', () => {
    const onSave = vi.fn();
    render(<AnnotatedFooter {...baseFooter} savedCount={2} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /save 2 to bank →/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('clicking clear bank fires onClearBank', () => {
    const onClearBank = vi.fn();
    render(
      <AnnotatedFooter
        {...baseFooter}
        savedCount={2}
        onClearBank={onClearBank}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /clear bank/i }));
    expect(onClearBank).toHaveBeenCalledTimes(1);
  });
});

describe('ZeroFlaggedStrip', () => {
  it('renders the sage strip copy', () => {
    render(<ZeroFlaggedStrip onPasteNew={() => {}} />);
    expect(
      screen.getByText('this passage is well within your level — nice.'),
    ).toBeInTheDocument();
  });

  it('clicking the CTA fires onPasteNew', () => {
    const onPasteNew = vi.fn();
    render(<ZeroFlaggedStrip onPasteNew={onPasteNew} />);
    fireEvent.click(
      screen.getByRole('button', { name: /paste something harder/i }),
    );
    expect(onPasteNew).toHaveBeenCalledTimes(1);
  });
});
