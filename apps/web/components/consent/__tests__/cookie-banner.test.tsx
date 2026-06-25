import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ConsentProvider, useConsent } from '../consent-provider';
import { CookieBanner } from '../cookie-banner';
import { getConsent } from '../../../lib/consent/consent';

// Stand-in for the footer "Cookie preferences" link, which reopens the card.
function Reopen() {
  const { openPreferences } = useConsent();
  return (
    <button type="button" onClick={openPreferences}>
      reopen
    </button>
  );
}

function setup() {
  return render(
    <ConsentProvider>
      <Reopen />
      <CookieBanner />
    </ConsentProvider>,
  );
}

const dialogName = { name: /cookie preferences/i } as const;

describe('CookieBanner', () => {
  beforeEach(() => localStorage.clear());

  it('shows the dialog when no choice has been made', async () => {
    setup();
    expect(await screen.findByRole('dialog', dialogName)).toBeInTheDocument();
  });

  it('Allow analytics sets analytics=true and hides the card', async () => {
    setup();
    const btn = await screen.findByRole('button', { name: /allow analytics/i });
    await act(async () => { btn.click(); });
    expect(getConsent()?.analytics).toBe(true);
    expect(screen.queryByRole('dialog', dialogName)).not.toBeInTheDocument();
  });

  it('Necessary only persists analytics=false and hides the card', async () => {
    setup();
    const btn = await screen.findByRole('button', { name: /necessary only/i });
    await act(async () => { btn.click(); });
    expect(getConsent()?.analytics).toBe(false);
    expect(screen.queryByRole('dialog', dialogName)).not.toBeInTheDocument();
  });

  it('moves focus into the dialog when it appears', async () => {
    setup();
    const dialog = await screen.findByRole('dialog', dialogName);
    expect(dialog).toHaveFocus();
  });

  it('Decide later (✕) hides the card without recording a choice', async () => {
    setup();
    const x = await screen.findByRole('button', { name: /decide later/i });
    await act(async () => { x.click(); });
    expect(getConsent()).toBeNull();
    expect(screen.queryByRole('dialog', dialogName)).not.toBeInTheDocument();
  });

  it('Escape dismisses the card without recording a choice', async () => {
    setup();
    const dialog = await screen.findByRole('dialog', dialogName);
    await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
    expect(getConsent()).toBeNull();
    expect(screen.queryByRole('dialog', dialogName)).not.toBeInTheDocument();
  });

  it('can be reopened from the footer after being dismissed', async () => {
    setup();
    const x = await screen.findByRole('button', { name: /decide later/i });
    await act(async () => { x.click(); });
    expect(screen.queryByRole('dialog', dialogName)).not.toBeInTheDocument();
    await act(async () => { screen.getByRole('button', { name: /reopen/i }).click(); });
    expect(screen.getByRole('dialog', dialogName)).toBeInTheDocument();
  });
});
