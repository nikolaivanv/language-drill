import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DebriefNotFound } from '../debrief-not-found';

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

describe('DebriefNotFound', () => {
  it('renders the "session not found" title', () => {
    render(<DebriefNotFound />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'session not found' }),
    ).toBeDefined();
  });

  it('renders an explanatory body line', () => {
    render(<DebriefNotFound />);
    // Substring match — the full sentence is long.
    expect(
      screen.getByText(/this session may not exist or may not be yours/),
    ).toBeDefined();
  });

  it('renders a "back to drill" primary button', () => {
    render(<DebriefNotFound />);
    expect(
      screen.getByRole('button', { name: 'back to drill' }),
    ).toBeDefined();
  });

  it('clicking the button calls router.push("/drill")', () => {
    render(<DebriefNotFound />);
    fireEvent.click(screen.getByRole('button', { name: 'back to drill' }));
    expect(pushMock).toHaveBeenCalledExactlyOnceWith('/drill');
  });
});
