import { ExerciseType } from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';

type DrillThisTopicProps = {
  umbrellaKey: string;
  drillable: boolean;
};

/**
 * "Drill this topic" launch button on the vocab detail page. Hides (renders
 * null) when no word in the topic has an approved vocab_recall exercise yet
 * (`drillable` = false) — parallels the inventory-gating in
 * theory/_components/drill-this-point.tsx — so the tap can never dead-end on
 * INSUFFICIENT_EXERCISES.
 */
export function DrillThisTopic({ umbrellaKey, drillable }: DrillThisTopicProps) {
  if (!drillable) return null;

  const href = `/drill?start=quick&grammarPoint=${encodeURIComponent(umbrellaKey)}&exerciseType=${ExerciseType.VOCAB_RECALL}`;

  return (
    <Button href={href} variant="primary" size="md">
      Drill this topic
    </Button>
  );
}
