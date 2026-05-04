'use client';

import { useRouter } from 'next/navigation';
import { Button, Card } from '../../../../../components/ui';

// ---------------------------------------------------------------------------
// DebriefNotFound — graceful 404 fallback for the post-session debrief page.
// Rendered when the API returns 404 (cross-user / unknown id / not yet
// completed) or any other error in v1 (Req 1.6 + design.md error path).
// ---------------------------------------------------------------------------

export function DebriefNotFound() {
  const router = useRouter();

  return (
    <div className="flex justify-center mt-s-7">
      <Card padding="lg" className="max-w-[520px] text-center">
        <h1 className="t-display-l">session not found</h1>
        <p className="t-body mt-s-3">
          this session may not exist or may not be yours yet — start a new one
          from drill.
        </p>
        <div className="mt-s-5 flex justify-center">
          <Button variant="primary" onClick={() => router.push('/drill')}>
            back to drill
          </Button>
        </div>
      </Card>
    </div>
  );
}
