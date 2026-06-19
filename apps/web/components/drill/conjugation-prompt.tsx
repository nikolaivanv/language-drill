'use client';

import type { ConjugationContent } from '@language-drill/shared';
import { Card } from '../ui';

export interface ConjugationPromptCardProps {
  content: ConjugationContent;
}

// The conjugation prompt header (lemma + gloss + feature bundle), shared by the
// standard drill and fluency mode.
export function ConjugationPromptCard({ content }: ConjugationPromptCardProps) {
  return (
    <Card padding="lg">
      <p className="t-display-s">{content.lemma}</p>
      <p className="t-body-l text-ink-mute">{content.lemmaGloss}</p>
      <p className="t-body text-ink-mute mt-s-2">{content.featureBundle}</p>
    </Card>
  );
}
