'use client';

import type { VocabRecallContent } from '@language-drill/shared';
import { Card } from '../ui';

export interface VocabPromptCardProps {
  content: VocabRecallContent;
}

// The vocab-recall prompt header, shared by the standard drill and fluency mode.
export function VocabPromptCard({ content }: VocabPromptCardProps) {
  return (
    <Card padding="lg">
      <p className="t-display-s">{content.prompt}</p>
    </Card>
  );
}
