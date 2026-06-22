'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useEmailPreferences,
  useGetPreferences,
  useUpdatePreferences,
  useUpdateWeeklySummary,
} from '@language-drill/api-client';
import { Section, Row } from './section';
import { Switch } from '../ui';

export function EmailSection() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const prefs = useEmailPreferences({ fetchFn });
  const update = useUpdateWeeklySummary({ fetchFn });

  // Gentle nudges live on the general preferences record (not the email-prefs
  // endpoint), but they're a notification, so we surface them here.
  const prefsQuery = useGetPreferences({ fetchFn });
  const updatePrefs = useUpdatePreferences({ fetchFn });
  const [nudges, setNudges] = useState(true);
  useEffect(() => {
    if (prefsQuery.data) setNudges(prefsQuery.data.gentleNudges);
  }, [prefsQuery.data]);
  const toggleNudges = (next: boolean) => {
    setNudges(next);
    updatePrefs.mutate({ gentleNudges: next });
  };

  const status = prefs.data?.weeklySummary ?? 'off';
  const checked = status === 'pending' || status === 'confirmed';
  const disabled = prefs.isLoading || update.isPending;

  const hint =
    status === 'pending'
      ? 'check your inbox to confirm — sends start after you click the link.'
      : 'a short recap of your week, every monday. skipped on weeks you don\'t practice.';

  return (
    <Section id="email" title="email notifications">
      <Row label="weekly summary" hint={hint}>
        <Switch
          checked={checked}
          onChange={(next: boolean) => {
            if (!disabled) update.mutate({ enabled: next });
          }}
          aria-label="weekly summary"
        />
      </Row>

      <Row label="gentle nudges" hint="one calm note if you've missed two days, never more.">
        <Switch checked={nudges} onChange={toggleNudges} aria-label="gentle nudges" />
      </Row>
    </Section>
  );
}
