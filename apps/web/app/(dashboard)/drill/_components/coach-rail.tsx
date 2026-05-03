'use client';

import { ExerciseType } from '@language-drill/shared';
import { Card } from '../../../../components/ui';
import { cn } from '../../../../lib/cn';

export interface CoachRailProps {
  message: string;
  exerciseType: ExerciseType;
  vocabActiveCount?: number;
}

export function CoachRail({ message }: CoachRailProps) {
  return (
    <div className="flex flex-col gap-s-4">
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

      {/*
        Vocabulary tracker — hidden in v1 per Req 5 AC #6.
        A future phase will surface vocabActiveCount here when the /history
        endpoint exists. Prop is accepted now so callers can already wire it.
      */}
    </div>
  );
}
