import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CefrLevel } from '@language-drill/shared';
import { EmptyView } from '../empty-view';

// ---------------------------------------------------------------------------
// EmptyView — CTA wiring + CEFR-band fallback (Requirements 3.1–3.4).
// ---------------------------------------------------------------------------

describe('EmptyView — CTA', () => {
  it('calls onPaste when the primary CTA is clicked', () => {
    const onPaste = vi.fn();
    render(<EmptyView onPaste={onPaste} cefrToken={CefrLevel.B1} />);
    fireEvent.click(screen.getByRole('button', { name: /paste a text/i }));
    expect(onPaste).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyView — step 2 CEFR token', () => {
  it('renders the "~B1+" parenthetical when a CEFR level is provided', () => {
    render(<EmptyView onPaste={() => {}} cefrToken={CefrLevel.B1} />);
    expect(
      screen.getByText(/i highlight words rarer than your current band \(~B1\+\)\./),
    ).toBeInTheDocument();
  });

  it('renders the "~A2+" parenthetical for an A2 user', () => {
    render(<EmptyView onPaste={() => {}} cefrToken={CefrLevel.A2} />);
    expect(
      screen.getByText(/\(~A2\+\)/),
    ).toBeInTheDocument();
  });

  it('falls back to the bare "your current band" copy when cefrToken is null', () => {
    render(<EmptyView onPaste={() => {}} cefrToken={null} />);
    expect(
      screen.getByText('i highlight words rarer than your current band.'),
    ).toBeInTheDocument();
    // Make sure the parenthetical is NOT rendered.
    expect(screen.queryByText(/~[A-C][12]\+/)).not.toBeInTheDocument();
  });
});

describe('EmptyView — mobile reflow', () => {
  it('drops the desktop max-width cap so the column goes full-width on mobile (Req 8.5)', () => {
    const { container } = render(
      <EmptyView onPaste={() => {}} cefrToken={CefrLevel.B1} />,
    );
    expect(container.firstChild).toHaveClass('mobile:max-w-none', 'mobile:mt-[32px]');
    // Desktop cap is preserved.
    expect(container.firstChild).toHaveClass('max-w-[640px]');
  });
});

describe('EmptyView — header copy invariants', () => {
  it('renders the Caveat eyebrow, hero title, and body paragraph', () => {
    render(<EmptyView onPaste={() => {}} cefrToken={CefrLevel.B1} />);
    expect(screen.getByText('read in the wild')).toBeInTheDocument();
    expect(
      screen.getByText("paste anything you're reading."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a paragraph from a book/i),
    ).toBeInTheDocument();
  });

  it('renders the "how it works" heading and all four ordered steps', () => {
    render(<EmptyView onPaste={() => {}} cefrToken={CefrLevel.B1} />);
    expect(screen.getByText('how it works')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toMatch(/paste a paragraph/i);
    expect(items[2].textContent).toMatch(/tap a word/i);
    expect(items[3].textContent).toMatch(/from your reading/i);
  });
});
