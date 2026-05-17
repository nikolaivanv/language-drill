import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import type { DebriefResponse } from '@language-drill/api-client';
import DebriefPage from './page';

// ---------------------------------------------------------------------------
// Mocks — Clerk, next/navigation, next/link, api-client
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue('test-token');

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// next/link in jsdom is fine to render as <a>.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const mockUseSessionDebrief = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  useSessionDebrief: (...args: unknown[]) => mockUseSessionDebrief(...args),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function makeClozeItem(index: number, overrides: Record<string, unknown> = {}) {
  return {
    exerciseId: `aaaaaaaa-${index}aaa-4aaa-8aaa-aaaaaaaaaaaa`,
    type: ExerciseType.CLOZE,
    contentJson: {
      type: ExerciseType.CLOZE,
      instructions: 'fill the blank',
      sentence: `manifest-${index} ___ end.`,
      correctAnswer: 'middle',
      topicHint: undefined,
    },
    status: 'correct' as const,
    userAnswer: 'middle',
    score: 0.95,
    evaluation: {
      score: 0.95,
      grammarAccuracy: 0.95,
      vocabularyRange: 'B1',
      taskAchievement: 0.95,
      feedback: 'nice.',
      errors: [],
      estimatedCefrEvidence: 'B1',
    },
    ...overrides,
  };
}

