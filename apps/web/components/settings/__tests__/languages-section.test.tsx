import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CefrLevel, Language } from '@language-drill/shared';
import type { LearningLanguage } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue('test-token');
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

const mockUseLanguageProfiles = vi.fn();
const mockUseGetPreferences = vi.fn();
const mockUseUpdateLanguages = vi.fn();

vi.mock('@language-drill/api-client', () => ({
  useLanguageProfiles: (...args: unknown[]) => mockUseLanguageProfiles(...args),
  useGetPreferences: (...args: unknown[]) => mockUseGetPreferences(...args),
  useUpdateLanguages: (...args: unknown[]) => mockUseUpdateLanguages(...args),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));

// Static import must come after vi.mock declarations (hoisting handles order)
import { LanguagesSection } from '../languages-section';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

type Profile = { language: LearningLanguage; proficiencyLevel: CefrLevel };

function renderSection(
  {
    profiles,
    primaryLanguage,
  }: { profiles: Profile[]; primaryLanguage: LearningLanguage },
  mutate: ReturnType<typeof vi.fn> = vi.fn(),
) {
  mockUseLanguageProfiles.mockReturnValue({
    data: { profiles },
    isLoading: false,
    error: null,
  });
  mockUseGetPreferences.mockReturnValue({
    data: {
      primaryLanguage,
      goals: [],
      dailyMinutes: 20,
      gentleNudges: true,
      notes: '',
    },
    isLoading: false,
    error: null,
  });
  mockUseUpdateLanguages.mockReturnValue({ mutate });

  return render(<LanguagesSection />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockUseLanguageProfiles.mockReset();
  mockUseGetPreferences.mockReset();
  mockUseUpdateLanguages.mockReset();
});

describe('LanguagesSection', () => {
  it('renders a row per language with its CEFR level and a focus chip on the primary', () => {
    renderSection({
      profiles: [
        { language: Language.ES, proficiencyLevel: CefrLevel.B2 },
        { language: Language.DE, proficiencyLevel: CefrLevel.A2 },
      ],
      primaryLanguage: Language.ES,
    });
    expect(screen.getByText('español')).toBeInTheDocument();
    expect(screen.getByText("today's focus")).toBeInTheDocument();
  });

  it('changing a level autosaves the full profiles array + primary', () => {
    const mutate = vi.fn();
    renderSection(
      { profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }], primaryLanguage: Language.ES },
      mutate,
    );
    fireEvent.click(screen.getByRole('button', { name: /set ES to C1/i }));
    expect(mutate).toHaveBeenCalledWith({
      profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.C1 }],
      primaryLanguage: Language.ES,
    });
  });

  it('removing the primary language reassigns focus before saving', () => {
    const mutate = vi.fn();
    renderSection(
      {
        profiles: [
          { language: Language.ES, proficiencyLevel: CefrLevel.B2 },
          { language: Language.DE, proficiencyLevel: CefrLevel.A2 },
        ],
        primaryLanguage: Language.ES,
      },
      mutate,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove español/i }));
    expect(mutate).toHaveBeenCalledWith({
      profiles: [{ language: Language.DE, proficiencyLevel: CefrLevel.A2 }],
      primaryLanguage: Language.DE,
    });
  });

  it('disables remove when only one language remains', () => {
    renderSection({
      profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
      primaryLanguage: Language.ES,
    });
    expect(screen.getByRole('button', { name: /remove español/i })).toBeDisabled();
  });

  it('disables "add a language" at 3 languages', () => {
    renderSection({
      profiles: [
        { language: Language.ES, proficiencyLevel: CefrLevel.B2 },
        { language: Language.DE, proficiencyLevel: CefrLevel.A2 },
        { language: Language.TR, proficiencyLevel: CefrLevel.A1 },
      ],
      primaryLanguage: Language.ES,
    });
    expect(screen.getByRole('button', { name: /add a language/i })).toBeDisabled();
  });
});
