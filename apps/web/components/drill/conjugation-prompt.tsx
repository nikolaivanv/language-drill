'use client';

import type { ConjugationContent } from '@language-drill/shared';
import { Card } from '../ui';
import { ConjugationFeatureBundle } from './conjugation-feature-bundle';

export interface ConjugationPromptCardProps {
  content: ConjugationContent;
}

// The conjugation prompt header (lemma + gloss + feature bundle), shared by the
// standard drill and fluency mode. The feature bundle renders as a prominent
// pronoun badge + glossed chips when the exercise carries structured data,
// falling back to the flat string for older pool rows.
export function ConjugationPromptCard({ content }: ConjugationPromptCardProps) {
  return (
    <Card padding="lg">
      <p className="t-display-m">{content.lemma}</p>
      <p className="t-body-l text-ink-mute">{content.lemmaGloss}</p>
      <ConjugationFeatureBundle content={content} />
    </Card>
  );
}
