'use client';

import { useRouter } from 'next/navigation';
import { Button, Card } from '../../../../../components/ui';

// ---------------------------------------------------------------------------
// DebriefLoadError — generic load-failure fallback for the post-session
// debrief page. Rendered when `useSessionDebrief` errors with anything OTHER
// than a 404 (5xx, network failure, parse-shape mismatch). Distinct from
// `<DebriefNotFound />` because the session very likely exists and is the
// user's — only the fetch failed. Surfaces a retry that calls
// `query.refetch()` so the user can recover without losing the URL.
// See design.md §"Network failure / 5xx fetch".
// ---------------------------------------------------------------------------

export interface DebriefLoadErrorProps {
  onRetry: () => void;
}

export function DebriefLoadError({ onRetry }: DebriefLoadErrorProps) {
  const router = useRouter();

  return (
    <div className="flex justify-center mt-s-7">
      <Card padding="lg" className="max-w-[520px] text-center">
        <h1 className="t-display-l">couldn't load this debrief</h1>
        <p className="t-body mt-s-3">
          something went wrong loading your results. your progress is saved —
          try again, or head back to drill.
        </p>
        <div className="mt-s-5 flex justify-center gap-s-3">
          <Button variant="primary" onClick={onRetry}>
            try again
          </Button>
          <Button variant="ghost" onClick={() => router.push('/drill')}>
            back to drill
          </Button>
        </div>
      </Card>
    </div>
  );
}
