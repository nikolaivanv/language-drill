import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FreeWritingBlock } from '../free-writing-block';

describe('FreeWritingBlock', () => {
  it('links to the standalone free-writing flow and shows the estimate', () => {
    render(<FreeWritingBlock estimatedMinutes={8} />);

    const link = screen.getByRole('link', { name: /start/i });
    expect(link).toHaveAttribute('href', '/drill/free-writing');
    expect(screen.getByText('free writing')).toBeInTheDocument();
    expect(screen.getByText('8 min')).toBeInTheDocument();
  });
});
