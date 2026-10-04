import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopicToc } from '../topic-toc';

const sections = [
  { id: 'what-is-it', title: 'what is it?' },
  { id: 'when-to-use-it', title: 'when to use it' },
  { id: 'formation', title: 'formation' },
];

describe('TopicToc', () => {
  it('renders a real anchor per section so it works without JavaScript', () => {
    render(<TopicToc sections={sections} />);
    expect(screen.getByRole('link', { name: 'what is it?' })).toHaveAttribute(
      'href',
      '#what-is-it',
    );
    expect(screen.getByRole('link', { name: 'formation' })).toHaveAttribute(
      'href',
      '#formation',
    );
  });

  it('is NOT itself sticky — the sticky context belongs to the parent column', () => {
    // This pins a bug that reached production. With `sticky` on this nav, it
    // detached and held its offset while the practise rail — an ordinary
    // sibling below it in the same flex column — scrolled up underneath, so
    // the table of contents rendered straight through the practise card and
    // the sign-up call to action. The fix moved `sticky` to the <aside> in
    // `grammar-topic.tsx` so the nav and the rail travel as one block.
    const { container } = render(<TopicToc sections={sections} />);
    const nav = container.querySelector('nav');
    expect(nav).not.toBeNull();
    expect(nav!.className).not.toMatch(/\bsticky\b/);
    expect(nav!.className).not.toMatch(/\btop-\[/);
  });

  it('renders an empty list rather than throwing when a topic has no sections', () => {
    render(<TopicToc sections={[]} />);
    expect(screen.getByRole('navigation', { name: 'On this page' })).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
