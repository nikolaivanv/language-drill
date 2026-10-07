'use client';

import { useState } from 'react';
import type { FreeWritingEvaluationResponse } from '@language-drill/api-client';
import { FwResults } from './fw-results';
import { FwCorrections } from './fw-corrections';
import { FwCompare } from './fw-compare';

type Surface = 'results' | 'corrections' | 'compare';

export interface FwGradedProps {
  evaluation: FreeWritingEvaluationResponse;
  /** The exact graded text — error spans are located in it, never a live draft. */
  original: string;
  onAnother: () => void;
  /** Label for the results surface's exit button (default "write another"). */
  anotherLabel?: string;
  /** Results header microcopy (default "free writing · graded"). */
  eyebrow?: string;
}

// The three surfaces of one graded essay — results → corrections → compare —
// with their own back stack. Shared by the live flow (just graded) and the
// history view (a stored attempt). Remount with a new `key` per essay so the
// stack never carries over between results.
export function FwGraded({ evaluation, original, onAnother, anotherLabel, eyebrow }: FwGradedProps) {
  const [surface, setSurface] = useState<Surface>('results');
  // Surfaces visited before the current one, so the deep surfaces return to
  // wherever they were reached from — compare is reachable from both results
  // and corrections.
  const [stack, setStack] = useState<Surface[]>([]);

  const go = (next: Surface) => {
    setStack((s) => [...s, surface]);
    setSurface(next);
  };

  const back = () => {
    const prev = stack[stack.length - 1];
    if (!prev) return;
    setStack(stack.slice(0, -1));
    setSurface(prev);
  };

  switch (surface) {
    case 'results':
      return (
        <FwResults
          evaluation={evaluation}
          onCorrections={() => go('corrections')}
          onCompare={() => go('compare')}
          onAnother={onAnother}
          anotherLabel={anotherLabel}
          eyebrow={eyebrow}
        />
      );
    case 'corrections':
      return (
        <FwCorrections
          evaluation={evaluation}
          original={original}
          onCompare={() => go('compare')}
          onBack={back}
        />
      );
    case 'compare':
      return <FwCompare evaluation={evaluation} original={original} onBack={back} />;
  }
}
