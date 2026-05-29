'use client';

// ---------------------------------------------------------------------------
// WordCardBody — shared word-card content (header / body / footer)
// ---------------------------------------------------------------------------
// Lifted out of `WordPopover` so the same lemma/POS/CEFR/gloss/example/freq +
// save/skip markup renders identically inside the desktop click-anchored
// popover and the mobile `WordSheet` (Requirement 8.2). The wrapping component
// owns positioning, the dialog role/aria-label, and dismissal — this piece is
// pure presentation + the two action callbacks.
//
// `skipRef` is forwarded onto the skip/close button so the popover can keep
// auto-focusing it for keyboard openings; the sheet omits it (BottomSheet's
// focus trap handles focus).
// ---------------------------------------------------------------------------

import * as React from 'react';
import type { DeepWordCard, WordFlag } from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';
import { PhraseCardBody } from './phrase-card-body';
import { SentenceCardBody } from './sentence-card-body';
import type { DeepCardSlice } from '../_state/read-page-reducer';

type Props = {
  entry: WordFlag;
  inBank: boolean;
  onSave: () => void;
  onSkip: () => void;
  /** Forwarded onto the skip/close button — used by the popover's autoFocus. */
  skipRef?: React.Ref<HTMLButtonElement>;
  /**
   * When true, the footer swaps the `freq #…` line for a spinner + "looking
   * it up…" caption, signalling that a richer deep card is loading in the
   * background. Used for the skim-preview-during-deep-load window for a
   * flagged-word tap (Req 3.1 + 3.3 clarity).
   */
  loadingDeep?: boolean;
};

export function WordCardBody({
  entry,
  inBank,
  onSave,
  onSkip,
  skipRef,
  loadingDeep,
}: Props) {
  return (
    <>
      {/* Header */}
      <div className="border-b border-rule px-[16px] pt-[14px] pb-[10px]">
        <div className="flex items-baseline gap-[8px]">
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 500,
              letterSpacing: '-0.2px',
            }}
          >
            {entry.lemma}
          </span>
          <span className="t-small italic">{entry.pos}</span>
          <span className="ml-auto" />
          <span className="t-mono text-[11px] text-accent">{entry.cefr}</span>
        </div>
        <p className="t-body text-ink-2 mt-[4px]">{entry.gloss}</p>
      </div>

      {/* Body */}
      <div className="px-[16px] py-[12px]">
        <div className="t-micro mb-[6px]">example</div>
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 15,
            lineHeight: 1.5,
          }}
        >
          {entry.example}
        </p>
      </div>

      {/* Footer — swaps `freq #…` for an inline loading indicator while the
       *  deep card resolves in the background (Req 3.1 + 3.3 clarity). The
       *  freq returns implicitly once the deep card body swaps in (it carries
       *  its own freq display). */}
      <div className="flex items-center gap-[6px] border-t border-rule bg-paper-2 px-[12px] py-[10px]">
        {loadingDeep ? (
          <span
            data-testid="skim-loading-deep"
            className="t-mono flex flex-1 items-center gap-[6px] text-[10px] uppercase tracking-wide text-ink-mute"
          >
            <span
              aria-hidden
              className="inline-block h-[10px] w-[10px] animate-spin rounded-full border border-rule border-t-accent"
            />
            looking it up…
          </span>
        ) : (
          <span className="t-mono flex-1 text-[10px] text-ink-mute">
            freq #{entry.freq.toLocaleString('en-US')}
          </span>
        )}
        <Button ref={skipRef} variant="ghost" size="sm" onClick={onSkip}>
          {inBank ? 'close' : 'skip'}
        </Button>
        <Button
          variant={inBank ? 'accent' : 'primary'}
          size="sm"
          onClick={onSave}
        >
          {inBank ? '✓ saved · undo' : '+ save to bank'}
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleRow — one expandable extras section (collapsed by default)
// ---------------------------------------------------------------------------
// Used for the optional word-card sections (synonyms, collocations, register,
// extra example) that are individually expandable and collapsed by default
// (Req 6.4). A plain `<button>` header with `aria-expanded` keeps it
// keyboard-accessible and screen-reader-labelled (NFR Usability).
// ---------------------------------------------------------------------------

