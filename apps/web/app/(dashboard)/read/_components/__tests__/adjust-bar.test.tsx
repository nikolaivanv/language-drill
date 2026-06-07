import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CefrLevel, ReadingTextLength } from '@language-drill/shared';
import { AdjustBar } from '../adjust-bar';

// ---------------------------------------------------------------------------
// AdjustBar — 4 buttons; A1/C2/LONG edge-disabled; fire onAdjust with kind; busy disables all
// ---------------------------------------------------------------------------

describe('AdjustBar', () => {
  it('renders 4 adjust buttons', () => {
    render(
      <AdjustBar
        cefr={CefrLevel.B2}
        length={ReadingTextLength.MEDIUM}
        onAdjust={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /make easier/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /make harder/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /longer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rewrite/i })).toBeInTheDocument();
  });

  it('disables "make easier" at A1', () => {
    render(
      <AdjustBar
        cefr={CefrLevel.A1}
        length={ReadingTextLength.MEDIUM}
        onAdjust={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /make easier/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /make harder/i })).not.toBeDisabled();
  });

  it('disables "make harder" at C2', () => {
    render(
      <AdjustBar
        cefr={CefrLevel.C2}
        length={ReadingTextLength.MEDIUM}
        onAdjust={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /make harder/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /make easier/i })).not.toBeDisabled();
  });

  it('disables "longer" at LONG', () => {
    render(
      <AdjustBar
        cefr={CefrLevel.B1}
        length={ReadingTextLength.LONG}
        onAdjust={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /longer/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /make easier/i })).not.toBeDisabled();
  });

  it('fires onAdjust("easier") when "make easier" is clicked', () => {
    const onAdjust = vi.fn();
    render(
      <AdjustBar
        cefr={CefrLevel.B2}
        length={ReadingTextLength.MEDIUM}
        onAdjust={onAdjust}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /make easier/i }));
    expect(onAdjust).toHaveBeenCalledWith('easier');
  });

  it('fires onAdjust("harder") when "make harder" is clicked', () => {
    const onAdjust = vi.fn();
    render(
      <AdjustBar
        cefr={CefrLevel.B2}
        length={ReadingTextLength.MEDIUM}
        onAdjust={onAdjust}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /make harder/i }));
    expect(onAdjust).toHaveBeenCalledWith('harder');
  });

  it('fires onAdjust("longer") when "longer" is clicked', () => {
    const onAdjust = vi.fn();
    render(
      <AdjustBar
        cefr={CefrLevel.B2}
        length={ReadingTextLength.MEDIUM}
        onAdjust={onAdjust}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /longer/i }));
    expect(onAdjust).toHaveBeenCalledWith('longer');
  });

  it('fires onAdjust("rewrite") when "rewrite" is clicked', () => {
    const onAdjust = vi.fn();
    render(
      <AdjustBar
        cefr={CefrLevel.B2}
        length={ReadingTextLength.MEDIUM}
        onAdjust={onAdjust}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /rewrite/i }));
    expect(onAdjust).toHaveBeenCalledWith('rewrite');
  });

  it('disables all buttons when busy', () => {
    render(
      <AdjustBar
        cefr={CefrLevel.B2}
        length={ReadingTextLength.MEDIUM}
        onAdjust={vi.fn()}
        busy
      />,
    );
    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) {
      expect(btn).toBeDisabled();
    }
  });
});
