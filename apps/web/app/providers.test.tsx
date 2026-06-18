import { describe, it, expect, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  captureException: () => {},
  withScope: (cb: (s: { setTag: () => void }) => void) => cb({ setTag: () => {} }),
}));

import { createQueryClient } from './providers';
import { reportApiError } from '../lib/sentry/report-api-error';

describe('createQueryClient', () => {
  it('routes query AND mutation errors through reportApiError', () => {
    const client = createQueryClient();
    expect(client.getQueryCache().config.onError).toBe(reportApiError);
    expect(client.getMutationCache().config.onError).toBe(reportApiError);
  });
});
