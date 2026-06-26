'use client';

import * as React from 'react';

export interface AudioPlayerProps {
  src: string | undefined;
  waveform: number[];
  durationSec: number;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Where along the waveform (0..1) a pointer at `clientX` landed. */
function fractionFromClientX(clientX: number, rect: DOMRect): number {
  if (rect.width <= 0) return 0;
  return clamp01((clientX - rect.left) / rect.width);
}

export function AudioPlayer({ src, waveform, durationSec }: AudioPlayerProps) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const waveRef = React.useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [slow, setSlow] = React.useState(false);
  const [progress, setProgress] = React.useState(0); // 0..1 playhead
  const [dragging, setDragging] = React.useState(false);
  const [hoverFrac, setHoverFrac] = React.useState<number | null>(null);

  const disabled = !src;

  // Re-apply the slow rate whenever the toggle OR the clip changes — a new src
  // gives a fresh <audio> element at rate 1, so without `src` here the next clip
  // would ignore an already-on slow toggle.
  React.useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = slow ? 0.75 : 1;
  }, [slow, src]);

  // A new clip resets the playhead and play state (guards against a stale
  // progress/▮▮ flash if the player isn't remounted per clip).
  React.useEffect(() => {
    setProgress(0);
    setPlaying(false);
  }, [src]);

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
    // While the user is actively scrubbing, the drag owns the playhead.
    if (dragging) return;
    setProgress(a.currentTime / a.duration);
  }

  // Move the playhead to a 0..1 fraction: drive the <audio> element (the real
  // seek) and mirror it into `progress` so the UI tracks even while paused, or
  // when jsdom never fires `timeupdate`.
  function seekToFraction(frac: number) {
    const f = clamp01(frac);
    const a = audioRef.current;
    if (a && Number.isFinite(durationSec)) {
      a.currentTime = f * durationSec;
    }
    setProgress(f);
  }

  function waveRect(): DOMRect | null {
    return waveRef.current?.getBoundingClientRect() ?? null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    const r = waveRect();
    if (!r) return;
    setDragging(true);
    // setPointerCapture isn't implemented in jsdom — guard so tests don't throw.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* no-op */
    }
    seekToFraction(fractionFromClientX(e.clientX, r));
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    const r = waveRect();
    if (!r) return;
    const frac = fractionFromClientX(e.clientX, r);
    setHoverFrac(frac);
    if (dragging) seekToFraction(frac);
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* no-op */
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const cur = progress * durationSec;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = cur + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = cur - 1;
        break;
      case 'PageUp':
        next = cur + 5;
        break;
      case 'PageDown':
        next = cur - 5;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = durationSec;
        break;
      default:
        return;
    }
    e.preventDefault();
    seekToFraction(durationSec > 0 ? next / durationSec : 0);
  }

  const total = formatTime(durationSec);
  const elapsed = formatTime(progress * durationSec);
  const valueNow = Math.round(progress * durationSec);

  return (
    <div className="rounded-lg border border-rule bg-paper-2 p-s-4 sm:p-s-5">
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
          className="flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-full bg-ink text-paper shadow-1 transition-transform duration-150 hover:scale-[1.04] active:scale-[0.97] disabled:opacity-40 disabled:hover:scale-100 sm:h-16 sm:w-16"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        <div
          ref={waveRef}
          role="slider"
          aria-label="seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(durationSec)}
          aria-valuenow={valueNow}
          aria-valuetext={`${elapsed} of ${total}`}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => {
            if (!dragging) setHoverFrac(null);
          }}
          onKeyDown={onKeyDown}
          className={`relative flex h-[34px] flex-1 touch-none select-none items-center gap-[2px] overflow-hidden outline-none sm:h-[42px] sm:gap-[3px] ${
            disabled
              ? 'cursor-default'
              : 'cursor-pointer focus-visible:shadow-[0_0_0_2px_var(--color-paper),0_0_0_4px_var(--color-ink)]'
          }`}
        >
          {waveform.map((h, i) => {
            const played = (i + 0.5) / waveform.length <= progress;
            return (
              <span
                key={i}
                aria-hidden
                className={`pointer-events-none rounded-[2px] ${
                  played ? 'bg-accent' : 'bg-rule-strong'
                }`}
                style={{
                  flex: 1,
                  minWidth: 2,
                  height: `${Math.max(10, h * 100)}%`,
                }}
              />
            );
          })}
          {/* Hover playhead: a faint accent tick previewing where a click lands. */}
          {!disabled && hoverFrac !== null && !dragging && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-[2px] bg-accent/50"
              style={{ left: `${hoverFrac * 100}%` }}
            />
          )}
        </div>

        <span className="t-mono flex-shrink-0 whitespace-nowrap text-[13px] tracking-[1px] text-ink-mute sm:text-[16px]">
          {elapsed} / {total}
        </span>
      </div>

      <div className="mt-s-4 flex items-center gap-s-3 sm:mt-s-5">
        <button
          type="button"
          onClick={replay}
          disabled={disabled}
          className="inline-flex items-center gap-[7px] rounded-md border border-rule bg-card px-s-4 py-s-2 text-[14px] font-medium text-ink-2 transition-colors duration-150 hover:bg-paper-2 disabled:opacity-40 disabled:hover:bg-card"
        >
          <ReplayIcon />
          replay
        </button>
        <button
          type="button"
          aria-pressed={slow}
          onClick={() => setSlow((s) => !s)}
          disabled={disabled}
          className={`inline-flex items-center gap-[7px] rounded-md border px-s-4 py-s-2 text-[14px] font-medium transition-colors duration-150 disabled:opacity-40 ${
            slow
              ? 'border-ink bg-ink text-paper'
              : 'border-rule bg-card text-ink-2 hover:bg-paper-2 disabled:hover:bg-card'
          }`}
        >
          0.75× slow
        </button>
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="sm:h-[26px] sm:w-[26px]"
    >
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="sm:h-[26px] sm:w-[26px]"
    >
      <rect x="6.5" y="5.5" width="3.6" height="13" rx="1" />
      <rect x="13.9" y="5.5" width="3.6" height="13" rx="1" />
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 2.6-6.3" />
      <path d="M3 4.2V9.5h5.3" />
    </svg>
  );
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
