import * as React from 'react';
import type { DictationContent, DictationResult } from '@language-drill/shared';
import type { DebriefItem } from '@language-drill/api-client';
import { AudioPlayer } from '../../_components/audio-player';
import { DictationResultBody } from '../../_components/dictation-result-body';

/**
 * Debrief body for a dictation item: replays the clip (when audio is available)
 * and shows the stored diff / score / criteria the learner saw at submit time.
 * `item.evaluation` is the union member preserved by the debrief schema; we
 * narrow to the dictation shape via its `kind` discriminant. Falls back to the
 * reference text + a "no result" note when no result was recorded.
 */
export function DictationBody({
  item,
  content,
}: {
  item: DebriefItem;
  content: DictationContent;
}) {
  const result =
    item.evaluation && 'kind' in item.evaluation && item.evaluation.kind === 'dictation'
      ? (item.evaluation as DictationResult)
      : null;

  return (
    <div className="flex flex-col gap-s-3">
      {content.audioUrl && (
        <AudioPlayer
          src={content.audioUrl}
          waveform={content.waveform}
          durationSec={content.durationSec}
        />
      )}
      {result ? (
        <>
          <p className="t-small" style={{ fontFamily: 'var(--font-display)' }}>
            {result.headline}
          </p>
          <DictationResultBody result={result} />
        </>
      ) : (
        <>
          <p className="t-body">{content.referenceText}</p>
          <p className="t-small italic text-ink-mute">no result recorded</p>
        </>
      )}
    </div>
  );
}
