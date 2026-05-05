// ---------------------------------------------------------------------------
// HistoryEmptyState — placeholder for the history view when zero entries
// exist for the active language (Requirement 10.5).
// ---------------------------------------------------------------------------

import { Button } from '../../../../components/ui/button';

type Props = {
  onPasteNew: () => void;
};

export function HistoryEmptyState({ onPasteNew }: Props) {
  return (
    <div className="flex flex-col items-start gap-[16px]">
      <p className="t-small text-ink-soft">
        no past texts yet — paste one to start.
      </p>
      <Button variant="primary" onClick={onPasteNew}>
        + paste new
      </Button>
    </div>
  );
}
