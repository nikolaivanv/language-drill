import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    expect(within(trigger).getByText('es')).toBeInTheDocument();
    expect(within(trigger).getByText('spanish')).toBeInTheDocument();
    expect(within(trigger).getByText('A2')).toBeInTheDocument();
  });

  it('disables the trigger and omits aria-haspopup when only one learning profile', () => {
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

  it('opens the menu when the trigger is clicked', async () => {
    const user = userEvent.setup();
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    const trigger = screen.getByRole('button');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('filters EN out of the menu', async () => {
    const user = userEvent.setup();
    renderWithProvider([PROFILE_EN, PROFILE_ES, PROFILE_DE]);

    await user.click(screen.getByRole('button'));
    const menu = screen.getByRole('menu');

    expect(within(menu).getByText('spanish')).toBeInTheDocument();
    expect(within(menu).getByText('german')).toBeInTheDocument();
    expect(within(menu).queryByText('english')).not.toBeInTheDocument();
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(2);
  });

  it('clicking a different language reloads', async () => {
    const user = userEvent.setup();
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    await user.click(screen.getByRole('button'));
    const options = within(screen.getByRole('menu')).getAllByRole('menuitemradio');
    const de = options.find((o) => o.textContent?.toLowerCase().includes('german'));
    expect(de).toBeDefined();
    await user.click(de!);

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('clicking the active language closes the menu without reloading', async () => {
    const user = userEvent.setup();
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    await user.click(screen.getByRole('button'));
    const options = within(screen.getByRole('menu')).getAllByRole('menuitemradio');
    const es = options.find((o) => o.textContent?.toLowerCase().includes('spanish'));
    await user.click(es!);

    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Escape closes the menu', async () => {
    const user = userEvent.setup();
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('clicking outside closes the menu', async () => {
    // pointerEventsCheck: 0 is needed because Radix's DismissableLayer sets
    // pointer-events:none on the body in jsdom; the assertion itself is unchanged.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('selects the next language by keyboard (ArrowDown + Enter) and reloads', async () => {
    // pointerEventsCheck: 0 is needed so the trigger click lands in jsdom;
    // after the menu opens we manually focus the first menuitemradio because
    // jsdom doesn't propagate Radix's onOpenAutoFocus through the Portal.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    await user.click(screen.getByRole('button'));
    // Ensure focus is inside the menu content so Radix roving-focus can handle keys.
    const firstItem = screen.getAllByRole('menuitemradio')[0];
    act(() => { firstItem.focus(); });
    // Move to DE (second item) and commit.
    await user.keyboard('{ArrowDown}{Enter}');

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('"manage languages" item links to /settings', async () => {
    const user = userEvent.setup();
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    await user.click(screen.getByRole('button'));
    const link = screen.getByRole('menuitem', { name: /manage languages/i });
    expect(link).toHaveAttribute('href', '/settings');
  });
});
