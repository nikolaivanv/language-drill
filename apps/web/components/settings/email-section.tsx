'use client';

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useEmailPreferences,
  useUpdateWeeklySummary,
} from '@language-drill/api-client';
import { Section, Row } from './section';
import { Switch } from '../ui';

export function EmailSection() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const prefs = useEmailPreferences({ fetchFn });
  const update = useUpdateWeeklySummary({ fetchFn });

  const status = prefs.data?.weeklySummary ?? 'off';
  const checked = status === 'pending' || status === 'confirmed';
  const disabled = prefs.isLoading || update.isPending;

  const hint =
    status === 'pending'
      ? 'check your inbox to confirm — sends start after you click the link.'
      : 'a short recap of your week, every monday. skipped on weeks you don\'t practice.';

  return (
    <Section id="email" title="email">
      <Row label="weekly summary" hint={hint}>
        <Switch
          checked={checked}
          onChange={(next: boolean) => {
            if (!disabled) update.mutate({ enabled: next });
          }}
          aria-label="weekly summary"
        />
      </Row>
    </Section>
  );
}
