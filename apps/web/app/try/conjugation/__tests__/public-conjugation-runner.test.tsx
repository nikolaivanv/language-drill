import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PublicConjugationRunner } from '../_components/public-conjugation-runner';

const fetchMock = vi.fn();
vi.mock('@language-drill/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@language-drill/api-client')>()),
  createPublicFetch: () => fetchMock,
}));

function item(id: string, lemma: string, targetForm: string) {
  return {
    id,
    type: 'conjugation',
    language: 'TR',
    difficulty: 'B1',
    grammarPointKey: 'tr-b1-past',
    contentJson: {
      type: 'conjugation',
      instructions: 'Write the correct form.',
      lemma,
      lemmaGloss: 'to go',
      featureBundle: 'geçmiş zaman',
      targetForm,
      breakdown: `${lemma} breakdown`,
      exampleSentences: [`${lemma} example`],
    },
  };
}

function renderRunner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PublicConjugationRunner lang="TR" level="B1" />
    </QueryClientProvider>,
  );
}

describe('PublicConjugationRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('grades a correct answer locally, with no network call per answer', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ exercises: [item('a', 'gitmek', 'gitti')], available: 1 }),
      ),
    );
    renderRunner();

    await userEvent.type(await screen.findByRole('textbox'), 'gitti');
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));

    expect(screen.getByText('gitti')).toBeInTheDocument();
    // One fetch for the set, and only one.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a Turkish answer typed with a non-Turkish keyboard capital', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ exercises: [item('a', 'içmek', 'içti')], available: 1 }),
      ),
    );
    renderRunner();

    // "Içti" — capital I from a non-TR keyboard. gradeFluencyAnswer folds both ways.
    await userEvent.type(await screen.findByRole('textbox'), 'Içti');
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));

    expect(screen.getByText(/exact/i)).toBeInTheDocument();
  });

  it('ends on a debrief that reports the score and says nothing was saved', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          exercises: [item('a', 'gitmek', 'gitti'), item('b', 'gelmek', 'geldi')],
          available: 2,
        }),
      ),
    );
    renderRunner();

    await userEvent.type(await screen.findByRole('textbox'), 'gitti');
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await userEvent.type(screen.getByRole('textbox'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    await userEvent.click(screen.getByRole('button', { name: /see results/i }));

    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText(/wasn't saved/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign up/i })).toBeInTheDocument();
  });

  it('renders an honest empty state for a cell with no content', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ exercises: [], available: 0 })),
    );
    renderRunner();
    expect(await screen.findByText(/nothing to practise here yet/i)).toBeInTheDocument();
  });
});
