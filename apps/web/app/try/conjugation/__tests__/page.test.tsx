import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import TryConjugationPage from '../page';

// Isolate the page's own searchParams-parsing logic from the runner (which
// needs a QueryClientProvider and the api-client hook stack — out of scope
// for this file).
vi.mock('../_components/public-conjugation-runner', () => ({
  PublicConjugationRunner: ({ lang, level }: { lang: string; level: string }) => (
    <div data-testid="runner">
      {lang}/{level}
    </div>
  ),
}));

describe('TryConjugationPage', () => {
  it('defaults to ES/B1 when no params are given', async () => {
    render(await TryConjugationPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId('runner')).toHaveTextContent('ES/B1');
  });

  it('honours valid single-value params', async () => {
    render(
      await TryConjugationPage({
        searchParams: Promise.resolve({ lang: 'TR', level: 'B2' }),
      }),
    );
    expect(screen.getByTestId('runner')).toHaveTextContent('TR/B2');
  });

  // Next's generated searchParams type is
  // `Promise<Record<string, string | string[] | undefined>>` — a repeated
  // query key (`?lang=ES&lang=DE`, exactly what a hand-edited or
  // tool-generated share link produces) arrives as an array, not a string.
  // `(raw ?? '').toUpperCase()` on an array throws; this must render the
  // fallback instead of blowing up the page.
  it('does not throw when a param is duplicated in the URL, and falls back gracefully', async () => {
    render(
      await TryConjugationPage({
        searchParams: Promise.resolve({ lang: ['TR', 'DE'] }),
      }),
    );
    // Picks the first entry deterministically rather than throwing.
    expect(screen.getByTestId('runner')).toHaveTextContent('TR/B1');
  });

  it('falls back to the default level for an unrecognised value', async () => {
    render(
      await TryConjugationPage({
        searchParams: Promise.resolve({ level: 'zzz' }),
      }),
    );
    expect(screen.getByTestId('runner')).toHaveTextContent('ES/B1');
  });

  it('does not throw when a duplicated param is also invalid, and falls back gracefully', async () => {
    render(
      await TryConjugationPage({
        searchParams: Promise.resolve({ level: ['zzz', 'B2'] }),
      }),
    );
    expect(screen.getByTestId('runner')).toHaveTextContent('ES/B1');
  });

  it('renders a heading and labelled level/language navigation', async () => {
    render(
      await TryConjugationPage({
        searchParams: Promise.resolve({ lang: 'DE', level: 'A2' }),
      }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    const levelNav = screen.getByRole('navigation', { name: 'level' });
    const languageNav = screen.getByRole('navigation', { name: 'language' });
    expect(within(levelNav).getByRole('link', { name: 'A2' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(languageNav).getByRole('link', { name: 'DE' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
