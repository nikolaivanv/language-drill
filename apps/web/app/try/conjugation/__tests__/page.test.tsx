import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import TryConjugationPage from '../page';

// Isolate the page's own searchParams-parsing logic from the runner (which
// needs a QueryClientProvider and the api-client hook stack — out of scope
// for this file).
vi.mock('../_components/public-conjugation-runner', () => ({
  PublicConjugationRunner: ({
    lang,
    level,
    availableLevels,
  }: {
    lang: string;
    level: string;
    availableLevels: string[];
  }) => (
    <div data-testid="runner">
      {lang}/{level}/{availableLevels.join(',')}
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

  it('offers a static task instruction and an up-front "nothing is saved" line', async () => {
    render(await TryConjugationPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/type the form the cues ask for/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is saved/i)).toBeInTheDocument();
  });

  // Prod measurement at branch-time found zero approved conjugation rows for
  // ES/DE at B2 — offering it one click from the default would land a
  // stranger on an empty state.
  it('does not offer B2 in the level picker for ES or DE', async () => {
    const { unmount } = render(
      await TryConjugationPage({ searchParams: Promise.resolve({ lang: 'ES' }) }),
    );
    const esLevelNav = screen.getByRole('navigation', { name: 'level' });
    expect(within(esLevelNav).queryByRole('link', { name: 'B2' })).not.toBeInTheDocument();
    unmount();

    render(await TryConjugationPage({ searchParams: Promise.resolve({ lang: 'DE' }) }));
    const deLevelNav = screen.getByRole('navigation', { name: 'level' });
    expect(within(deLevelNav).queryByRole('link', { name: 'B2' })).not.toBeInTheDocument();
  });

  it('offers B2 in the level picker for TR', async () => {
    render(await TryConjugationPage({ searchParams: Promise.resolve({ lang: 'TR' }) }));
    const levelNav = screen.getByRole('navigation', { name: 'level' });
    expect(within(levelNav).getByRole('link', { name: 'B2' })).toBeInTheDocument();
  });

  it('falls back gracefully when the requested level is not valid for the language (guard)', async () => {
    render(
      await TryConjugationPage({
        searchParams: Promise.resolve({ lang: 'ES', level: 'B2' }),
      }),
    );
    // ES does not offer B2, so this must not render the runner at B2.
    expect(screen.getByTestId('runner')).toHaveTextContent('ES/B1');
  });

  it('the language nav never links to a level the target language does not offer', async () => {
    // Starting from TR/B2 (valid for TR), the DE link must not carry B2
    // forward — DE doesn't offer it.
    render(
      await TryConjugationPage({
        searchParams: Promise.resolve({ lang: 'TR', level: 'B2' }),
      }),
    );
    const languageNav = screen.getByRole('navigation', { name: 'language' });
    const deLink = within(languageNav).getByRole('link', { name: 'DE' });
    expect(deLink).toHaveAttribute('href', '/try/conjugation?lang=DE&level=B1');
  });
});
