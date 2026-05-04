import Link from 'next/link';
import type { DebriefResponse } from '@language-drill/api-client';
import { Card } from '../../../../../components/ui';
import { accuracyTier } from '../../../../../lib/drill/accuracy-tier';
import { debriefNarrative } from '../../../../../lib/drill/debrief-narrative';
import { coachMessage } from '../../../../../lib/drill/coach-messages';

// ---------------------------------------------------------------------------
// DebriefTab — default panel content for the post-session debrief screen.
//   Coach card (avatar + speech bubble with 1–2 templated paragraphs) +
//   "what's next" callout linking to /progress (high tier) or /drill (else).
//   No skill-delta section in v1 (Req 4.5).
// ---------------------------------------------------------------------------

export interface DebriefTabProps {
  debrief: DebriefResponse;
}

export function DebriefTab({ debrief }: DebriefTabProps) {
  const {
    correctCount,
    attemptedCount,
    exerciseCount,
    skippedCount,
    language,
  } = debrief;

  const tier = accuracyTier(correctCount, attemptedCount);
  const narrative = debriefNarrative({
    tier,
    language,
    exerciseCount,
    correctCount,
    attemptedCount,
    skippedCount,
  });

  const accuracy = attemptedCount > 0 ? correctCount / attemptedCount : null;
  const quotedCoachLine = coachMessage({ kind: 'sessionComplete', accuracy });

  return (
    <div className="fade-in mt-s-6 flex flex-col gap-s-6">
      {/* Coach card: small ink dot avatar + speech bubble */}
      <div className="flex items-start gap-s-4">
        <div
          aria-hidden="true"
          className="flex-none rounded-full bg-ink text-paper flex items-center justify-center"
          style={{
            width: 44,
            height: 44,
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 600,
          }}
        >
          c
        </div>
        <Card padding="lg" className="flex-1">
          <div className="t-micro">coach · debrief</div>
          {/* Italic quoted-speech line — mixed-case is acceptable here per
              design.md (it's not header copy). */}
          <p className="t-body mt-s-2 italic text-ink-soft">{quotedCoachLine}</p>
          {narrative.paragraphs.map((paragraph, i) => (
            <p key={i} className="t-body-l mt-s-3">
              {paragraph}
            </p>
          ))}
        </Card>
      </div>

      {/* What's-next callout */}
      <Card padding="md" className="bg-paper-2">
        <div className="t-micro">what's next</div>
        <Link
          href={narrative.whatsNextHref}
          className="t-body-l mt-s-2 inline-block underline underline-offset-4 hover:text-ink"
        >
          {narrative.whatsNextLabel}
        </Link>
      </Card>
    </div>
  );
}
