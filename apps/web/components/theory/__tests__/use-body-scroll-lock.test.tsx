import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useBodyScrollLock } from '../use-body-scroll-lock';

function Harness({ active }: { active: boolean }) {
  useBodyScrollLock(active);
  return null;
}

describe('useBodyScrollLock', () => {
  beforeEach(() => {
    // Reset to a known starting state before each test so we can assert the
    // restore behavior.
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  });

  it('locks both <html> and <body> overflow when active', () => {
    render(<Harness active={true} />);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('does nothing when inactive', () => {
    document.body.style.overflow = 'auto';
    document.documentElement.style.overflow = 'auto';

    render(<Harness active={false} />);

    expect(document.body.style.overflow).toBe('auto');
    expect(document.documentElement.style.overflow).toBe('auto');
  });

  it('restores the previous overflow values on unmount', () => {
    document.body.style.overflow = 'auto';
    document.documentElement.style.overflow = 'scroll';

    const { unmount } = render(<Harness active={true} />);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('auto');
    expect(document.documentElement.style.overflow).toBe('scroll');
  });
});
