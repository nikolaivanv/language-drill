import type { DebriefResponse } from '@language-drill/api-client';
import { SkillMovementsPanel } from './skill-movements-panel';

// ---------------------------------------------------------------------------
// DebriefTab — default panel content for the post-session debrief screen.
//   A single "what moved" panel. The score lives in the header and forward
//   actions in the footer, so the tab body carries only the skill-movement
//   signal — the one thing not stated elsewhere on the page.
// ---------------------------------------------------------------------------

export interface DebriefTabProps {
  debrief: DebriefResponse;
}

export function DebriefTab({ debrief }: DebriefTabProps) {
  return (
    <div className="fade-in mt-s-6">
      <SkillMovementsPanel movements={debrief.skillMovements} />
    </div>
  );
}
