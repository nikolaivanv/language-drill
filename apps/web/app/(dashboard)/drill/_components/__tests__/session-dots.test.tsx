import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionDots } from '../session-dots';

describe('SessionDots', () => {
  it('renders one dot per item', () => {
    render(<SessionDots current={2} total={5} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('marks the current item with aria-current="step"', () => {
    render(<SessionDots current={3} total={5} />);
    const items = screen.getAllByRole('listitem');
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).not.toHaveAttribute('aria-current');
    expect(items[4]).not.toHaveAttribute('aria-current');
  });

  it('shows a check for past items and numbers for current/future', () => {
    render(<SessionDots current={3} total={4} />);
    const items = screen.getAllByRole('listitem');
    // positions 1 and 2 are past → check marks
    expect(items[0]).toHaveTextContent('✓');
    expect(items[1]).toHaveTextContent('✓');
    // current (position 3) and future (position 4) show their number
    expect(items[2]).toHaveTextContent('3');
    expect(items[3]).toHaveTextContent('4');
  });

  it('labels the list with the current position', () => {
    render(<SessionDots current={2} total={5} />);
    expect(screen.getByRole('list', { name: 'item 2 of 5' })).toBeInTheDocument();
  });
});
