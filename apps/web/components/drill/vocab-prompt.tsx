'use client';

import { articleChoicesLabel, type VocabRecallContent } from '@language-drill/shared';
import { Card } from '../ui';

export interface VocabPromptCardProps {
  content: VocabRecallContent;
}

// The vocab-recall prompt header, shared by the standard drill and fluency mode.
// An article-bearing noun says so on screen: the grader requires the article,
// and before this line the requirement lived only in hidden instructions.
export function VocabPromptCard({ content }: VocabPromptCardProps) {
  const articles = content.articleForm ? articleChoicesLabel(content.articleForm) : null;
  return (
    <Card padding="lg">
      <p className="t-display-s max-w-[34em]">{content.prompt}</p>
      {articles && (
        <p className="t-small mt-s-3 text-ink-mute">include the article ({articles})</p>
      )}
    </Card>
  );
}
