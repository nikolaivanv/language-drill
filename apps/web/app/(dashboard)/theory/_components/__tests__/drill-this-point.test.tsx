import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { DrillThisPoint } from '../drill-this-point';

const FIND = { timeout: 5000 } as const;

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function makeFetch(body: unknown): AuthenticatedFetch {
  return vi.fn<AuthenticatedFetch>(async () => jsonResponse(body)) as unknown as AuthenticatedFetch;
}

function renderBlock(fetchFn: AuthenticatedFetch) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(
    <DrillThisPoint grammarPointKey="es-a2-ser-vs-estar" fetchFn={fetchFn} />,
    { wrapper: Wrapper },
  );
}

const INFO = {
  grammarPointKey: 'es-a2-ser-vs-estar',
  exerciseCounts: { cloze: 12, translation: 8, conjugation: 4 },
  mastery: {
    masteryScore: 0.82,
    confidence: 0.9,
    evidenceCount: 10,
    lastPracticedAt: '2026-07-01T00:00:00.000Z',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DrillThisPoint', () => {
  it('renders the mixed-drill link targeting the grammar point', async () => {
    renderBlock(makeFetch(INFO));

    const mixed = await screen.findByRole('link', { name: /mixed drill/i }, FIND);
    expect(mixed).toHaveAttribute(
      'href',
      '/drill?start=quick&grammarPoint=es-a2-ser-vs-estar',
    );
  });

  it('renders one chip per stocked mode with the right hrefs (conjugation has its own route)', async () => {
    renderBlock(makeFetch(INFO));
    await screen.findByRole('link', { name: /mixed drill/i }, FIND);

    expect(screen.getByRole('link', { name: 'cloze' })).toHaveAttribute(
      'href',
      '/drill?start=quick&grammarPoint=es-a2-ser-vs-estar&exerciseType=cloze',
    );
    expect(screen.getByRole('link', { name: 'translation' })).toHaveAttribute(
      'href',
      '/drill?start=quick&grammarPoint=es-a2-ser-vs-estar&exerciseType=translation',
    );
    expect(screen.getByRole('link', { name: 'conjugation' })).toHaveAttribute(
      'href',
      '/drill/conjugation?grammarPoint=es-a2-ser-vs-estar',
    );
  });

  it('renders a sentence-construction chip when the pool stocks it', async () => {
    renderBlock(
      makeFetch({
        ...INFO,
        exerciseCounts: { ...INFO.exerciseCounts, sentence_construction: 2 },
      }),
    );
    await screen.findByRole('link', { name: /mixed drill/i }, FIND);

    expect(screen.getByRole('link', { name: 'sentence construction' })).toHaveAttribute(
      'href',
      '/drill?start=quick&grammarPoint=es-a2-ser-vs-estar&exerciseType=sentence_construction',
    );
  });

  it('shows the mastery readout when mastery exists', async () => {
    renderBlock(makeFetch(INFO));
    await screen.findByRole('link', { name: /mixed drill/i }, FIND);

    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument(); // confidenceBand(90)
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('omits the mastery readout for a never-practiced point', async () => {
    renderBlock(
      makeFetch({ ...INFO, mastery: null }),
    );
    await screen.findByRole('link', { name: /mixed drill/i }, FIND);

    expect(screen.queryByText(/mastery/)).not.toBeInTheDocument();
  });

  it('renders nothing when the point has no exercises', async () => {
    const { container } = renderBlock(
      makeFetch({ grammarPointKey: 'es-a2-ser-vs-estar', exerciseCounts: {}, mastery: null }),
    );

    // Wait for the query to settle, then assert an empty render.
    await vi.waitFor(() => {
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the request fails (malformed payload → query error)', async () => {
    const { container } = renderBlock(makeFetch({ topics: [] }));

    await vi.waitFor(() => {
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    });
    expect(container).toBeEmptyDOMElement();
  });
});