function makeDebriefResponse(
  overrides: Partial<DebriefResponse> = {},
): DebriefResponse {
  return {
    id: SESSION_ID,
    language: Language.ES,
    difficulty: CefrLevel.B1,
    startedAt: '2026-05-04T10:00:00.000Z',
    completedAt: '2026-05-04T10:04:00.000Z',
    durationSeconds: 240,
    exerciseCount: 5,
    correctCount: 4,
    attemptedCount: 5,
    skippedCount: 0,
    items: [0, 1, 2, 3, 4].map((i) => makeClozeItem(i)) as DebriefResponse['items'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// React's `use()` reads thenables that follow the fulfilled-thenable protocol
// (`status: 'fulfilled'`, `value`) synchronously, without suspending. Tests
// use this so Next.js 15-style `params: Promise<...>` props can be read in
// the same render — no Suspense fallback needed in jsdom.
function fulfilledThenable<T>(value: T): Promise<T> {
  const thenable = Promise.resolve(value) as Promise<T> & {
    status?: string;
    value?: T;
  };
  thenable.status = 'fulfilled';
  thenable.value = value;
  return thenable;
}

function renderPage() {
  return render(
    <DebriefPage params={fulfilledThenable({ sessionId: SESSION_ID })} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DebriefPage', () => {
  // -------------------------------------------------------------------------
  describe('success path', () => {
    it('renders header + tabs + footer; default tab is "debrief"; review content NOT rendered', async () => {
      mockUseSessionDebrief.mockReturnValue({
        data: makeDebriefResponse(),
        isPending: false,
        isError: false,
        error: null,
      });

      renderPage();

      // Header — tier-keyed display title (4/5 → 80% → high tier → "nice work.")
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
        'nice work.',
      );

      // Tablist + both tab buttons
      expect(screen.getByRole('tablist')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'debrief' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByRole('tab', { name: 'review' })).toHaveAttribute(
        'aria-selected',
        'false',
      );

      // Footer buttons
      expect(
        screen.getByRole('button', { name: 'another session' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /see your progress/ }),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'done' })).toBeInTheDocument();

      // Review tab content is NOT rendered while debrief tab is active.
      // ReviewItemCard renders text like "#1", "#2", ... — none should appear.
      expect(screen.queryByText('#1')).not.toBeInTheDocument();
    });

    it('switching to review tab renders review cards in manifest order; debrief content NOT rendered', async () => {
      mockUseSessionDebrief.mockReturnValue({
        data: makeDebriefResponse(),
        isPending: false,
        isError: false,
        error: null,
      });

      renderPage();

      const reviewTab = await screen.findByRole('tab', { name: 'review' });
      fireEvent.click(reviewTab);

      // Review cards now visible — index "#1" through "#5" in manifest order.
      const indexLabels = ['#1', '#2', '#3', '#4', '#5'];
      const found = indexLabels.map((label) => screen.getByText(label));
      // Verify DOM order matches manifest order.
      for (let i = 1; i < found.length; i++) {
        expect(
          found[i - 1].compareDocumentPosition(found[i]) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }

      // Debrief tab content (the coach "what's next" eyebrow) is gone.
      expect(screen.queryByText("what's next")).not.toBeInTheDocument();

      // aria-selected has flipped.
      expect(reviewTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: 'debrief' })).toHaveAttribute(
        'aria-selected',
        'false',
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('loading state', () => {
    it('renders skeleton while query is pending; no header/tabs/footer', async () => {
      mockUseSessionDebrief.mockReturnValue({
        data: undefined,
        isPending: true,
        isError: false,
        error: null,
      });

      const { container } = renderPage();

      // Skeleton renders immediately (synchronous fulfilled-thenable params).
      expect(container.querySelector('.animate-pulse')).toBeInTheDocument();

      // No header, no tabs, no footer in the loading state.
      expect(
        screen.queryByRole('heading', { level: 1 }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'another session' }),
      ).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  describe('error states (404 → DebriefNotFound; everything else → DebriefLoadError)', () => {
    it('renders DebriefNotFound on 404; no tabs, no footer', async () => {
      const err = new Error('Session not found') as Error & { status?: number };
      err.status = 404;
      mockUseSessionDebrief.mockReturnValue({
        data: undefined,
        isPending: false,
        isError: true,
        error: err,
        refetch: vi.fn(),
      });

      renderPage();

      expect(
        await screen.findByRole('heading', { level: 1, name: 'session not found' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'back to drill' }),
      ).toBeInTheDocument();

      // No tabs, no debrief footer.
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'another session' }),
      ).not.toBeInTheDocument();
    });

    it('renders DebriefLoadError on a 5xx; clicking "try again" calls query.refetch', async () => {
      const refetch = vi.fn();
      const err = new Error('Bad gateway 502') as Error & { status?: number };
      err.status = 502;
      mockUseSessionDebrief.mockReturnValue({
        data: undefined,
        isPending: false,
        isError: true,
        error: err,
        refetch,
      });

      renderPage();

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: "couldn't load this debrief",
        }),
      ).toBeInTheDocument();
      const retryButton = screen.getByRole('button', { name: 'try again' });
      fireEvent.click(retryButton);
      expect(refetch).toHaveBeenCalledTimes(1);

      // The 404 fallback is NOT what renders here — assert by absence.
      expect(
        screen.queryByRole('heading', { level: 1, name: 'session not found' }),
      ).not.toBeInTheDocument();
    });

    it('renders DebriefLoadError when the error has no status (network / parse failure)', async () => {
      const refetch = vi.fn();
      const err = new Error('Debrief response shape mismatch');
      mockUseSessionDebrief.mockReturnValue({
        data: undefined,
        isPending: false,
        isError: true,
        error: err,
        refetch,
      });

      renderPage();

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: "couldn't load this debrief",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'try again' }),
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  describe('footer router actions', () => {
    beforeEach(() => {
      mockUseSessionDebrief.mockReturnValue({
        data: makeDebriefResponse(),
        isPending: false,
        isError: false,
        error: null,
      });
    });

    it('clicking "another session" calls router.push("/drill")', async () => {
      renderPage();
      const button = await screen.findByRole('button', { name: 'another session' });
      fireEvent.click(button);
      expect(mockPush).toHaveBeenCalledWith('/drill');
    });

    it('clicking "see your progress →" calls router.push("/progress")', async () => {
      renderPage();
      const button = await screen.findByRole('button', { name: /see your progress/ });
      fireEvent.click(button);
      expect(mockPush).toHaveBeenCalledWith('/progress');
    });

    it('clicking "done" calls router.push("/")', async () => {
      renderPage();
      const button = await screen.findByRole('button', { name: 'done' });
      fireEvent.click(button);
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });
});
