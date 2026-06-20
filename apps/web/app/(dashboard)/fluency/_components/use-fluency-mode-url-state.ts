'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { FluencyMode } from './fluency-mode-toggle';

// ---------------------------------------------------------------------------
// useFluencyModeUrlState — reload-safe, shareable fluency mode via `?type=`.
// Only `?type=conjugation` selects conjugation mode; anything else (including
// absent) is the mixed-pool default. Mirrors progress/_lib/use-tab-url-state.
// ---------------------------------------------------------------------------

export type UseFluencyModeUrlState = {
  mode: FluencyMode;
  setMode: (mode: FluencyMode) => void;
};

export function useFluencyModeUrlState(): UseFluencyModeUrlState {
  const router = useRouter();
  const searchParams = useSearchParams();

  const raw = searchParams?.get('type') ?? null;
  const mode: FluencyMode = raw === 'conjugation' ? 'conjugation' : 'all';

  const setMode = useCallback(
    (next: FluencyMode) => {
      router.replace(next === 'conjugation' ? '/fluency?type=conjugation' : '/fluency', {
        scroll: false,
      });
    },
    [router],
  );

  return { mode, setMode };
}
