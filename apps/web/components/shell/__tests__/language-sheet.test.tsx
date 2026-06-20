import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CefrLevel, Language, type LanguageProfile } from '@language-drill/shared';
import { LanguageSheet } from '../language-sheet';
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

function clearActiveLanguageCookie() {
  document.cookie = 'active_language=; max-age=0; path=/';
}

function renderSheet(
  profiles: LanguageProfile[],
  onClose = vi.fn(),
  open = true,
) {
  render(
    <ActiveLanguageProvider profiles={profiles}>
      <LanguageSheet open={open} onClose={onClose} profiles={profiles} />
    </ActiveLanguageProvider>,
  );
  return { onClose };
}

describe('LanguageSheet', () => {
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

  it('lists the learning profiles (filtering EN) with name and level', () => {
    renderSheet([PROFILE_EN, PROFILE_ES, PROFILE_DE]);
    const listbox = screen.getByRole('listbox', { name: 'learning languages' });
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(within(listbox).getByText('spanish')).toBeInTheDocument();
    expect(within(listbox).getByText('german')).toBeInTheDocument();
    expect(within(listbox).queryByText('english')).not.toBeInTheDocument();
    expect(within(listbox).getByText('A2')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderSheet([PROFILE_ES, PROFILE_DE], vi.fn(), false);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('selecting a different language sets it active (reload) and closes', () => {
    const { onClose } = renderSheet([PROFILE_ES, PROFILE_DE]);
    const option = screen.getByRole('option', { name: /german/i });
    fireEvent.click(option);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('selecting the active language closes without reloading', () => {
    const { onClose } = renderSheet([PROFILE_ES, PROFILE_DE]);
    // ES is active (first profile, no cookie).
    fireEvent.click(screen.getByRole('option', { name: /spanish/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('marks the active option as selected', () => {
    renderSheet([PROFILE_ES, PROFILE_DE]);
    expect(screen.getByRole('option', { name: /spanish/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: /german/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('includes the "manage languages" link to /settings', () => {
    renderSheet([PROFILE_ES, PROFILE_DE]);
    const link = screen.getByRole('link', { name: /manage languages/i });
    expect(link).toHaveAttribute('href', '/settings');
  });
});
