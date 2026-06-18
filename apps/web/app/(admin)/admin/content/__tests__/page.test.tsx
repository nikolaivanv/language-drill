// apps/web/app/(admin)/admin/content/__tests__/page.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
const mockSearch = vi.fn();
vi.mock('next/navigation', () => ({ useSearchParams: () => mockSearch() }));

const empty = { isLoading: false, isError: false, data: { items: [], total: 0 } };
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return {
    ...actual,
    createAuthenticatedFetch: () => vi.fn(),
    useContentExercises: () => empty,
    useContentTheory: () => empty,
    useResolveContentExercise: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useResolveContentTheory: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCurriculum: () => ({ isLoading: false, isError: false, data: { items: [] } }),
  };
});

import ContentPage from '../page';

beforeEach(() => mockSearch.mockReset());

describe('ContentPage tab from URL', () => {
  it('starts on Exercises by default', () => {
    mockSearch.mockReturnValue(new URLSearchParams(''));
    render(<ContentPage />);
    expect(screen.getByRole('tab', { name: /exercises/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('starts on Theory when ?tab=theory', () => {
    mockSearch.mockReturnValue(new URLSearchParams('tab=theory'));
    render(<ContentPage />);
    expect(screen.getByRole('tab', { name: /theory/i })).toHaveAttribute('aria-selected', 'true');
  });
});