function CollapsibleRow({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="border-t border-rule first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="t-small flex w-full items-center gap-[8px] py-[8px] text-left text-ink-2 transition-colors hover:text-ink"
      >
        <span className="t-mono w-[10px] text-ink-mute" aria-hidden>
          {open ? '−' : '+'}
        </span>
        <span>{label}</span>
        {count != null && (
          <span className="t-mono text-[10px] text-ink-mute">{count}</span>
        )}
      </button>
      {open && <div className="pb-[10px] pl-[18px]">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeepWordCardBody — the rich on-demand word card (Req 6, Req 7)
// ---------------------------------------------------------------------------
// Renders a resolved `DeepWordCard`: header (inflected headword / POS / CEFR /
// freq) with an inline inflection line (Req 6.1, 6.2), the contextual "here"
// sense, the CEFR-calibrated target-language definition labelled with the
// language name (Req 6.1, 6.6), a morphology breakdown with a sentence-grounded
// "why this form" (Req 6.3, 7.1), and the optional synonyms / collocations /
// register / extra-example sections as collapsible rows collapsed by default
// (Req 6.4). Absent optional fields render nothing — no empty blocks (Req 6.5).
//
// Shares the chrome contract of `WordCardBody` (footer save/skip + `skipRef`),
// so it drops into the same `WordPopover` / `WordSheet` wrappers. Save posts
// the resolved card to vocabulary (wired in task 29).
// ---------------------------------------------------------------------------

export function DeepWordCardBody({
  card,
  inBank,
  onSave,
  onSkip,
  skipRef,
}: {
  card: DeepWordCard;
  inBank: boolean;
  onSave: () => void;
  onSkip: () => void;
  skipRef?: React.Ref<HTMLButtonElement>;
}) {
  const inflectionLine = card.inflection?.forms
    .map((f) => `${f.label} ${f.value}`)
    .join(' · ');

  return (
    <>
      {/* Header — inflected surface form is the headword (Req 6.1) */}
      <div className="border-b border-rule px-[16px] pt-[14px] pb-[10px]">
        <div className="flex items-baseline gap-[8px]">
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 500,
              letterSpacing: '-0.2px',
            }}
          >
            {card.surface}
          </span>
          <span className="t-small italic">{card.pos}</span>
          <span className="ml-auto" />
          <span className="t-mono text-[11px] text-accent">{card.cefr}</span>
        </div>
        <div className="t-mono mt-[3px] text-[10px] text-ink-mute">
          #{card.freq.toLocaleString('en-US')}
          {card.lemma !== card.surface && <> · {card.lemma}</>}
        </div>
        {/* Inflection inline near the header — not behind a toggle (Req 6.2) */}
        {inflectionLine && (
          <div className="t-small mt-[6px] text-ink-2">{inflectionLine}</div>
        )}
      </div>

      {/* Body */}
      <div className="px-[16px] py-[12px]">
        {/* Contextual sense — "what it means here" (Req 6.1) */}
        <div>
          <span className="t-micro">here</span>
          <p className="t-body text-ink-2 mt-[2px]">“{card.contextualSense}”</p>
        </div>

        {/* Target-language definition, labelled with the language name (Req 6.1, 6.6) */}
        <div className="mt-[12px]">
          <div className="t-micro">{card.definitionLabel}</div>
          <p
            className="mt-[2px]"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 15,
              lineHeight: 1.5,
            }}
          >
            {card.definition}
          </p>
        </div>

        {/* Morphology breakdown + "why this form" (Req 6.3, 7.1) */}
        {card.morphology && (
          <div className="mt-[14px]">
            <div className="t-micro mb-[6px]">morphology</div>
            <div className="t-small text-ink-2">
              root <span className="font-medium text-ink">{card.morphology.root}</span>
              {card.morphology.rootGloss && (
                <span className="text-ink-mute"> — {card.morphology.rootGloss}</span>
              )}
            </div>
            <div className="mt-[6px] flex flex-wrap items-stretch gap-[4px]">
              {card.morphology.segments.map((seg, i) => (
                <React.Fragment key={i}>
                  {i > 0 && (
                    <span className="t-mono self-center text-ink-mute" aria-hidden>
                      +
                    </span>
                  )}
                  <div className="rounded-[4px] border border-rule bg-paper-2 px-[6px] py-[3px] text-center">
                    <div className="t-small font-medium">{seg.morph}</div>
                    <div className="t-mono text-[9px] text-ink-mute">{seg.function}</div>
                  </div>
                </React.Fragment>
              ))}
            </div>
            <p className="t-small mt-[8px] text-ink-2">
              <span className="t-mono mr-[6px] text-[9px] uppercase tracking-wide text-accent">
                why this form
              </span>
              {card.morphology.whyThisForm}
            </p>
          </div>
        )}

        {/* Optional sections — collapsible, collapsed by default (Req 6.4, 6.5) */}
        {(card.synonyms || card.collocations || card.register || card.extraExample) && (
          <div className="mt-[12px] border-t border-rule">
            {card.synonyms && card.synonyms.length > 0 && (
              <CollapsibleRow label="synonyms" count={card.synonyms.length}>
                <ul className="space-y-[4px]">
                  {card.synonyms.map((s, i) => (
                    <li key={i} className="t-small">
                      <span className="font-medium">{s.word}</span>
                      <span className="text-ink-mute"> — {s.note}</span>
                    </li>
                  ))}
                </ul>
              </CollapsibleRow>
            )}
            {card.collocations && card.collocations.length > 0 && (
              <CollapsibleRow label="collocations" count={card.collocations.length}>
                <ul className="space-y-[4px]">
                  {card.collocations.map((c, i) => (
                    <li key={i} className="t-small">
                      <span className="font-medium">{c.phrase}</span>
                      <span className="text-ink-mute"> — {c.gloss}</span>
                    </li>
                  ))}
                </ul>
              </CollapsibleRow>
            )}
            {card.register && (
              <CollapsibleRow label="register">
                <p className="t-small text-ink-2">{card.register}</p>
              </CollapsibleRow>
            )}
            {card.extraExample && (
              <CollapsibleRow label="another example">
                <p
                  style={{ fontFamily: 'var(--font-display)', fontSize: 15, lineHeight: 1.5 }}
                >
                  {card.extraExample.tl}
                </p>
                <p className="t-small mt-[2px] text-ink-mute">{card.extraExample.en}</p>
              </CollapsibleRow>
            )}
          </div>
        )}
      </div>

      {/* Footer — save posts the resolved card to vocabulary (task 29) */}
      <div className="flex items-center gap-[6px] border-t border-rule bg-paper-2 px-[12px] py-[10px]">
        <span className="flex-1" />
        <Button ref={skipRef} variant="ghost" size="sm" onClick={onSkip}>
          {inBank ? 'close' : 'skip'}
        </Button>
        <Button variant={inBank ? 'accent' : 'primary'} size="sm" onClick={onSave}>
          {inBank ? '✓ saved · undo' : '+ save to vocabulary'}
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// DeepCardSkeleton — "looking it up" loading body (Req 9.3)
// ---------------------------------------------------------------------------
// Shown inside the open popover/sheet chrome while a cold deep annotation is in
// flight, so the chrome opens instantly and never tears down/re-mounts on
// resolve (Req 3.3). Deterministic shimmer widths mirror the eventual card
// shape; styling matches `AnnotatedSkeleton` (paper-3 fills + `animate-pulse`).
// ---------------------------------------------------------------------------

export function DeepCardSkeleton() {
  return (
    <div data-testid="deep-card-skeleton" className="px-[16px] py-[14px]">
      {/* Header row — headword + meta chip */}
      <div className="flex items-center gap-[8px]">
        <span
          aria-hidden
          className="block h-[20px] w-[120px] rounded-r-sm bg-paper-3 animate-pulse"
        />
        <span
          aria-hidden
          className="ml-auto block h-[12px] w-[28px] rounded-r-sm bg-paper-2 animate-pulse"
        />
      </div>
      {/* Body lines */}
      {['70%', '92%', '85%', '60%'].map((w, i) => (
        <span
          key={i}
          aria-hidden
          className="mt-[10px] block h-[12px] rounded-r-sm bg-paper-3 animate-pulse"
          style={{ width: w }}
        />
      ))}
      {/* Caption */}
      <div className="t-small text-ink-mute mt-[16px] flex items-center gap-[8px]">
        <span
          aria-hidden
          className="inline-block h-[12px] w-[12px] animate-spin rounded-full border border-rule border-t-accent"
        />
        looking it up…
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeepCardError — inline error + retry body (Req 9.4)
// ---------------------------------------------------------------------------
// Replaces the card body on a failed/timed-out deep call instead of silently
// closing or showing an empty card. "try again" re-runs the request; it is
// disabled on a rate-limit (HTTP 429) since an immediate retry would just hit
// the cap again (mirrors `AnnotatedError`'s rate-limit handling). `skipRef`
// forwards onto the close button so the popover's autoFocus still lands.
// ---------------------------------------------------------------------------

export function DeepCardError({
  message,
  retryDisabled,
  onRetry,
  onClose,
  skipRef,
}: {
  message: string;
  retryDisabled?: boolean;
  onRetry: () => void;
  onClose: () => void;
  skipRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <div data-testid="deep-card-error">
      <div className="px-[16px] pt-[16px] pb-[12px]">
        <div className="t-small font-medium">couldn’t look this up</div>
        <p className="t-small text-ink-2 mt-[6px]">{message}</p>
      </div>
      <div className="flex items-center gap-[6px] border-t border-rule bg-paper-2 px-[12px] py-[10px]">
        <span className="flex-1" />
        <Button ref={skipRef} variant="ghost" size="sm" onClick={onClose}>
          close
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onRetry}
          disabled={retryDisabled}
        >
          try again
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeepCardContent — render the deep-card slice by status (Req 9.3, 9.4)
// ---------------------------------------------------------------------------
// The single render-by-`deepCard.status` switch used by both the desktop
// `WordPopover` and the mobile `WordSheet`, so the loading shimmer, the inline
// error+retry, and the three loaded layouts (word/phrase/sentence) stay
// identical across the two chromes (NFR Usability). `loaded` delegates to the
// layout components from tasks 25/26; `idle` renders nothing (the chrome should
// only mount this for an active span). Save/skip wire-up arrives in task 29.
// ---------------------------------------------------------------------------

export function DeepCardContent({
  slice,
  inBank,
  onSave,
  onSkip,
  onClose,
  onRetry,
  skipRef,
  resolveTheoryHref,
}: {
  slice: DeepCardSlice;
  inBank: boolean;
  onSave: () => void;
  onSkip: () => void;
  onClose: () => void;
  onRetry: () => void;
  skipRef?: React.Ref<HTMLButtonElement>;
  resolveTheoryHref?: (note: string) => string | null;
}) {
  if (slice.status === 'loading') {
    return <DeepCardSkeleton />;
  }
  if (slice.status === 'error') {
    return (
      <DeepCardError
        message={slice.error.message}
        retryDisabled={slice.error.status === 429}
        onRetry={onRetry}
        onClose={onClose}
        skipRef={skipRef}
      />
    );
  }
  if (slice.status === 'loaded') {
    const { card } = slice;
    switch (card.type) {
      case 'word':
        return (
          <DeepWordCardBody
            card={card}
            inBank={inBank}
            onSave={onSave}
            onSkip={onSkip}
            skipRef={skipRef}
          />
        );
      case 'phrase':
        return (
          <PhraseCardBody
            card={card}
            inBank={inBank}
            onSave={onSave}
            onSkip={onSkip}
            skipRef={skipRef}
          />
        );
      case 'sentence':
        return (
          <SentenceCardBody
            card={card}
            onClose={onClose}
            skipRef={skipRef}
            resolveTheoryHref={resolveTheoryHref}
          />
        );
    }
  }
  return null;
}
