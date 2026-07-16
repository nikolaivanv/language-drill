import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TheoryHubLink } from '../theory-hub-link';

describe('TheoryHubLink', () => {
  it('links to the theory hub detail page in a new tab', () => {
    render(<TheoryHubLink topicId="subjunctive" title="el subjuntivo" />);
    const link = screen.getByRole('link', {
      name: /open el subjuntivo in theory hub \(new tab\)/i,
    });
    expect(link).toHaveAttribute('href', '/theory/subjunctive');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    expect(link).toHaveTextContent('open in new tab');
  });

  it('encodes topic ids that need URL escaping', () => {
    render(<TheoryHubLink topicId="foo/bar" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/theory/foo%2Fbar');
  });
});
