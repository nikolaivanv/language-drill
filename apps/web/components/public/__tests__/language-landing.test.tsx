import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageLanding } from '../language-landing';
import { track } from '../../../lib/analytics/track';

vi.mock('../../../lib/analytics/track', () => ({ track: vi.fn() }));

vi.mock('../landing-try-block', () => ({
  // The hero is a client component with its own fetching; this suite is about
  // the server-rendered content a crawler and a chooser actually read.
  LandingTryBlock: ({ drillHref }: { drillHref: string }) => (
    <a href={drillHref}>hero</a>
  ),
}));

const POINTS = {
  B1: [
    { key: 'es-b1-conditional', name: 'Conditional', category: 'tenses', order: 1, count: 12 },
    {
      key: 'es-b1-present-subjunctive',
      name: 'Present subjunctive',
      category: 'moods',
      order: 2,
      count: 52,
    },
  ],
  A2: [
    { key: 'es-a2-imperfect', name: 'Imperfect', category: 'tenses', order: 3, count: 20 },
  ],
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
  fetchMock.mockImplementation(async (url: string) => {
    const level = new URL(url).searchParams.get('level') as keyof typeof POINTS;
    return new Response(
      JSON.stringify({ points: POINTS[level] ?? [], language: 'ES', difficulty: level }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  // Deliberately NOT vi.unstubAllGlobals(): `vitest.setup.ts` installs the
  // jsdom IntersectionObserver polyfill with `vi.stubGlobal`, so unstubbing
  // everything here removes it for the rest of the file and every subsequent
  // `next/link` render dies on `IntersectionObserver is not defined`. Globals
  // are per-file in vitest, so leaving the fetch stub in place is harmless.
});

describe('LanguageLanding', () => {
  it('renders the point list server-side, so it is content a crawler can read', async () => {
    render(await LanguageLanding({ lang: 'ES' }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Spanish forms/);
    expect(screen.getByRole('link', { name: /Conditional/ })).toHaveAttribute(
      'href',
      '/try/forms?lang=ES&level=B1&point=es-b1-conditional',
    );
    expect(screen.getByText('Present subjunctive')).toBeInTheDocument();
  });

  it('groups by level and then category', async () => {
    render(await LanguageLanding({ lang: 'ES' }));
    expect(screen.getByRole('heading', { name: 'B1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'A2' })).toBeInTheDocument();
    expect(screen.getAllByText('Tenses').length).toBeGreaterThan(0);
    expect(screen.getByText('Moods')).toBeInTheDocument();
  });

  it('omits a level with no content rather than advertising a dead end', async () => {
    render(await LanguageLanding({ lang: 'ES' }));
    // ES offers A1/A2/B1; A1 returns no points in this fixture.
    expect(screen.queryByRole('heading', { name: 'A1' })).not.toBeInTheDocument();
  });

  it('still renders hero and call to action when the pool cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    render(await LanguageLanding({ lang: 'ES' }));

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create an account/ })).toBeInTheDocument();
    // No empty "What you can drill" shell.
    expect(screen.queryByText('What you can drill')).not.toBeInTheDocument();
  });

  it('tracks a click on the footer call to action', async () => {
    render(await LanguageLanding({ lang: 'TR' }));
    await userEvent.click(screen.getByRole('link', { name: /Create an account/ }));
    expect(track).toHaveBeenCalledWith('signup_cta_clicked', {
      surface: 'landing_footer',
      language: 'TR',
    });
  });

  it('does not fetch at all without an API base, and still renders', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    render(await LanguageLanding({ lang: 'DE' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/German forms/);
  });

  it('points the language rail at the other landings, not the drill', async () => {
    render(await LanguageLanding({ lang: 'ES' }));
    const rail = screen.getByRole('navigation', { name: 'language' });
    expect(within(rail).getByRole('link', { name: 'deutsch' })).toHaveAttribute('href', '/german');
    expect(within(rail).getByRole('link', { name: 'türkçe' })).toHaveAttribute('href', '/turkish');
  });
});
