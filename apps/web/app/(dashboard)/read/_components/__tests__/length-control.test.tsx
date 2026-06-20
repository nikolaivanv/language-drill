import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadingTextLength, READING_LENGTH_APPROX } from '@language-drill/shared';
import { LengthControl } from '../length-control';

// ---------------------------------------------------------------------------
// LengthControl — 3 segmented options; click → onChange; selected aria-pressed
// ---------------------------------------------------------------------------

describe('LengthControl', () => {
  it('renders 3 options with their approx word counts', () => {
    render(
      <LengthControl
        value={ReadingTextLength.SHORT}
        onChange={() => {}}
      />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);

    // Each option shows its approx word count
    expect(screen.getByText(`≈ ${READING_LENGTH_APPROX[ReadingTextLength.SHORT]} words`)).toBeInTheDocument();
    expect(screen.getByText(`≈ ${READING_LENGTH_APPROX[ReadingTextLength.MEDIUM]} words`)).toBeInTheDocument();
    expect(screen.getByText(`≈ ${READING_LENGTH_APPROX[ReadingTextLength.LONG]} words`)).toBeInTheDocument();
  });

  it('renders options in order SHORT, MEDIUM, LONG', () => {
    render(
      <LengthControl
        value={ReadingTextLength.SHORT}
        onChange={() => {}}
      />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveTextContent(ReadingTextLength.SHORT);
    expect(buttons[1]).toHaveTextContent(ReadingTextLength.MEDIUM);
    expect(buttons[2]).toHaveTextContent(ReadingTextLength.LONG);
  });

  it('marks the selected length with aria-pressed=true', () => {
    render(
      <LengthControl
        value={ReadingTextLength.MEDIUM}
        onChange={() => {}}
      />,
    );
    const buttons = screen.getAllByRole('button');
    const selected = buttons.find((btn) => btn.getAttribute('aria-pressed') === 'true');
    expect(selected).toBeDefined();
    expect(selected).toHaveTextContent(ReadingTextLength.MEDIUM);
  });

  it('marks non-selected lengths with aria-pressed=false', () => {
    render(
      <LengthControl
        value={ReadingTextLength.SHORT}
        onChange={() => {}}
      />,
    );
    const buttons = screen.getAllByRole('button');
    const unselected = buttons.filter((btn) => btn.getAttribute('aria-pressed') === 'false');
    expect(unselected).toHaveLength(2);
  });

  it('calls onChange with the correct length when clicked', () => {
    const onChange = vi.fn();
    render(
      <LengthControl
        value={ReadingTextLength.SHORT}
        onChange={onChange}
      />,
    );
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[2]); // LONG
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(ReadingTextLength.LONG);
  });

  it('forces the paper colour on the selected label (overrides .t-body ink)', () => {
    render(
      <LengthControl
        value={ReadingTextLength.SHORT}
        onChange={() => {}}
      />,
    );
    // The selected card is ink-filled, so its label must not inherit the dark
    // `.t-body` colour (regression: dark text on a near-black fill).
    const label = screen.getByText(ReadingTextLength.SHORT);
    expect(label).toHaveStyle({ color: 'var(--color-paper)' });

    // A non-selected label carries no inline colour override.
    const other = screen.getByText(ReadingTextLength.LONG);
    expect(other.getAttribute('style')).toBeFalsy();
  });

  it('does not fire onChange when disabled', () => {
    const onChange = vi.fn();
    render(
      <LengthControl
        value={ReadingTextLength.SHORT}
        onChange={onChange}
        disabled
      />,
    );
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
