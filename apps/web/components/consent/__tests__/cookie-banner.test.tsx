import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ConsentProvider } from '../consent-provider';
import { CookieBanner } from '../cookie-banner';
import { getConsent } from '../../../lib/consent/consent';

function setup() {
  return render(
    <ConsentProvider>
      <CookieBanner />
    </ConsentProvider>,
  );
}

describe('CookieBanner', () => {
  beforeEach(() => localStorage.clear());

  it('shows when no choice has been made', async () => {
    setup();
    expect(await screen.findByRole('region', { name: /cookie/i })).toBeInTheDocument();
  });

  it('Accept all sets analytics=true and hides the banner', async () => {
    setup();
    const btn = await screen.findByRole('button', { name: /accept all/i });
    await act(async () => { btn.click(); });
    expect(getConsent()?.analytics).toBe(true);
    expect(screen.queryByRole('region', { name: /cookie/i })).not.toBeInTheDocument();
  });

  it('Reject persists analytics=false and hides the banner', async () => {
    setup();
    const btn = await screen.findByRole('button', { name: /reject/i });
    await act(async () => { btn.click(); });
    expect(getConsent()?.analytics).toBe(false);
    expect(screen.queryByRole('region', { name: /cookie/i })).not.toBeInTheDocument();
  });

  it('moves focus into the dialog when preferences open', async () => {
    setup();
    const manage = await screen.findByRole('button', { name: /manage/i });
    await act(async () => { manage.click(); });
    const dialog = screen.getByRole('dialog', { name: /cookie preferences/i });
    expect(dialog).toHaveFocus();
  });

  it('Escape closes preferences and returns focus to Manage', async () => {
    setup();
    const manage = await screen.findByRole('button', { name: /manage/i });
    await act(async () => { manage.click(); });
    const dialog = screen.getByRole('dialog', { name: /cookie preferences/i });
    await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
    expect(screen.getByRole('region', { name: /cookie/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manage/i })).toHaveFocus();
  });

  it('Close button returns focus to Manage', async () => {
    setup();
    const manage = await screen.findByRole('button', { name: /manage/i });
    await act(async () => { manage.click(); });
    const close = screen.getByRole('button', { name: /^close$/i });
    await act(async () => { close.click(); });
    expect(screen.getByRole('region', { name: /cookie/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manage/i })).toHaveFocus();
  });
});
