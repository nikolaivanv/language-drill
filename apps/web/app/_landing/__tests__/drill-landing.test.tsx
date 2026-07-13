import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The carousel and ChatGPT-compare pull in their own heavy trees; stub them so
// this test focuses on the landing chrome (header link, hero eyebrow, strip).
vi.mock('../practice-carousel', () => ({
  PracticeCarousel: () => <section data-testid="practice-carousel" />,
}));
vi.mock('../chatgpt-compare', () => ({
  ChatGPTCompare: () => <section data-testid="chatgpt-compare" />,
}));
// LegalLinks reads the ConsentProvider context, which isn't mounted here.
vi.mock('../../../components/legal/legal-links', () => ({
  LegalLinks: () => <div data-testid="legal-links" />,
}));

import { DrillLanding } from '../drill-landing';

describe('DrillLanding — academic-rigour tweaks', () => {
  it('links to the academic-rigour page from the header', () => {
    render(<DrillLanding />);
    const link = screen.getByRole('link', { name: 'Academic rigour' });
    expect(link).toHaveAttribute('href', '/academic-rigour');
  });

  it('surfaces the academic-rigour stat band with a link to the deep-dive', () => {
    render(<DrillLanding />);
    const madeLink = screen.getByRole('link', { name: /See how the material is made/i });
    expect(madeLink).toHaveAttribute('href', '/academic-rigour');
    expect(screen.getByText('298')).toBeInTheDocument();
  });

  it('uses the new production-first eyebrow, not the read/save/review/produce loop', () => {
    render(<DrillLanding />);
    expect(screen.getByText('Produce, don’t recognise')).toBeInTheDocument();
    expect(screen.queryByText(/Read · Save · Review · Produce/)).not.toBeInTheDocument();
  });

  it('shows the supported-languages strip in the hero', () => {
    render(<DrillLanding />);
    expect(screen.getByText('On the floor now')).toBeInTheDocument();
  });
});
