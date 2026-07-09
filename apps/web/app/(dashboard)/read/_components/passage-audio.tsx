'use client';

import * as React from 'react';
import { useReadAudio, type AuthenticatedFetch } from '@language-drill/api-client';
import { Button } from '../../../../components/ui/button';
import { AudioPlayer } from '../../drill/_components/audio-player';

// Speaker + sound-wave glyph (from the read-proto Listen control).
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

export function PassageAudio({
  entryId,
  fetchFn,
}: {
  entryId: string;
  fetchFn: AuthenticatedFetch;
}) {
  const { mutate, data, isPending, isError, reset } = useReadAudio({ fetchFn });
  const [opened, setOpened] = React.useState(false);

  // Reset when switching passages.
  React.useEffect(() => {
    setOpened(false);
    reset();
  }, [entryId, reset]);

  // Design-system chip button, kept as a pill for the Listen affordance.
  const controlClass = '!rounded-pill !min-h-[44px]';

  if (!opened) {
    return (
      <Button
        variant="chip"
        size="sm"
        className={controlClass}
        onClick={() => {
          setOpened(true);
          mutate({ entryId });
        }}
      >
        <SpeakerIcon />
        Listen
      </Button>
    );
  }

  if (isPending) {
    return (
      <span className="t-small inline-flex min-h-[44px] items-center gap-[8px] text-ink-mute">
        <span
          aria-hidden="true"
          className="inline-block h-[12px] w-[12px] animate-spin rounded-full border border-rule border-t-accent"
        />
        preparing audio…
      </span>
    );
  }

  if (isError) {
    return (
      <Button variant="chip" size="sm" className={controlClass} onClick={() => mutate({ entryId })}>
        retry audio
      </Button>
    );
  }

  if (data?.reason === 'too_long') {
    return (
      <span className="t-small inline-flex min-h-[44px] items-center gap-[6px] text-ink-mute">
        audio unavailable — passage too long to narrate
      </span>
    );
  }

  if (!data?.audioUrl) {
    return (
      <span className="t-small inline-flex min-h-[44px] items-center gap-[6px] text-ink-mute">
        audio unavailable — try again later
      </span>
    );
  }

  return <AudioPlayer src={data.audioUrl} waveform={[]} durationSec={data.durationSec} />;
}
