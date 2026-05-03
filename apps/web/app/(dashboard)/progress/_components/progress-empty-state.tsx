import {
  LANGUAGE_NATIVE_NAMES,
  type LearningLanguage,
} from '@language-drill/shared';
import { Card } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';

// ---------------------------------------------------------------------------
// ProgressEmptyState — shown when the user has no exercise history at all
// in the active language. Routes them to /drill to build the radar shape.
// Design reference: design.md §"Component 9 — ProgressEmptyState"
// ---------------------------------------------------------------------------

export type ProgressEmptyStateProps = {
  language: LearningLanguage;
};

export function ProgressEmptyState({ language }: ProgressEmptyStateProps) {
  return (
    <Card padding="lg" className="mt-s-6 max-w-2xl">
      <div className="t-micro">{LANGUAGE_NATIVE_NAMES[language]}</div>
      <h2 className="t-display-s mt-s-2">do your first drill to build your shape.</h2>
      <p className="t-body mt-s-3 text-ink-soft">
        skill numbers come from what you actually produce — not from minutes
        spent or lessons completed. one drill is enough to start the picture.
      </p>
      <div className="mt-s-4">
        <Button href="/drill" variant="primary" size="md">
          start a drill →
        </Button>
      </div>
    </Card>
  );
}
