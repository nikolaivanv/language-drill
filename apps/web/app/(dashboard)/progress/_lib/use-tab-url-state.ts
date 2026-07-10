'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// ---------------------------------------------------------------------------
// useTabUrlState — reload-safe, shareable tab state for the Progress page.
// Reads `?tab=` from the URL (narrowed to the four known ids) and updates
// it via `router.replace` so the back button isn't polluted with tab toggles.
// Design reference: design.md §"Component 3 — ProgressTabs"
// ---------------------------------------------------------------------------

export const PROGRESS_TAB_IDS = ['map', 'words', 'shape', 'fluency', 'history'] as const;
export type ProgressTabId = (typeof PROGRESS_TAB_IDS)[number];

const DEFAULT_TAB: ProgressTabId = 'map';

function isProgressTabId(value: string | null): value is ProgressTabId {
  return value !== null && (PROGRESS_TAB_IDS as readonly string[]).includes(value);
}

export type UseTabUrlState = {
  tab: ProgressTabId;
  setTab: (id: ProgressTabId) => void;
};

export function useTabUrlState(): UseTabUrlState {
  const router = useRouter();
  const searchParams = useSearchParams();

  const raw = searchParams?.get('tab') ?? null;
  const tab: ProgressTabId = isProgressTabId(raw) ? raw : DEFAULT_TAB;

  const setTab = useCallback(
    (id: ProgressTabId) => {
      router.replace(`?tab=${id}`, { scroll: false });
    },
    [router],
  );

  return { tab, setTab };
}
