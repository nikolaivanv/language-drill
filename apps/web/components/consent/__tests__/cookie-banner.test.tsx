import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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
});
