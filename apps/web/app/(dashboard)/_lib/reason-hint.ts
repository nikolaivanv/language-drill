import type { PlanReason } from '@language-drill/api-client';

const HINTS: Record<PlanReason, string> = {
  'new': 'new point',
  'reinforce': 'reinforcing',
  'review': 'due for review',
  'error-fix': 'recent error spot',
};

export function reasonHint(reason: PlanReason | null): string | null {
  return reason ? HINTS[reason] : null;
}
