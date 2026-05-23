'use client';

import { Button } from '../../../../components/ui';
import { useDrillAction } from './drill-action-context';

// The sticky check/next bar that replaces the tab-bar during a drill on mobile.
// Progress meta sits on the left; the published primary action on the right.
// When no action is published (between items / loading) it shows a disabled
// placeholder so there is never a dead or duplicate button.
export function DrillActionBar() {
  const { primaryAction, meta } = useDrillAction();

  return (
    <div className="sticky bottom-0 z-30 flex items-center justify-between gap-s-3 border-t border-rule bg-paper px-[18px] py-s-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
      <span className="t-small text-ink-mute">
        {meta ? `item ${meta.current} of ${meta.total}` : ''}
      </span>
      {primaryAction ? (
        <Button
          variant={primaryAction.variant ?? 'primary'}
          onClick={primaryAction.onClick}
          disabled={primaryAction.disabled}
          loading={primaryAction.loading}
          className="min-h-[44px] min-w-[120px]"
        >
          {primaryAction.label}
        </Button>
      ) : (
        <Button
          variant="primary"
          disabled
          aria-label="waiting"
          className="min-h-[44px] min-w-[120px]"
        >
          …
        </Button>
      )}
    </div>
  );
}
