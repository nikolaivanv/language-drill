import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReadCollectCard } from '../read-collect-card';

describe('ReadCollectCard', () => {
  it('links the primary CTA to /read', () => {
    render(<ReadCollectCard />);
    const link = screen.getByRole('link', { name: /open reader/ });
    expect(link).toHaveAttribute('href', '/read');
  });

  it('renders the "new" chip and the prescribed copy', () => {
    render(<ReadCollectCard />);
    expect(screen.getByText('new')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'reading something this week?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /paste a paragraph — i'll mark words above your level and weave them into your next session\./,
      ),
    ).toBeInTheDocument();
  });

  it('contains no streak / XP / lesson copy', () => {
    const { container } = render(<ReadCollectCard />);
    expect(container.textContent ?? '').not.toMatch(/streak|xp|lesson/i);
  });
});
