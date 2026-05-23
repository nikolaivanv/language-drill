'use client';

import * as React from 'react';
import {
  isClozeContent,
  isTranslationContent,
  isVocabRecallContent,
  type ClozeContent,
  type ExerciseContent,
  type TranslationContent,
  type VocabRecallContent,
} from '@language-drill/shared';
import type { DebriefItem } from '@language-drill/api-client';
import { Card, Chip } from '../../../../../components/ui';
import { splitClozeSentence } from '../../../../../lib/drill/cloze-blank';

// ---------------------------------------------------------------------------
// ReviewItemCard — one card per debrief item, in manifest order. Renders a
// header chrome (index + topic + status chip) that toggles an expanded body.
// Correct items collapse by default; incorrect / skipped expand by default
// (Req 5.9). The body switches by exercise type — this file ships the cloze
// branch (Req 5.5); translation + vocab branches land in task 12.
// ---------------------------------------------------------------------------

export interface ReviewItemCardProps {
  index: number;
  item: DebriefItem;
}

export function ReviewItemCard({ index, item }: ReviewItemCardProps) {
  const [expanded, setExpanded] = React.useState(item.status !== 'correct');

  const content = item.contentJson as ExerciseContent;
  const topic =
    content && typeof content === 'object' && 'topicHint' in content
      ? content.topicHint
      : undefined;

  return (
    <Card padding="md">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-s-3 text-left"
      >
        <div className="flex items-center gap-s-3">
          <span className="t-mono text-ink-mute" style={{ fontSize: 11 }}>
            #{index + 1}
          </span>
          {topic !== undefined && topic.length > 0 && (
            <Chip variant="default">{topic}</Chip>
          )}
          <StatusChip status={item.status} />
        </div>
      </button>

      {expanded && (
        <div className="mt-s-3">
          {item.status === 'skipped' ? (
            <SkippedBody item={item} />
          ) : isClozeContent(content) ? (
            <ClozeBody item={item} content={content} />
          ) : isTranslationContent(content) ? (
            <TranslationBody item={item} content={content} />
          ) : isVocabRecallContent(content) ? (
            <VocabBody item={item} content={content} />
          ) : null}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Status chip — sage for correct (Req 5.2), terracotta for incorrect (5.3),
// paper-3 for skipped (5.4)
// ---------------------------------------------------------------------------

function StatusChip({ status }: { status: DebriefItem['status'] }) {
  if (status === 'correct') {
    return <Chip variant="ok">✓ correct</Chip>;
  }
  if (status === 'incorrect') {
    return <Chip variant="accent">✗ missed</Chip>;
  }
  return (
    <Chip variant="default" className="bg-paper-3">
      skipped
    </Chip>
  );
}

// ---------------------------------------------------------------------------
// Skipped body — prompt only + caption (Req 5.4)
// ---------------------------------------------------------------------------

function SkippedBody({ item }: { item: DebriefItem }) {
  const content = item.contentJson as ExerciseContent | undefined;
  const prompt = readPrompt(content);
  return (
    <>
      {prompt !== null && <p className="t-body">{prompt}</p>}
      <p className="t-small mt-s-2 italic text-ink-mute">
        skipped — no submission
      </p>
    </>
  );
}

/**
 * Best-effort prompt extraction for the skipped body. Cloze: the sentence
 * with the blank still rendered as `___`. Translation / vocab: the source /
 * prompt line. Returns null if no readable prompt is available.
 */
function readPrompt(content: ExerciseContent | undefined): string | null {
  if (!content || typeof content !== 'object') return null;
  if ('sentence' in content && typeof content.sentence === 'string') {
    return content.sentence;
  }
  if ('sourceText' in content && typeof content.sourceText === 'string') {
    return content.sourceText;
  }
  if ('prompt' in content && typeof content.prompt === 'string') {
    return content.prompt;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cloze body — two cells: "your answer" + "corrected" / "why it works" (Req 5.5)
// ---------------------------------------------------------------------------

interface ClozeBodyProps {
  item: DebriefItem;
  content: ClozeContent;
}

function ClozeBody({ item, content }: ClozeBodyProps) {
  const { before, after, hasBlank } = splitClozeSentence(content.sentence);
  const isCorrect = item.status === 'correct';

  // The user's filled-in token. Sage tint on correct, terracotta tint with
  // strike-through on incorrect (Req 5.2, 5.3).
  const userToken = (
    <span
      className="t-mono"
      style={{
        background: isCorrect
          ? 'var(--color-ok-soft)'
          : 'var(--color-accent-soft)',
        color: isCorrect ? 'var(--color-ok)' : 'var(--color-accent-2)',
        padding: '1px 6px',
        borderRadius: 4,
        fontSize: 15,
        textDecoration: isCorrect ? 'none' : 'line-through',
      }}
    >
      {item.userAnswer ?? ''}
    </span>
  );

  // Reference (correct) token rendered in a green-bordered pill.
  const referenceToken = (
    <span
      className="t-mono"
      style={{
        background: 'var(--color-card)',
        padding: '1px 6px',
        borderRadius: 4,
        fontSize: 15,
        fontWeight: 600,
        border: '1.5px solid var(--color-ok)',
      }}
    >
      {content.correctAnswer}
    </span>
  );

  const renderSentence = (token: React.ReactNode) =>
    hasBlank ? (
      <>
        {before}
        {token}
        {after}
      </>
    ) : (
      content.sentence
    );

  return (
    <>
      <div className="grid grid-cols-2 mobile:grid-cols-1 gap-s-3">
        <div className="rounded-r-md p-s-3 bg-paper-2">
          <div className="t-micro">your answer</div>
          <div
            className="mt-s-2"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 17,
              lineHeight: 1.4,
            }}
          >
            {renderSentence(userToken)}
          </div>
        </div>
        <div
          className="rounded-r-md p-s-3"
          style={{
            background: isCorrect ? 'transparent' : 'var(--color-ok-soft)',
            border: isCorrect ? '1px dashed var(--color-rule)' : 'none',
          }}
        >
          <div className="t-micro">{isCorrect ? 'why it works' : 'corrected'}</div>
          {!isCorrect && (
            <div
              className="mt-s-2"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 17,
                lineHeight: 1.4,
              }}
            >
              {renderSentence(referenceToken)}
            </div>
          )}
        </div>
      </div>
      {item.evaluation?.feedback && (
        <p className="t-small mt-s-3">{item.evaluation.feedback}</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Translation body — two cells: "your translation" + "reference" / "one accepted form" (Req 5.6)
// ---------------------------------------------------------------------------

interface TranslationBodyProps {
  item: DebriefItem;
  content: TranslationContent;
}

function TranslationBody({ item, content }: TranslationBodyProps) {
  const isCorrect = item.status === 'correct';
  return (
    <>
      <p className="t-small italic mb-s-2">"{content.sourceText}"</p>
      <div className="grid grid-cols-2 mobile:grid-cols-1 gap-s-3">
        <div className="rounded-r-md p-s-3 bg-paper-2">
          <div className="t-micro">your translation</div>
          <div
            className="mt-s-2"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 16,
              lineHeight: 1.4,
              textDecoration: isCorrect ? 'none' : 'line-through',
              color: isCorrect ? 'var(--color-ok)' : 'var(--color-accent-2)',
            }}
          >
            {item.userAnswer ?? ''}
          </div>
        </div>
        <div
          className="rounded-r-md p-s-3"
          style={{
            background: isCorrect ? 'transparent' : 'var(--color-ok-soft)',
            border: isCorrect ? '1px dashed var(--color-rule)' : 'none',
          }}
        >
          <div className="t-micro">
            {isCorrect ? 'one accepted form' : 'reference'}
          </div>
          <div
            className="mt-s-2"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 16,
              lineHeight: 1.4,
            }}
          >
            {content.referenceTranslation}
          </div>
        </div>
      </div>
      {item.evaluation?.feedback && (
        <p className="t-small mt-s-3">{item.evaluation.feedback}</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Vocab recall body — italic prompt + two cells: "you typed" + "target word" (Req 5.7)
// ---------------------------------------------------------------------------

interface VocabBodyProps {
  item: DebriefItem;
  content: VocabRecallContent;
}

function VocabBody({ item, content }: VocabBodyProps) {
  const isCorrect = item.status === 'correct';
  return (
    <>
      <p className="t-small italic mb-s-2">"{content.prompt}"</p>
      <div className="grid grid-cols-2 mobile:grid-cols-1 gap-s-3">
        <div className="rounded-r-md p-s-3 bg-paper-2">
          <div className="t-micro">you typed</div>
          <div
            className="mt-s-2"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              lineHeight: 1.4,
              textDecoration: isCorrect ? 'none' : 'line-through',
              color: isCorrect ? 'var(--color-ok)' : 'var(--color-accent-2)',
            }}
          >
            {item.userAnswer ?? ''}
          </div>
        </div>
        <div
          className="rounded-r-md p-s-3"
          style={{
            background: isCorrect ? 'transparent' : 'var(--color-ok-soft)',
            border: isCorrect ? '1px dashed var(--color-rule)' : 'none',
          }}
        >
          <div className="t-micro">target word</div>
          <div
            className="mt-s-2"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              lineHeight: 1.4,
              fontWeight: 500,
            }}
          >
            {content.expectedWord}
          </div>
          {content.exampleSentence.length > 0 && (
            <p className="t-small mt-s-2">{content.exampleSentence}</p>
          )}
        </div>
      </div>
      {item.evaluation?.feedback && (
        <p className="t-small mt-s-3">{item.evaluation.feedback}</p>
      )}
    </>
  );
}
