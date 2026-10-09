import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CefrLevel, Language } from '@language-drill/shared';
import FreeWritingGuidePage from './page';

const mockUseLanguageProfiles = vi.fn();
const mockReplace = vi.fn();
let mockSearch = '';
let mockActiveLanguage: Language = Language.ES;
const mockFwGuide = vi.fn();

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('@language-drill/api-client', () => ({
  useLanguageProfiles: (...args: unknown[]) => mockUseLanguageProfiles(...args),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
vi.mock('../../../../../components/shell', () => ({
  useActiveLanguage: () => ({ activeLanguage: mockActiveLanguage }),
}));
vi.mock('../_components/fw-guide', () => ({
  FwGuide: (props: { language: Language; band: string; onBandChange: (b: string) => void }) => {
    mockFwGuide(props);
    return (
      <button type="button" onClick={() => props.onBandChange('a1-a2')}>
        guide {props.language} {props.band}
      </button>
    );
  },
}));

function profiles(level: CefrLevel | null, language: Language = Language.ES) {
  return {
    data: level ? { profiles: [{ language, proficiencyLevel: level }] } : { profiles: [] },
    isPending: false,
  };
}

beforeEach(() => {
  mockSearch = '';
  mockActiveLanguage = Language.ES;
  mockReplace.mockReset();
  mockFwGuide.mockReset();
});

describe('FreeWritingGuidePage', () => {
  it('picks the band from the profile level', () => {
    mockUseLanguageProfiles.mockReturnValue(profiles(CefrLevel.A2));
    render(<FreeWritingGuidePage />);
    expect(screen.getByText('guide ES a1-a2')).toBeInTheDocument();
  });

  it('defaults to B1–B2 when the language has no profile', () => {
    mockUseLanguageProfiles.mockReturnValue(profiles(null));
    render(<FreeWritingGuidePage />);
    expect(screen.getByText('guide ES b1-b2')).toBeInTheDocument();
  });

  it('follows the active language', () => {
    mockActiveLanguage = Language.DE;
    mockUseLanguageProfiles.mockReturnValue(profiles(CefrLevel.A1, Language.DE));
    render(<FreeWritingGuidePage />);
    expect(screen.getByText('guide DE a1-a2')).toBeInTheDocument();
  });

  it('honours a valid ?band= over the profile', () => {
    mockSearch = 'band=a1-a2';
    mockUseLanguageProfiles.mockReturnValue(profiles(CefrLevel.B2));
    render(<FreeWritingGuidePage />);
    expect(screen.getByText('guide ES a1-a2')).toBeInTheDocument();
  });

  it.each(['band=c1', 'band=', 'band=A1-A2'])('ignores an invalid %s', (search) => {
    mockSearch = search;
    mockUseLanguageProfiles.mockReturnValue(profiles(CefrLevel.B2));
    render(<FreeWritingGuidePage />);
    expect(screen.getByText('guide ES b1-b2')).toBeInTheDocument();
  });

  it('waits for profiles instead of flashing the default band', () => {
    mockUseLanguageProfiles.mockReturnValue({ data: undefined, isPending: true });
    render(<FreeWritingGuidePage />);
    expect(mockFwGuide).not.toHaveBeenCalled();
    expect(screen.getByText('loading…')).toBeInTheDocument();
  });

  it('does not wait for profiles when ?band= is given', () => {
    mockSearch = 'band=b1-b2';
    mockUseLanguageProfiles.mockReturnValue({ data: undefined, isPending: true });
    render(<FreeWritingGuidePage />);
    expect(screen.getByText('guide ES b1-b2')).toBeInTheDocument();
  });

  it('writes a band switch to the URL with replace', () => {
    mockUseLanguageProfiles.mockReturnValue(profiles(CefrLevel.B2));
    render(<FreeWritingGuidePage />);
    screen.getByText('guide ES b1-b2').click();
    expect(mockReplace).toHaveBeenCalledWith('/drill/free-writing/guide?band=a1-a2', { scroll: false });
  });
});
