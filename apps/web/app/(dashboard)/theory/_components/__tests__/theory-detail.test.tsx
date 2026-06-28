import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  act,
  type RenderOptions,
} from '@testing-library/react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Language } from '@language-drill/shared';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { TheoryDetail } from '../theory-detail';
import {
  ShellFooterProvider,
  useShellFooterSuppressed,
} from '../../../../../components/shell/shell-footer-context';
import { ConsentProvider } from '../../../../../components/consent/consent-provider';
import { mockIntersectionObserverInstances } from '../../../../../vitest.setup';

// findBy waitFor options. The 1s default can expire before the React Query
// resolution flushes when the full vitest suite runs files in parallel.
const FIND = { timeout: 5000 } as const;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// next/link → plain anchor (jsdom). Mirrors the index page test.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Fetch helpers (mirror use-theory-topics.test.ts)
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function errorWithStatus(message: string, status: number): Error {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

// A valid TheoryTopicJson body for the single-topic endpoint (DE has no static
// editorial topic, so `useTheoryTopic` runs the DB query and parses this).
const TOPIC_BODY = {
  id: 'der-dativ',
  title: 'der dativ',
  subtitle: 'the dative case',
  cefr: 'A2',
  sections: [
    {
      id: 'intro',
      title: 'introduction',
      body: [{ kind: 'paragraph', text: [{ kind: 'text', text: 'Intro text.' }] }],
    },
    {
      id: 'forms',
      title: 'forms',
      body: [{ kind: 'paragraph', text: [{ kind: 'text', text: 'Forms text.' }] }],
    },
  ],
};

// List payload consumed by `useTheoryTopics` (TheoryToc + TheoryEmpty). Includes
// a sibling topic so "other topics" navigation has something to click.
const LIST_TOPICS = [
  { id: 'der-dativ', title: 'der dativ', cefr: 'A2' },
  { id: 'der-akkusativ', title: 'der akkusativ', cefr: 'A2' },
];

type FetchOpts = { topicStatus?: number };

// One fetch that dispatches by URL shape: `/theory/DE/<id>` → the single topic,
// `/theory/DE` → the list. A non-200 `topicStatus` rejects the topic request
// with a status-carrying error (how `createAuthenticatedFetch` surfaces 4xx/5xx).
function makeFetch({ topicStatus = 200 }: FetchOpts = {}): AuthenticatedFetch {
  return vi.fn<AuthenticatedFetch>(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const isTopicReq = /\/theory\/[^/]+\/[^/]+$/.test(url);
    if (isTopicReq) {
      if (topicStatus !== 200) {
        throw errorWithStatus('topic request failed', topicStatus);
      }
      return jsonResponse(TOPIC_BODY);
    }
    return jsonResponse({ topics: LIST_TOPICS });
  }) as unknown as AuthenticatedFetch;
}

function renderDetail(
  fetchFn: AuthenticatedFetch,
  opts?: RenderOptions,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  // ConsentProvider: the article now renders <AppFooter/> at the end of its
  // scroller, whose legal links read consent state.
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ConsentProvider>{children}</ConsentProvider>
      </QueryClientProvider>
    );
  }
  return render(
    <TheoryDetail topicId="der-dativ" language={Language.DE} fetchFn={fetchFn} />,
    { wrapper: Wrapper, ...opts },
  );
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockIntersectionObserverInstances.length = 0;
});

