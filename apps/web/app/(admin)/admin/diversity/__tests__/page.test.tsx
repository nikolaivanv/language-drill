import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));

const mockUseDiversity = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, createAuthenticatedFetch: () => vi.fn(), useDiversity: (args: unknown) => mockUseDiversity(args) };
});

import DiversityPage from '../page';

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
