import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ConsentProvider, useConsent } from '../consent-provider';
import { ConsentGate } from '../consent-gate';

function Grant() {
  const { update } = useConsent();
  return <button onClick={() => update({ analytics: true })}>grant</button>;
}

describe('ConsentGate', () => {
  beforeEach(() => localStorage.clear());

  it('hides children until analytics consent is granted', async () => {
    render(
      <ConsentProvider>
        <Grant />
        <ConsentGate category="analytics"><span>tracked</span></ConsentGate>
      </ConsentProvider>,
    );
    expect(screen.queryByText('tracked')).not.toBeInTheDocument();
    await act(async () => { screen.getByText('grant').click(); });
    expect(screen.getByText('tracked')).toBeInTheDocument();
  });
});
