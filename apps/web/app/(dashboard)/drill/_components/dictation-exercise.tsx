'use client';

import * as React from 'react';
import {
  isDictationResult,
  type DictationContent,
  type DictationResult,
  type LearningLanguage,
} from '@language-drill/shared';
import { AccentPicker, Button, Card, Chip, Textarea } from '../../../../components/ui';
import { dictationVerdict } from '../../../../lib/drill/verdict-tier';
import { AudioPlayer } from './audio-player';
import { useDrillAction } from './drill-action-context';
import { FeedbackShell } from './feedback-shell';
import type { SubmissionMeta, SubmissionState } from './types';

export interface DictationExerciseProps {
  content: DictationContent;
  language: LearningLanguage;
  submission: SubmissionState;
  onSubmit: (answer: string, meta: SubmissionMeta) => void;
  onNext: () => void;
  nextLabel?: string;
}

function isAccentLanguage(lang: string): lang is 'ES' | 'DE' | 'TR' {
  return lang === 'ES' || lang === 'DE' || lang === 'TR';
}

export function DictationExercise({
  content,
  language,
  submission,
  onSubmit,
  onNext,
  nextLabel,
}: DictationExerciseProps) {
  const [answer, setAnswer] = React.useState('');
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const isLocked = submission.kind !== 'idle';
  const canSubmit = answer.trim().length > 0;

  function handleSubmit() {
    if (!answer.trim()) return;
    onSubmit(answer, {});
  }

  // On mobile, publish the submit CTA to the sticky action bar instead of
  // rendering it inline. Once evaluated, FeedbackShell owns the action (next).
  const { active, setPrimaryAction } = useDrillAction();
  React.useEffect(() => {
    if (!active || submission.kind === 'evaluated') return;
    setPrimaryAction({
      label: 'check',
      onClick: handleSubmit,
      disabled: !canSubmit || isLocked,
      loading: submission.kind === 'submitting',
    });
    // handleSubmit closes over answer — all captured deps listed.
  }, [active, setPrimaryAction, submission.kind, canSubmit, isLocked, answer]);

  return (
    <div className="flex flex-col gap-s-4">
      <div className="flex flex-col gap-s-2">
        <h2 className="t-display-s">{content.title}</h2>
        {content.blurb && <p className="t-small text-ink-mute">{content.blurb}</p>}
        <div className="flex flex-wrap items-center gap-s-2">
          <Chip>{content.accent}</Chip>
          {content.tested.map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
        </div>
      </div>

      <AudioPlayer
        src={content.audioUrl}
        waveform={content.waveform}
        durationSec={content.durationSec}
      />

      <div className="flex flex-col gap-s-3">
        <label className="t-small text-ink-mute">type what you hear</label>
        <Textarea
          ref={inputRef}
          rows={3}
          value={answer}
          spellCheck={false}
          readOnly={isLocked}
          disabled={isLocked}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="escribe la frase tal y como la oyes…"
          className={isLocked ? 'opacity-60' : undefined}
        />
        {isAccentLanguage(language) && (
          <AccentPicker language={language} targetRef={inputRef} disabled={isLocked} />
        )}
      </div>

      {!active && (
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={!canSubmit || isLocked}
          loading={submission.kind === 'submitting'}
        >
          check
        </Button>
      )}

      {submission.kind === 'evaluated' &&
        isDictationResult(submission.result) && (
          <DictationResults
            result={submission.result}
            onNext={onNext}
            nextLabel={nextLabel}
          />
        )}
    </div>
  );
}

function DictationResults({
  result,
  onNext,
  nextLabel,
}: {
  result: DictationResult;
  onNext: () => void;
  nextLabel?: string;
}) {
  const verdict = dictationVerdict(result.score);
  return (
    <FeedbackShell
      tier={verdict.tier}
      label={result.headline}
      scoreChipText={`${Math.round(result.adjustedCharAccuracy * 100)}%`}
      onNext={onNext}
      nextLabel={nextLabel}
    >
      <div className="flex flex-col gap-s-4">
        <p className="t-small text-ink-mute">
          raw {Math.round(result.rawCharAccuracy * 100)}% → adjusted{' '}
          {Math.round(result.adjustedCharAccuracy * 100)}% ·{' '}
          {Math.round(result.wordAccuracy * 100)}% words
        </p>

        <p className="t-body leading-loose">
          {result.diff.map((seg, i) => {
            if (seg.kind === 'match') {
              return <span key={i}>{seg.text} </span>;
            }
            if (seg.kind === 'accepted') {
              return (
                <span
                  key={i}
                  className="border-b-2 border-dotted border-[var(--color-ok)]"
                >
                  {seg.got}{' '}
                </span>
              );
            }
            // error segment
            return (
              <span key={i}>
                <span className="line-through text-ink-mute">{seg.got}</span>{' '}
                <span className="text-[var(--color-ok)]">{seg.expected}</span>{' '}
              </span>
            );
          })}
        </p>

        {result.differences.length > 0 && (
          <div className="flex flex-col gap-s-2">
            {result.differences.map((d) => (
              <Card key={d.id} padding="sm">
                <div className="flex flex-wrap items-center gap-s-2">
                  <Chip>{d.category}</Chip>
                  <span className="t-mono t-small">
                    <span className="line-through text-ink-mute">
                      {d.got || '∅'}
                    </span>{' '}
                    →{' '}
                    <span className="text-[var(--color-ok)]">{d.expected}</span>
                  </span>
                  <Chip>{d.kind === 'accepted' ? 'aceptado' : d.severity}</Chip>
                </div>
                <p className="t-small text-ink-soft mt-s-2">{d.note}</p>
              </Card>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-s-1">
          {result.criteria.map((c) => (
            <div key={c.id} className="flex items-baseline gap-s-2 t-small">
              <span className="flex-1">{c.label}</span>
              <span className="t-mono text-ink-mute">
                {Math.round(c.score * 100)}%
              </span>
              <Chip>{c.cefr}</Chip>
            </div>
          ))}
        </div>
      </div>
    </FeedbackShell>
  );
}
