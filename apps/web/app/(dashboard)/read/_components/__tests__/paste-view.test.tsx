import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PasteView } from '../paste-view';

// ---------------------------------------------------------------------------
// PasteView — counter behavior, CTA gating, callbacks, loading + error.
// ---------------------------------------------------------------------------

const defaultProps = {
  paste: { title: '', source: '', text: '' },
  onChange: () => {},
  onCancel: () => {},
  onAnnotate: () => {},
  isLoading: false,
  errorBody: null,
} as const;

describe('PasteView — counter + annotate gating', () => {
  it('disables "annotate →" when text is empty', () => {
    render(<PasteView {...defaultProps} />);
    expect(screen.getByRole('button', { name: /annotate →/i })).toBeDisabled();
  });

  it('disables "annotate →" when text is whitespace-only', () => {
    render(
      <PasteView
        {...defaultProps}
        paste={{ title: '', source: '', text: '   \n\t  ' }}
      />,
    );
    expect(screen.getByRole('button', { name: /annotate →/i })).toBeDisabled();
  });

  it('enables "annotate →" at 1,500 chars and shows the counter in the muted style', () => {
    const text = 'a'.repeat(1500);
    render(
      <PasteView
        {...defaultProps}
        paste={{ title: '', source: '', text }}
      />,
    );
    expect(
      screen.getByRole('button', { name: /annotate →/i }),
    ).not.toBeDisabled();
    const counter = screen.getByText(/1,500 \/ 2,000/);
    expect(counter).not.toHaveTextContent(/too long/);
    expect(counter.className).toContain('text-ink-mute');
    expect(counter.className).not.toContain('text-accent');
  });

  it('disables "annotate →" at 2,001 chars, flips counter to accent + " · too long"', () => {
    const text = 'a'.repeat(2001);
    render(
      <PasteView
        {...defaultProps}
        paste={{ title: '', source: '', text }}
      />,
    );
    expect(screen.getByRole('button', { name: /annotate →/i })).toBeDisabled();
    const counter = screen.getByText(/2,001 \/ 2,000 · too long/);
    expect(counter.className).toContain('text-accent');
  });

  it('counter has aria-live="polite" so AT users hear it cross 2,000', () => {
    render(<PasteView {...defaultProps} />);
    const counter = screen.getByText(/0 \/ 2,000/);
    expect(counter).toHaveAttribute('aria-live', 'polite');
  });
});

describe('PasteView — callbacks', () => {
  it('calls onAnnotate when the primary CTA is clicked with valid text', () => {
    const onAnnotate = vi.fn();
    render(
      <PasteView
        {...defaultProps}
        paste={{ title: '', source: '', text: 'había una vez' }}
        onAnnotate={onAnnotate}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /annotate →/i }));
    expect(onAnnotate).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when "cancel" is clicked', () => {
    const onCancel = vi.fn();
    render(<PasteView {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onChange("text", value) when the textarea is typed into', () => {
    const onChange = vi.fn();
    render(<PasteView {...defaultProps} onChange={onChange} />);
    const ta = screen.getByLabelText(/passage/i);
    fireEvent.change(ta, { target: { value: 'nuevo' } });
    expect(onChange).toHaveBeenCalledWith('text', 'nuevo');
  });

  it('calls onChange("title", value) when the title input is typed into', () => {
    const onChange = vi.fn();
    render(<PasteView {...defaultProps} onChange={onChange} />);
    const input = screen.getByLabelText(/title or source/i);
    fireEvent.change(input, { target: { value: 'BBC News' } });
    expect(onChange).toHaveBeenCalledWith('title', 'BBC News');
  });
});

describe('PasteView — loading state', () => {
  it('disables both action buttons while isLoading is true', () => {
    render(
      <PasteView
        {...defaultProps}
        paste={{ title: '', source: '', text: 'había' }}
        isLoading={true}
      />,
    );
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /annotating…/i }),
    ).toBeDisabled();
  });

  it('shows the "annotating…" label while loading (no plain "annotate →")', () => {
    render(
      <PasteView
        {...defaultProps}
        paste={{ title: '', source: '', text: 'había' }}
        isLoading={true}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /^annotate →$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /annotating…/i })).toBeInTheDocument();
  });
});

describe('PasteView — mobile reflow', () => {
  it('drops the desktop max-width cap so the form goes full-width on mobile (Req 8.4)', () => {
    const { container } = render(<PasteView {...defaultProps} />);
    expect(container.firstChild).toHaveClass('mobile:max-w-none');
    expect(container.firstChild).toHaveClass('max-w-[720px]');
  });

  it('keeps the char-limit disabled behavior intact at mobile width', () => {
    // Reflow is class-only — the limit gate is unchanged.
    render(
      <PasteView
        {...defaultProps}
        paste={{ title: '', source: '', text: 'a'.repeat(2001) }}
      />,
    );
    expect(screen.getByRole('button', { name: /annotate →/i })).toBeDisabled();
  });
});

describe('PasteView — errorBody card', () => {
  it('renders the inline error card with heading + body when errorBody is non-null', () => {
    render(
      <PasteView
        {...defaultProps}
        errorBody="evaluation temporarily unavailable — try again in a moment."
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("couldn't annotate this");
    expect(alert).toHaveTextContent(/evaluation temporarily unavailable/);
  });

  it('hides the error card when errorBody is null', () => {
    render(<PasteView {...defaultProps} errorBody={null} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
