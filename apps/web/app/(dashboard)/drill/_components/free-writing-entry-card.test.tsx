import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FreeWritingEntryCard } from './free-writing-entry-card';

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

describe('FreeWritingEntryCard', () => {
  it('links to the free-writing route', () => {
    render(<FreeWritingEntryCard />);
    const link = screen.getByRole('link', { name: /free writing/i });
    expect(link).toHaveAttribute('href', '/drill/free-writing');
  });
});
