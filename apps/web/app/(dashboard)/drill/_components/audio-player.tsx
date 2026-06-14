'use client';

import * as React from 'react';
import { Button } from '../../../../components/ui';

export interface AudioPlayerProps {
  src: string | undefined;
  waveform: number[];
  durationSec: number;
}

export function AudioPlayer({ src, waveform, durationSec }: AudioPlayerProps) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [slow, setSlow] = React.useState(false);
  const [progress, setProgress] = React.useState(0); // 0..1

  const disabled = !src;

  React.useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = slow ? 0.75 : 1;
  }, [slow]);

  function togglePlay() {
    const a = audioRef.current;
    if (!a || disabled) return;
    if (playing) a.pause();
    else void a.play();
  }

  function replay() {
    const a = audioRef.current;
    if (!a || disabled) return;
    a.currentTime = 0;
    setProgress(0);
    void a.play();
  }

  function onTimeUpdate() {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    setProgress(a.currentTime / a.duration);
  }

  const total = formatTime(durationSec);
  const elapsed = formatTime(progress * durationSec);

  return (
    <div className="rounded-md border border-rule bg-paper-2 p-s-4">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={onTimeUpdate}
      />
      <div className="flex items-center gap-s-4">
        <button
          type="button"
          aria-label={playing ? 'pause' : 'play'}
          onClick={togglePlay}
          disabled={disabled}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-ink text-paper disabled:opacity-40"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="flex flex-1 items-end gap-[2px]" aria-hidden>
          {waveform.map((h, i) => {
            const played = (i + 0.5) / waveform.length <= progress;
            return (
              <span
                key={i}
                className={played ? 'bg-[var(--color-accent)]' : 'bg-paper-3'}
                style={{
                  flex: 1,
                  minWidth: 2,
                  height: `${Math.max(10, h * 100)}%`,
                  borderRadius: 999,
                }}
              />
            );
          })}
        </div>
        <span className="t-mono t-micro text-ink-mute">
          {elapsed} / {total}
        </span>
      </div>
      <div className="mt-s-3 flex items-center gap-s-2">
        <Button variant="ghost" aria-label="restart audio" onClick={replay} disabled={disabled}>
          replay
        </Button>
        <button
          type="button"
          aria-pressed={slow}
          onClick={() => setSlow((s) => !s)}
          disabled={disabled}
          className={`t-small rounded-full border px-s-3 py-s-1 ${
            slow ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-soft'
          }`}
        >
          0.75× slow
        </button>
      </div>
    </div>
  );
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
