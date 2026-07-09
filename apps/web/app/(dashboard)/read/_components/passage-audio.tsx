'use client';

import * as React from 'react';
import { useReadAudio, type AuthenticatedFetch } from '@language-drill/api-client';
import { AudioPlayer } from '../../drill/_components/audio-player';

export function PassageAudio({ entryId, fetchFn }: { entryId: string; fetchFn: AuthenticatedFetch }) {
  const { mutate, data, isPending, isError, reset } = useReadAudio({ fetchFn });
  const [opened, setOpened] = React.useState(false);

  // Reset when switching passages.
  React.useEffect(() => {
    setOpened(false);
    reset();
  }, [entryId, reset]);

  const buttonClass =
    't-small inline-flex min-h-[44px] flex-none items-center gap-[6px] rounded-pill border border-rule bg-card px-[14px] font-medium text-ink transition-colors hover:border-ink disabled:opacity-40';

  if (!opened) {
    return (
      <button
        type="button"
        className={buttonClass}
        onClick={() => {
          setOpened(true);
          mutate({ entryId });
        }}
      >
        Listen
      </button>
    );
  }

  if (isPending) {
    return (
      <span className="t-small inline-flex min-h-[44px] items-center gap-[6px] text-ink-mute">
        preparing audio…
      </span>
    );
  }

  if (isError) {
    return (
      <button type="button" className={buttonClass} onClick={() => mutate({ entryId })}>
        retry audio
      </button>
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
