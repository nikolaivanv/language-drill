import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CefrLevel, Language } from '@language-drill/shared';
import { ActiveLanguageProvider } from '../../../../components/shell';
import FluencyPage from '../page';

const mockGetToken = vi.fn().mockResolvedValue('test-token');
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: mockGetToken }) }));

const mockReplace = vi.fn();
let searchType: string | null = null;
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({ get: (k: string) => (k === 'type' ? searchType : null) }),
}));

const mockSessionMutate = vi.fn();
const mockSubmitMutateAsync = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
  useFluencySession: () => ({
    mutate: mockSessionMutate,
    isPending: false,
    isIdle: false,
    isError: true, // render the insufficient branch — no runner internals needed
    data: undefined,
  }),
  useSubmitFluencyAttempt: () => ({ mutateAsync: mockSubmitMutateAsync }),
}));

function renderPage() {
  return render(
    <ActiveLanguageProvider profiles={[{ language: Language.ES, proficiencyLevel: CefrLevel.B1 }]}>
      <FluencyPage />
    </ActiveLanguageProvider>,
  );
}

describe('FluencyPage mode toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchType = null;
  });

  it('starts an unfiltered session in the default (all) mode', async () => {
    renderPage();
    await waitFor(() => expect(mockSessionMutate).toHaveBeenCalled());
    const arg = mockSessionMutate.mock.calls[0][0];
    expect(arg.language).toBe('ES');
    expect(arg.types).toBeUndefined();
  });

  it('starts a conjugation-only session when ?type=conjugation', async () => {
    searchType = 'conjugation';
    renderPage();
    await waitFor(() => expect(mockSessionMutate).toHaveBeenCalled());
    const arg = mockSessionMutate.mock.calls[0][0];
    expect(arg.types).toEqual(['conjugation']);
    expect(screen.getByText(/master a few more conjugations first/i)).toBeInTheDocument();
  });

  it('navigates to ?type=conjugation when the conjugation chip is clicked', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'conjugation' }));
    expect(mockReplace).toHaveBeenCalledWith('/fluency?type=conjugation', { scroll: false });
  });
});
