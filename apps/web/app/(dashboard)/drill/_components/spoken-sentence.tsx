'use client';

import * as React from 'react';
import { usePhraseAudio, type AuthenticatedFetch } from '@language-drill/api-client';
import { Button } from '../../../../components/ui/button';
import { AudioPlayer } from './audio-player';

function SpeakerIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

export interface SpokenSentenceProps {
  /** The sentence the server will voice (submit response `spokenText`). */
  text: string;
  exerciseId: string;
  submissionId: string;
  fetchFn: AuthenticatedFetch;
}

const controlClass = '!rounded-pill !min-h-[44px]';

/**
 * "Hear it" row on a cloze / translation / sentence-construction result card:
 * the correct sentence plus a press-to-play control. The clip is fetched on
 * the first press only; after that the player owns replay, seek and slow mode.
 * Failures stay quiet inline text — this is a reinforcement, never a blocker.
 */
export function SpokenSentence({ text, exerciseId, submissionId, fetchFn }: SpokenSentenceProps) {
  const { mutate, data, isPending, isError, error } = usePhraseAudio({ fetchFn });
  const [opened, setOpened] = React.useState(false);
  const request = () => mutate({ exerciseId, submissionId });

  let control: React.ReactNode;
  if (!opened) {
    control = (
      <Button
        variant="chip"
        size="sm"
        className={controlClass}
        onClick={() => {
          setOpened(true);
          request();
        }}
      >
        <SpeakerIcon />
        listen
      </Button>
    );
  } else if (isPending) {
    control = (
      <span className="t-small inline-flex min-h-[44px] items-center gap-[8px] text-ink-mute">
        <span
          aria-hidden="true"
          className="inline-block h-[12px] w-[12px] animate-spin rounded-full border border-rule border-t-accent"
        />
        preparing audio…
      </span>
    );
  } else if (isError && (error as { status?: number } | null)?.status === 429) {
    control = (
      <span className="t-small inline-flex min-h-[44px] items-center text-ink-mute">
        daily audio limit reached
      </span>
    );
  } else if (isError) {
    control = (
      <Button variant="chip" size="sm" className={controlClass} onClick={request}>
        retry audio
      </Button>
    );
  } else if (data?.audioUrl) {
    control = <AudioPlayer src={data.audioUrl} waveform={[]} durationSec={data.durationSec} autoPlay />;
  } else if (data) {
    control = (
      <span className="t-small inline-flex min-h-[44px] items-center text-ink-mute">
        audio unavailable — try again later
      </span>
    );
  } else {
    control = null;
  }

  return (
    <div className="flex flex-col gap-s-2">
      <p className="t-micro text-ink-mute">hear it</p>
      <p className="t-body">{text}</p>
      {control}
    </div>
  );
}
