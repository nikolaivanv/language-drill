import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AcademicRigourPage } from '../academic-rigour';
import { AcademicRigourMobile } from '../academic-rigour-mobile';

describe('AcademicRigourPage (desktop)', () => {
  it('renders the hero, the stat band and the per-language curriculum', () => {
    render(<AcademicRigourPage />);
    expect(
      screen.getByRole('heading', { name: /Practice you can actually trust/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('298')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Each course sits on an official curriculum/i }),
    ).toBeInTheDocument();
    // the CTA offers a sign-up
    expect(screen.getAllByRole('link', { name: /sign up free/i }).length).toBeGreaterThan(0);
  });

  it('links back to the home page', () => {
    render(<AcademicRigourPage />);
    const back = screen.getAllByRole('link', { name: /back to home/i });
    expect(back.length).toBeGreaterThan(0);
    expect(back[0]).toHaveAttribute('href', '/');
  });

  it('carries the new production-first tagline in the footer, not the old one', () => {
    render(<AcademicRigourPage />);
    expect(screen.getByText(/type it, don’t tap it/)).toBeInTheDocument();
    expect(screen.queryByText(/read, save, produce/)).not.toBeInTheDocument();
  });
});

describe('AcademicRigourMobile', () => {
  it('renders the reflowed page with the stat band', () => {
    render(<AcademicRigourMobile />);
    expect(
      screen.getByRole('heading', { name: /Practice you can actually trust/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('298')).toBeInTheDocument();
  });
});
