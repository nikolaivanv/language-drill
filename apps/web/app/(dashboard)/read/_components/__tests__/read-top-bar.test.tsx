import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadTopBar } from '../read-top-bar';

// ---------------------------------------------------------------------------
// ReadTopBar — view switching, aria-current, and the history count badge.
// ---------------------------------------------------------------------------

describe('ReadTopBar — clicks', () => {
  it('fires onChange("annotated") when "current" is clicked', () => {
    const onChange = vi.fn();
    render(<ReadTopBar view="history" onChange={onChange} historyCount={3} />);
    fireEvent.click(screen.getByRole('button', { name: /current/i }));
    expect(onChange).toHaveBeenCalledWith('annotated');
  });

  it('fires onChange("history") when "history" is clicked', () => {
    const onChange = vi.fn();
    render(
      <ReadTopBar view="annotated" onChange={onChange} historyCount={3} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    expect(onChange).toHaveBeenCalledWith('history');
  });

  it('fires onChange("pasting") when "+ paste" is clicked', () => {
    const onChange = vi.fn();
    render(
      <ReadTopBar view="annotated" onChange={onChange} historyCount={3} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /\+ paste/i }));
    expect(onChange).toHaveBeenCalledWith('pasting');
  });

  it('fires onChange("generating") when "+ generate" is clicked', () => {
    const onChange = vi.fn();
    render(
      <ReadTopBar view="annotated" onChange={onChange} historyCount={3} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /\+ generate/i }));
    expect(onChange).toHaveBeenCalledWith('generating');
  });
});

// ---------------------------------------------------------------------------
// aria-current on the active button (Requirement 14.6)
// ---------------------------------------------------------------------------

describe('ReadTopBar — aria-current', () => {
  it('marks "current" as aria-current="page" when view is annotated', () => {
    render(<ReadTopBar view="annotated" onChange={() => {}} historyCount={3} />);
    expect(screen.getByRole('button', { name: /current/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('button', { name: /history/i }),
    ).not.toHaveAttribute('aria-current');
    expect(
      screen.getByRole('button', { name: /\+ paste/i }),
    ).not.toHaveAttribute('aria-current');
  });

  it('marks "current" as aria-current="page" when view is empty (fallback owner)', () => {
    render(<ReadTopBar view="empty" onChange={() => {}} historyCount={0} />);
    expect(screen.getByRole('button', { name: /current/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('marks "history" as aria-current="page" when view is history', () => {
    render(<ReadTopBar view="history" onChange={() => {}} historyCount={3} />);
    expect(screen.getByRole('button', { name: /history/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('button', { name: /current/i }),
    ).not.toHaveAttribute('aria-current');
  });

  it('marks "+ paste" as aria-current="page" when view is pasting', () => {
    render(<ReadTopBar view="pasting" onChange={() => {}} historyCount={3} />);
    expect(screen.getByRole('button', { name: /\+ paste/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('marks "+ generate" as aria-current="page" when view is generating', () => {
    render(<ReadTopBar view="generating" onChange={() => {}} historyCount={3} />);
    expect(screen.getByRole('button', { name: /\+ generate/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('button', { name: /current/i }),
    ).not.toHaveAttribute('aria-current');
  });
});

// ---------------------------------------------------------------------------
// historyCount badge
// ---------------------------------------------------------------------------

describe('ReadTopBar — history count badge', () => {
  it('renders the numeric count inside the history button', () => {
    render(<ReadTopBar view="annotated" onChange={() => {}} historyCount={7} />);
    const button = screen.getByRole('button', { name: /history/i });
    expect(button.textContent).toMatch(/7/);
  });

  it('renders an em-dash placeholder when historyCount is undefined', () => {
    render(
      <ReadTopBar view="annotated" onChange={() => {}} historyCount={undefined} />,
    );
    const button = screen.getByRole('button', { name: /history/i });
    expect(button.textContent).toMatch(/—/);
  });

  it('renders 0 (not the placeholder) when historyCount is 0', () => {
    render(<ReadTopBar view="annotated" onChange={() => {}} historyCount={0} />);
    const button = screen.getByRole('button', { name: /history/i });
    expect(button.textContent).toMatch(/0/);
    expect(button.textContent).not.toMatch(/—/);
  });
});

// ---------------------------------------------------------------------------
// Header copy
// ---------------------------------------------------------------------------

describe('ReadTopBar — header copy', () => {
  it('renders the "reading" eyebrow and "read & collect" title', () => {
    render(<ReadTopBar view="annotated" onChange={() => {}} historyCount={3} />);
    expect(screen.getByText('reading')).toBeInTheDocument();
    // The & is wrapped in a <span> for accent styling; match by heading role
    expect(screen.getByRole('heading', { name: /read.*collect/i })).toBeInTheDocument();
  });
});
