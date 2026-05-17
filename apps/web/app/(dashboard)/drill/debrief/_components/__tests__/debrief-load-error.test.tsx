import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DebriefLoadError } from '../debrief-load-error';

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

describe('DebriefLoadError', () => {
  it('renders the "couldn\'t load this debrief" title', () => {
    render(<DebriefLoadError onRetry={vi.fn()} />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: "couldn't load this debrief",
      }),
    ).toBeDefined();
  });

  it('renders a body line that reassures progress is saved', () => {
    render(<DebriefLoadError onRetry={vi.fn()} />);
    expect(
      screen.getByText(/your progress is saved/i),
    ).toBeDefined();
  });

  it('renders a primary "try again" button that calls onRetry', () => {
    const onRetry = vi.fn();
    render(<DebriefLoadError onRetry={onRetry} />);

    const retry = screen.getByRole('button', { name: 'try again' });
    expect(retry).toBeDefined();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders a "back to drill" secondary button that calls router.push("/drill")', () => {
    render(<DebriefLoadError onRetry={vi.fn()} />);

    const back = screen.getByRole('button', { name: 'back to drill' });
    fireEvent.click(back);
    expect(pushMock).toHaveBeenCalledExactlyOnceWith('/drill');
  });
});
