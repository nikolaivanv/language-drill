import { Card } from '../../../../components/ui/card';

// ---------------------------------------------------------------------------
// HistoryTab — static "coming soon" placeholder for the History tab on
// /progress. No data fetching; per design, sparkline trends per skill at
// 30/60/90/all windows are deferred to a later phase.
// Design reference: design.md §"Component 8 — HistoryTab"
// ---------------------------------------------------------------------------

export function HistoryTab() {
  return (
    <div style={{ marginTop: 28 }}>
      <Card padding="lg" className="text-center">
        <div className="t-display-s" style={{ color: 'var(--color-ink-soft)' }}>
          history view
        </div>
        <div
          className="t-small"
          style={{ marginTop: 6, color: 'var(--color-ink-mute)' }}
        >
          coming soon — sparkline trends per skill, 30/60/90/all
        </div>
      </Card>
    </div>
  );
}
