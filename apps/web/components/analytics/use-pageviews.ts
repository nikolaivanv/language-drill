'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { captureEvent } from '../../lib/analytics/posthog';

/** Fires a manual $pageview on App Router client navigations (autocapture misses these). */
export function usePageviews(): void {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    const qs = searchParams?.toString();
    const url =
      typeof window !== 'undefined'
        ? window.location.href
        : pathname + (qs ? `?${qs}` : '');
    captureEvent('$pageview', { $current_url: url });
  }, [pathname, searchParams]);
}
