'use client';

import Link from 'next/link';
import { track, type AnalyticsEvent, type AnalyticsProps } from '../../lib/analytics/track';

/**
 * A `next/link` that fires a named analytics event on click. Exists so Server
 * Components (the public header, landing pages, the grammar practise rail) can
 * track a CTA without becoming client components themselves — only this link
 * hydrates. Like every `track()` call it is a no-op until analytics consent.
 */
export function TrackedLink({
  event,
  eventProps,
  onClick,
  ...linkProps
}: React.ComponentProps<typeof Link> & {
  event: AnalyticsEvent;
  eventProps?: AnalyticsProps;
}) {
  return (
    <Link
      {...linkProps}
      onClick={(e) => {
        track(event, eventProps);
        onClick?.(e);
      }}
    />
  );
}
