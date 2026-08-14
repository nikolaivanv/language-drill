import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));

const mockSearch = vi.fn();
vi.mock('next/navigation', () => ({ useSearchParams: () => mockSearch() }));

const mockUseDiversity = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, createAuthenticatedFetch: () => vi.fn(), useDiversity: (args: unknown) => mockUseDiversity(args) };
});

import DiversityPage from '../page';

beforeEach(() => mockSearch.mockReturnValue(new URLSearchParams('')));

describe('DiversityPage', () => {
  it('renders a loading state', () => {
    mockUseDiversity.mockReturnValue({ isLoading: true });
    render(<DiversityPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders an error state', () => {
    mockUseDiversity.mockReturnValue({ isLoading: false, isError: true });
    render(<DiversityPage />);
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });

  it('lists points and shows the total', () => {
    mockUseDiversity.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        total: 1,
        items: [
          {
            key: 'es-b1-x', name: 'X', language: 'ES', cefrLevel: 'B1',
            kind: 'grammar', targetOverride: null, provenIssues: 0,
            unknowns: 0, cells: [],
          },
        ],
      },
    });
    render(<DiversityPage />);
    expect(screen.getByText('es-b1-x')).toBeInTheDocument();
  });
});

describe('DiversityPage filters from URL', () => {
  it('seeds language/level/mechanism/issuesOnly from the query string, as the pool drawer link relies on', () => {
    mockSearch.mockReturnValue(new URLSearchParams('language=ES&level=B1&mechanism=variants&issuesOnly=true'));
    mockUseDiversity.mockReturnValue({ isLoading: false, isError: false, data: { total: 0, items: [] } });
    render(<DiversityPage />);
    expect(mockUseDiversity).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { language: 'ES', level: 'B1', mechanism: 'variants', issuesOnly: true },
      }),
    );
    expect((screen.getByLabelText('language') as HTMLSelectElement).value).toBe('ES');
    expect((screen.getByLabelText('level') as HTMLSelectElement).value).toBe('B1');
  });

  it('defaults to no filters when the query string is empty', () => {
    mockSearch.mockReturnValue(new URLSearchParams(''));
    mockUseDiversity.mockReturnValue({ isLoading: false, isError: false, data: { total: 0, items: [] } });
    render(<DiversityPage />);
    expect(mockUseDiversity).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { language: undefined, level: undefined, mechanism: undefined, issuesOnly: undefined },
      }),
    );
  });
});
