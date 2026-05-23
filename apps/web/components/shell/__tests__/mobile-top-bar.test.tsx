import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CefrLevel, Language, type LanguageProfile } from '@language-drill/shared';
import { MobileTopBar } from '../mobile-top-bar';
import { ActiveLanguageProvider } from '../active-language-provider';

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

vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({ user: { firstName: 'Val', lastName: 'N' }, isLoaded: true }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

const PROFILE_ES: LanguageProfile = {
  language: Language.ES,
  proficiencyLevel: CefrLevel.A2,
};
const PROFILE_DE: LanguageProfile = {
  language: Language.DE,
  proficiencyLevel: CefrLevel.B1,
};

function clearActiveLanguageCookie() {
  document.cookie = 'active_language=; max-age=0; path=/';
}

function renderBar(profiles: LanguageProfile[]) {
  render(
    <ActiveLanguageProvider profiles={profiles}>
      <MobileTopBar profiles={profiles} />
    </ActiveLanguageProvider>,
  );
}

describe('MobileTopBar', () => {
  let originalLocation: Location;

  beforeEach(() => {
    clearActiveLanguageCookie();
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, reload: vi.fn() },
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

  it('renders the brand mark, language pill, and avatar', () => {
    renderBar([PROFILE_ES, PROFILE_DE]);

    expect(screen.getByRole('link', { name: /drill/i })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.getByRole('button', { name: /spanish/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'account menu' }),
    ).toBeInTheDocument();
  });

  it('opens the language sheet when the pill is tapped', () => {
    renderBar([PROFILE_ES, PROFILE_DE]);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /spanish/i }));

    const dialog = screen.getByRole('dialog', { name: 'choose language' });
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByRole('listbox', { name: 'learning languages' }),
    ).toBeInTheDocument();
  });

  it('disables the pill and opens no sheet with a single language', () => {
    renderBar([PROFILE_ES]);

    const pill = screen.getByRole('button', { name: /spanish/i });
    expect(pill).toBeDisabled();
    expect(pill).not.toHaveAttribute('aria-haspopup');

    fireEvent.click(pill);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the account menu (settings / sign out) when the avatar is tapped', () => {
    renderBar([PROFILE_ES, PROFILE_DE]);

    fireEvent.click(screen.getByRole('button', { name: 'account menu' }));
    expect(screen.getByRole('menuitem', { name: 'settings' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'sign out' }),
    ).toBeInTheDocument();
  });
});