describe('TheoryDetail', () => {
  it('renders the topic title, sections, and TOC on success', async () => {
    renderDetail(makeFetch());

    // Title (h1) once the topic resolves. Generous timeout: the full vitest
    // suite runs many files in parallel, and the default 1s findBy window can
    // expire before the React Query resolution flushes under CPU contention.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'der dativ' }, FIND),
    ).toBeInTheDocument();

    // Both sections render their heading + body.
    expect(screen.getByRole('heading', { name: 'introduction' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'forms' })).toBeInTheDocument();
    expect(screen.getByText(/Intro text\./)).toBeInTheDocument();
    expect(screen.getByText(/Forms text\./)).toBeInTheDocument();

    // TOC exposes a jump button per section.
    const toc = screen.getByRole('navigation', { name: /theory sections/i });
    expect(within_(toc, 'button', 'introduction')).toBeTruthy();
    expect(within_(toc, 'button', 'forms')).toBeTruthy();
  });

  it('tracks the active section id via the scroll-spy', async () => {
    renderDetail(makeFetch());
    await screen.findByRole('heading', { level: 1, name: 'der dativ' }, FIND);

    // The scroll-spy state is seeded before the sections exist (topic loads
    // async), so no TOC entry is active until the IntersectionObserver fires.
    expect(
      screen.getByRole('button', { name: 'forms' }),
    ).not.toHaveAttribute('aria-current');

    // Drive the captured IntersectionObserver to make the second section active.
    const observer =
      mockIntersectionObserverInstances[mockIntersectionObserverInstances.length - 1];
    const formsEl = document.getElementById('forms')!;
    act(() => {
      observer.callback(
        [
          {
            isIntersecting: true,
            intersectionRatio: 1,
            target: formsEl,
          } as unknown as IntersectionObserverEntry,
        ],
        observer as unknown as IntersectionObserver,
      );
    });

    expect(screen.getByRole('button', { name: 'forms' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(
      screen.getByRole('button', { name: 'introduction' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('renders TheoryEmpty with router-wired other-topic links on a 404', async () => {
    renderDetail(makeFetch({ topicStatus: 404 }));

    // Empty-state copy from theory-empty.tsx (the not-found branch).
    expect(
      await screen.findByText(/no theory written yet for/i, undefined, FIND),
    ).toBeInTheDocument();

    // The sibling topic from the list surfaces as an "other topic" link.
    expect(
      screen.getByRole('button', { name: /der akkusativ/i }),
    ).toBeInTheDocument();
  });

  it('navigates to the chosen topic when an other-topic link is clicked', async () => {
    renderDetail(makeFetch({ topicStatus: 404 }));
    const other = await screen.findByRole('button', { name: /der akkusativ/i }, FIND);

    fireEvent.click(other);

    expect(mockPush).toHaveBeenCalledWith('/theory/der-akkusativ');
  });

  it('renders the error state when the topic request fails (non-404)', async () => {
    renderDetail(makeFetch({ topicStatus: 500 }));

    expect(
      await screen.findByText(/couldn't load theory/i, undefined, FIND),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Footer reveal: the loaded article owns a full-height internal scroller, so
// the footer must live at the end of THAT scroller (revealing only when the
// reader reaches the bottom) and the shell footer must be suppressed.
// ---------------------------------------------------------------------------

const FOOTER_COPY = /© 2026 drill/i;

function SuppressionProbe() {
  return (
    <span data-testid="shell-footer-suppressed">
      {String(useShellFooterSuppressed())}
    </span>
  );
}

// Same as renderDetail, but inside a ShellFooterProvider (+ a probe reading the
// suppression flag) and a ConsentProvider (AppFooter's legal links need it).
function renderDetailWithShell(fetchFn: AuthenticatedFetch) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ConsentProvider>
          <ShellFooterProvider>
            <SuppressionProbe />
            {children}
          </ShellFooterProvider>
        </ConsentProvider>
      </QueryClientProvider>
    );
  }
  return render(
    <TheoryDetail topicId="der-dativ" language={Language.DE} fetchFn={fetchFn} />,
    { wrapper: Wrapper },
  );
}

describe('TheoryDetail footer', () => {
  it('renders its own footer inside the article scroller and suppresses the shell footer', async () => {
    renderDetailWithShell(makeFetch());
    await screen.findByRole('heading', { level: 1, name: 'der dativ' }, FIND);

    // Exactly one footer, and it lives inside `.theory-scroll` — so it reveals
    // only at the end of the article, not parked permanently below the panel.
    const footers = document.querySelectorAll('footer');
    expect(footers).toHaveLength(1);
    const scroller = document.querySelector('.theory-scroll');
    expect(scroller).not.toBeNull();
    expect(scroller!.contains(footers[0])).toBe(true);
    expect(screen.getByText(FOOTER_COPY)).toBeInTheDocument();

    // Shell footer suppressed while the article is shown.
    expect(screen.getByTestId('shell-footer-suppressed').textContent).toBe('true');
  });

  it('leaves the shell footer alone (and renders no own footer) in the error state', async () => {
    renderDetailWithShell(makeFetch({ topicStatus: 500 }));
    await screen.findByText(/couldn't load theory/i, undefined, FIND);

    expect(document.querySelector('.theory-scroll')).toBeNull();
    expect(screen.queryByText(FOOTER_COPY)).not.toBeInTheDocument();
    expect(screen.getByTestId('shell-footer-suppressed').textContent).toBe('false');
  });
});

// Small helper: find a button with the given accessible name inside a container.
function within_(
  container: HTMLElement,
  role: string,
  name: string,
): HTMLElement | null {
  return (
    Array.from(container.querySelectorAll(role)).find(
      (el) => el.textContent?.trim() === name,
    ) ?? null
  ) as HTMLElement | null;
}
