'use client';

import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card } from '../../../components/ui';

// Daily ceilings are kept as local constants because the recipient isn't
// signed in yet — there's no authenticated API to fetch the live limits from.
// The invited tier is derived as free × MULT so the framing stays in sync.
const FREE = { evaluations: 50, annotations: 50 };
const MULT = 10;

const STORAGE_KEY = 'pending_invite';

interface InviteLandingPageProps {
  params: Promise<{ code: string }>;
}

export default function InviteLandingPage({ params }: InviteLandingPageProps) {
  const { code } = use(params);
  const router = useRouter();

  const accept = () => {
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Storage can throw (private mode, quota) — the invite is best-effort.
    }
    // Invitees are almost always brand-new — send them straight to sign-up
    // (the Clerk sign-up surface still links to sign-in for the rare returning
    // user). The "already on drill?" link below covers them too.
    router.push('/sign-up');
  };

  const continueFree = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore — clearing a stale invite is best-effort.
    }
    router.push('/sign-up');
  };

  return (
    <div className="mx-auto max-w-md p-s-6">
      <Card padding="lg">
        <p className="t-micro text-ink-mute">you&apos;ve been invited</p>
        <h1 className="t-display-m mb-s-3">
          start on drill with {MULT}× the limit
        </h1>
        <p className="t-body mb-s-4 text-ink-soft">
          drill is free for everyone. your invite bumps the daily ceiling to{' '}
          <strong>{FREE.evaluations * MULT} evaluations a day</strong>.
        </p>
        <table className="mb-s-4 w-full text-sm">
          <thead>
            <tr className="text-ink-mute">
              <th className="text-left font-normal">per day</th>
              <th className="text-right font-normal">free</th>
              <th className="text-right font-normal">with invite</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>evaluations</td>
              <td className="text-right">{FREE.evaluations}</td>
              <td className="text-right font-semibold">
                {FREE.evaluations * MULT}
              </td>
            </tr>
            <tr>
              <td>annotations</td>
              <td className="text-right">{FREE.annotations}</td>
              <td className="text-right font-semibold">
                {FREE.annotations * MULT}
              </td>
            </tr>
          </tbody>
        </table>
        <Button
          variant="primary"
          size="lg"
          onClick={accept}
          className="w-full"
        >
          accept invite &amp; sign up
        </Button>
        <button
          type="button"
          onClick={continueFree}
          className="mt-s-3 w-full text-center text-sm text-ink-soft"
        >
          continue without it (free plan)
        </button>
      </Card>
      <p className="mt-s-4 text-center text-sm text-ink-mute">
        already on drill?{' '}
        <Link href="/sign-in" className="text-accent-2">
          sign in
        </Link>
      </p>
    </div>
  );
}
