import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { Language } from '@language-drill/shared';
import { GreetingBlock } from '../greeting-block';

// ---------------------------------------------------------------------------
// Fixed clock — Mon 2026-05-04 10:00 local (mid-morning)
// ---------------------------------------------------------------------------
// Times are in the host machine's local timezone — `new Date(2026, 4, 4, 10)`
// guarantees `.getHours() === 10` regardless of TZ, which is what
// `timeOfDayGreeting` checks. Locking this prevents the test from flipping
// when run in a different timezone.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 4, 4, 10, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GreetingBlock — server render (pre-mount placeholder)', () => {
  it('does not include any time-of-day greeting in the SSR HTML', () => {
    const html = renderToString(
      <GreetingBlock language={Language.ES} firstName="juno" />,
    );
    expect(html).not.toMatch(/good (morning|afternoon|evening)/i);
    expect(html).not.toContain('juno');
  });

  it('renders an aria-hidden placeholder div so layout is stable', () => {
    const html = renderToString(
      <GreetingBlock language={Language.ES} firstName="juno" />,
    );
    expect(html).toContain('aria-hidden');
  });
});

describe('GreetingBlock — client render (post-mount)', () => {
  it('renders the greeting and the first name when provided', () => {
    render(<GreetingBlock language={Language.ES} firstName="juno" />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('good morning, juno.');
  });

  it('omits the comma and the name when firstName is null', () => {
    render(<GreetingBlock language={Language.ES} firstName={null} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toMatch(
      /^good (morning|afternoon|evening)\.$/,
    );
    expect(heading.textContent).toBe('good morning.');
  });

  it('eyebrow contains the lowercased language name', () => {
    const { container } = render(
      <GreetingBlock language={Language.DE} firstName={null} />,
    );
    // Eyebrow paragraph is the only `t-micro` element in the block.
    const eyebrow = container.querySelector('.t-micro');
    expect(eyebrow?.textContent).toContain('german');
  });

  it('eyebrow includes the weekday and the ISO week number', () => {
    const { container } = render(
      <GreetingBlock language={Language.ES} firstName={null} />,
    );
    const eyebrow = container.querySelector('.t-micro');
    // 2026-05-04 is a Monday; ISO week 19.
    expect(eyebrow?.textContent).toContain('monday');
    expect(eyebrow?.textContent).toContain('week 19');
  });

  it('renders "good evening" at 22:00 (locked clock window)', () => {
    vi.setSystemTime(new Date(2026, 4, 4, 22, 0, 0));
    render(<GreetingBlock language={Language.ES} firstName={null} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'good evening.',
    );
  });
});
