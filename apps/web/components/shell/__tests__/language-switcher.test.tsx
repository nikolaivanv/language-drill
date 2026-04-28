import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CefrLevel, Language, type LanguageProfile } from '@language-drill/shared';
import { LanguageSwitcher } from '../language-switcher';
import { ActiveLanguageProvider } from '../active-language-provider';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    [key: string]: unknown;
  }) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearActiveLanguageCookie() {
  document.cookie = 'active_language=; max-age=0; path=/';
}

function renderWithProvider(profiles: LanguageProfile[]) {
  return render(
    <ActiveLanguageProvider profiles={profiles}>
      <LanguageSwitcher profiles={profiles} />
    </ActiveLanguageProvider>
  );
}

const PROFILE_ES: LanguageProfile = {
  language: Language.ES,
  proficiencyLevel: CefrLevel.A2,
};
const PROFILE_DE: LanguageProfile = {
  language: Language.DE,
  proficiencyLevel: CefrLevel.B1,
};
const PROFILE_TR: LanguageProfile = {
  language: Language.TR,
  proficiencyLevel: CefrLevel.A1,
};
const PROFILE_EN: LanguageProfile = {
  language: Language.EN,
  proficiencyLevel: CefrLevel.B2,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LanguageSwitcher', () => {
  let reloadMock: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(() => {
    clearActiveLanguageCookie();
    reloadMock = vi.fn();
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, reload: reloadMock },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    clearActiveLanguageCookie();
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('renders the active language with flagdot, name, and CEFR level', () => {
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    const trigger = screen.getByRole('button');
    // The trigger contains the flagdot (with "es" code) + name "spanish" + level
    expect(within(trigger).getByText('es')).toBeInTheDocument();
    expect(within(trigger).getByText('spanish')).toBeInTheDocument();
    expect(within(trigger).getByText('A2')).toBeInTheDocument();
  });

  it('filters EN out of the dropdown', () => {
    renderWithProvider([PROFILE_EN, PROFILE_ES, PROFILE_DE]);

    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');

    // ES and DE options should be present
    expect(within(listbox).getByText('spanish')).toBeInTheDocument();
    expect(within(listbox).getByText('german')).toBeInTheDocument();
    // EN-related text should NOT appear (no "english" option)
    expect(within(listbox).queryByText('english')).not.toBeInTheDocument();
    // Only 2 options (not 3)
    expect(within(listbox).getAllByRole('option')).toHaveLength(2);
  });

  it('disables button and omits aria-haspopup when only one learning profile', () => {
    renderWithProvider([PROFILE_ES]);

    const trigger = screen.getByRole('button');
    expect(trigger).toBeDisabled();
    expect(trigger).not.toHaveAttribute('aria-haspopup');
    expect(trigger).not.toHaveAttribute('aria-expanded');
  });

  it('returns null when there are zero learning profiles', () => {
    const { container } = renderWithProvider([PROFILE_EN]);
    expect(container.querySelector('button')).toBeNull();
  });

  it('opens the dropdown when the trigger is clicked', () => {
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    const trigger = screen.getByRole('button');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('clicking a different language option calls window.location.reload', () => {
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    // Active is ES (first profile + no cookie); click DE option
    const deOption = options.find((o) => o.textContent?.toLowerCase().includes('german'));
    expect(deOption).toBeDefined();
    fireEvent.click(deOption!);

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('clicking the active language closes the dropdown without reloading', () => {
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    const esOption = options.find((o) => o.textContent?.toLowerCase().includes('spanish'));
    fireEvent.click(esOption!);

    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Escape key closes the dropdown', () => {
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('clicking outside closes the dropdown', () => {
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('ArrowDown moves focused index forward', () => {
    renderWithProvider([PROFILE_ES, PROFILE_DE, PROFILE_TR]);

    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');
    let options = within(listbox).getAllByRole('option');

    // Initially the first option is focused
    expect(options[0]).toHaveAttribute('data-focused', 'true');
    expect(options[1]).toHaveAttribute('data-focused', 'false');

    fireEvent.keyDown(listbox, { key: 'ArrowDown' });

    options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options[0]).toHaveAttribute('data-focused', 'false');
    expect(options[1]).toHaveAttribute('data-focused', 'true');
  });

  it('ArrowUp wraps focused index backward from index 0', () => {
    renderWithProvider([PROFILE_ES, PROFILE_DE, PROFILE_TR]);

    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');

    fireEvent.keyDown(listbox, { key: 'ArrowUp' });

    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    // Wrapped to the last option (index 2)
    expect(options[2]).toHaveAttribute('data-focused', 'true');
    expect(options[0]).toHaveAttribute('data-focused', 'false');
  });

  it('Enter on a focused non-active option triggers selection (reload)', () => {
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');
    // Move focus to DE (index 1)
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('"manage languages" link points to /onboarding?edit=1', () => {
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    fireEvent.click(screen.getByRole('button'));
    const link = screen.getByRole('link', { name: /manage languages/i });
    expect(link).toHaveAttribute('href', '/onboarding?edit=1');
  });
});
