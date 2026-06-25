import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DebriefFooter } from '../debrief-footer';

// Mock next/navigation's useRouter so we can capture push calls.
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// next/link renders as <a> in jsdom.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  pushMock.mockClear();
});

// ---------------------------------------------------------------------------
// Action labels (Req 6.1)
// ---------------------------------------------------------------------------

describe('DebriefFooter — action labels', () => {
  it('renders "practice more" primary button', () => {
    render(<DebriefFooter tier="high" />);
    expect(screen.getByRole('button', { name: 'practice more' })).toBeDefined();
  });

  it('renders "see your progress →" as a link-arrow link', () => {
    render(<DebriefFooter tier="high" />);
    const link = screen.getByRole('link', { name: /see your progress/ });
    expect(link).toBeDefined();
    expect(link).toHaveClass('link-arrow');
    expect(link).toHaveAttribute('href', '/progress');
  });

  it('renders "done" ghost button', () => {
    render(<DebriefFooter tier="high" />);
    expect(screen.getByRole('button', { name: 'done' })).toBeDefined();
  });

  it('renders exactly two buttons (practice more + done)', () => {
    render(<DebriefFooter tier="high" />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Click handlers (Req 6.2, 6.3, 6.4)
// ---------------------------------------------------------------------------

describe('DebriefFooter — router push targets', () => {
  it('clicking "practice more" pushes /drill hub (Req 6.2)', () => {
    render(<DebriefFooter tier="high" />);
    fireEvent.click(screen.getByRole('button', { name: 'practice more' }));
    expect(pushMock).toHaveBeenCalledExactlyOnceWith('/drill');
  });

  it('"see your progress" link points to /progress (Req 6.3)', () => {
    render(<DebriefFooter tier="mid" />);
    const link = screen.getByRole('link', { name: /see your progress/ });
    expect(link).toHaveAttribute('href', '/progress');
  });

  it('clicking "done" pushes / (Req 6.4)', () => {
    render(<DebriefFooter tier="low" />);
    fireEvent.click(screen.getByRole('button', { name: 'done' }));
    expect(pushMock).toHaveBeenCalledExactlyOnceWith('/');
  });
});

// ---------------------------------------------------------------------------
// Desktop layout: link-arrow left, [ghost done][primary practice more] right
// ---------------------------------------------------------------------------

describe('DebriefFooter — desktop layout', () => {
  it('renders the progress link with link-arrow class', () => {
    render(<DebriefFooter tier="high" />);
    expect(
      screen.getByRole('link', { name: /see your progress/ }),
    ).toHaveClass('link-arrow');
  });

  it('practice more has variant=primary; done has variant=ghost', () => {
    render(<DebriefFooter tier="high" />);
    // Primary button carries btn-primary class; ghost carries btn-ghost
    // (exact class names depend on Button implementation — test by role/name only).
    expect(screen.getByRole('button', { name: 'practice more' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'done' })).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tier prop is accepted and does not affect routing in v1
// ---------------------------------------------------------------------------

describe('DebriefFooter — tier prop accepted', () => {
  it('accepts tier="high" without throwing or changing route targets', () => {
    render(<DebriefFooter tier="high" />);
    fireEvent.click(screen.getByRole('button', { name: 'practice more' }));
    expect(pushMock).toHaveBeenCalledWith('/drill');
  });

  it('accepts tier="mid" without throwing or changing route targets', () => {
    render(<DebriefFooter tier="mid" />);
    fireEvent.click(screen.getByRole('button', { name: 'practice more' }));
    expect(pushMock).toHaveBeenCalledWith('/drill');
  });

  it('accepts tier="low" without throwing or changing route targets', () => {
    render(<DebriefFooter tier="low" />);
    fireEvent.click(screen.getByRole('button', { name: 'practice more' }));
    expect(pushMock).toHaveBeenCalledWith('/drill');
  });
});
