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

beforeEach(() => {
  pushMock.mockClear();
});

// ---------------------------------------------------------------------------
// Button labels (Req 6.1)
// ---------------------------------------------------------------------------

describe('DebriefFooter — button labels', () => {
  it('renders "another session" primary button', () => {
    render(<DebriefFooter tier="high" />);
    expect(screen.getByRole('button', { name: 'another session' })).toBeDefined();
  });

  it('renders "see your progress →" ghost button', () => {
    render(<DebriefFooter tier="high" />);
    expect(
      screen.getByRole('button', { name: /see your progress/ }),
    ).toBeDefined();
  });

  it('renders "done" ghost button', () => {
    render(<DebriefFooter tier="high" />);
    expect(screen.getByRole('button', { name: 'done' })).toBeDefined();
  });

  it('renders exactly three buttons', () => {
    render(<DebriefFooter tier="high" />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Click handlers (Req 6.2, 6.3, 6.4)
// ---------------------------------------------------------------------------

describe('DebriefFooter — router push targets', () => {
  it('clicking "another session" pushes /drill (Req 6.2)', () => {
    render(<DebriefFooter tier="high" />);
    fireEvent.click(screen.getByRole('button', { name: 'another session' }));
    expect(pushMock).toHaveBeenCalledExactlyOnceWith('/drill');
  });

  it('clicking "see your progress" pushes /progress (Req 6.3)', () => {
    render(<DebriefFooter tier="mid" />);
    fireEvent.click(
      screen.getByRole('button', { name: /see your progress/ }),
    );
    expect(pushMock).toHaveBeenCalledExactlyOnceWith('/progress');
  });

  it('clicking "done" pushes / (Req 6.4)', () => {
    render(<DebriefFooter tier="low" />);
    fireEvent.click(screen.getByRole('button', { name: 'done' }));
    expect(pushMock).toHaveBeenCalledExactlyOnceWith('/');
  });
});

// ---------------------------------------------------------------------------
// Tier prop is accepted and does not affect routing in v1
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mobile reflow → sticky bottom action bar (Req 7.5, 11.1)
// ---------------------------------------------------------------------------

describe('DebriefFooter — mobile sticky action bar', () => {
  it('applies sticky bottom-bar classes at mobile while keeping all three actions', () => {
    const { container } = render(<DebriefFooter tier="high" />);
    const bar = container.firstChild as HTMLElement;
    expect(bar).toHaveClass(
      'mobile:sticky',
      'mobile:bottom-0',
      'mobile:bg-paper',
      'mobile:flex-col',
    );
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('gives each control a ≥44px mobile tap target', () => {
    render(<DebriefFooter tier="high" />);
    for (const name of [/see your progress/, 'done', 'another session']) {
      expect(screen.getByRole('button', { name })).toHaveClass('mobile:min-h-[44px]');
    }
  });
});

describe('DebriefFooter — tier prop accepted', () => {
  it('accepts tier="high" without throwing or changing route targets', () => {
    render(<DebriefFooter tier="high" />);
    fireEvent.click(screen.getByRole('button', { name: 'another session' }));
    expect(pushMock).toHaveBeenCalledWith('/drill');
  });

  it('accepts tier="mid" without throwing or changing route targets', () => {
    render(<DebriefFooter tier="mid" />);
    fireEvent.click(screen.getByRole('button', { name: 'another session' }));
    expect(pushMock).toHaveBeenCalledWith('/drill');
  });

  it('accepts tier="low" without throwing or changing route targets', () => {
    render(<DebriefFooter tier="low" />);
    fireEvent.click(screen.getByRole('button', { name: 'another session' }));
    expect(pushMock).toHaveBeenCalledWith('/drill');
  });
});
