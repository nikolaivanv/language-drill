import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CoachCard } from '../coach-card';

describe('CoachCard', () => {
  it('renders the coach message when expanded', () => {
    render(<CoachCard message="let's warm up with a cloze" />);
    expect(screen.getByText("let's warm up with a cloze")).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses and expands the message on toggle', () => {
    render(<CoachCard message="coach guidance" />);
    const toggle = screen.getByRole('button');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('coach guidance')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('coach guidance')).toBeInTheDocument();
  });

  it('can start collapsed', () => {
    render(<CoachCard message="hidden initially" defaultExpanded={false} />);
    expect(screen.queryByText('hidden initially')).not.toBeInTheDocument();
  });
});
