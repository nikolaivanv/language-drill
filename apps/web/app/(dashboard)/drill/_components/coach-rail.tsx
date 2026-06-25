// DORMANT (2026-06): the dedicated coach rail is not mounted. The coach nudge
// now lives inside the per-answer feedback card (feedback-shell.tsx). Kept for
// reintroduction once the coach gives genuinely useful, item-matched advice.
'use client';

import { ExerciseType } from '@language-drill/shared';
import { Card } from '../../../../components/ui';
import { cn } from '../../../../lib/cn';
import { SessionDots } from './session-dots';

export interface CoachRailProps {
  message: string;
  exerciseType: ExerciseType;
  vocabActiveCount?: number;
  /** 1-based position of the current item in the session. */
  sessionCurrent?: number;
  /** Total number of items in the session. */
  sessionTotal?: number;
}

export function CoachRail({
  message,
  sessionCurrent,
  sessionTotal,
}: CoachRailProps) {
  return (
    <div className="flex h-full flex-col gap-s-4">
      {/* Avatar + labels */}
      <div className="flex flex-col gap-s-2">
        <div
          className={cn(
            'flex items-center justify-center',
            'w-12 h-12 rounded-r-pill bg-ink'
          )}
        >
          <span className="t-display-s text-paper leading-none">c</span>
        </div>
        <div>
          <p className="t-micro">coach</p>
          <p className="t-small text-ink-mute">guiding this session</p>
        </div>
      </div>

      {/* Message card — re-keyed on message change so the fade-in animation re-runs */}
      <Card key={message} className="coach-fade-in t-body" padding="md">
        {message}
      </Card>

      {/* Session-position indicator — desktop counterpart of the mobile dots. */}
      {typeof sessionCurrent === 'number' &&
        typeof sessionTotal === 'number' && (
          <div className="flex flex-col gap-s-2">
            <p className="t-micro">progress</p>
            <SessionDots current={sessionCurrent} total={sessionTotal} />
          </div>
        )}

      {/*
        Vocabulary tracker — hidden in v1 per Req 5 AC #6.
        A future phase will surface vocabActiveCount here when the /history
        endpoint exists. Prop is accepted now so callers can already wire it.
      */}
    </div>
  );
}
