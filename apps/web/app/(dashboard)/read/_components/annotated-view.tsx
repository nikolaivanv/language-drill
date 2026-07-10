'use client';

// ---------------------------------------------------------------------------
// AnnotatedView — central reader composition
// ---------------------------------------------------------------------------
// 2-column grid (`minmax(0, 1fr) 280px`) when the passage has at least one
// flagged word: left = reader pane (header + calibration + text + footer),
// right = sticky `WordBankRail`. When zero words are flagged, the rail is
// hidden and the footer is replaced with the sage `ZeroFlaggedStrip`.
//
// Outside-click handling: the `.rd-text` container dispatches
// `onPopoverClose`, but only when the click did not originate inside a
// flagged-word button (whose own click handler manages the popover) and
// not inside the popover itself (which already `stopPropagation`s in
// task 27). Without this filter, opening a popover and dismissing it
// would race in the same event tick.
// ---------------------------------------------------------------------------

import * as React from 'react';
import type {
  CefrLevel,
  DeepCard,
  FlaggedMap,
  ReadingCategory,
  ReadingTextLength,
} from '@language-drill/shared';
import type { SavedVocabItem } from '@language-drill/api-client';
import { AdjustBar } from './adjust-bar';
import { AnnotatedText, type SpanSelection } from './annotated-text';
import { ZeroFlaggedStrip } from './annotated-footer';
import { CalibrationStrip } from './calibration-strip';
import { CollectBar } from './collect-bar';
import { IntensityToggle } from './intensity-toggle';
import { ProvenanceHeader } from './provenance-header';
import { WordBankRail } from './word-bank-rail';
import { WordBankSheet } from './word-bank-sheet';
import { WordPopover } from './word-popover';
import { WordSheet } from './word-sheet';
import { track } from '../../../../lib/analytics/track';
import { useIsMobile } from '../../../../lib/responsive';
import { useActiveLanguage } from '../../../../components/shell/active-language-provider';
import type {
  ActiveWord,
  DeepCardSlice,
  DeepSpan,
  Intensity,
} from '../_state/read-page-reducer';

type AnnotatedEntry = {
  text: string;
  title: string;
  source: string;
  flaggedWords: FlaggedMap;
};

/** Adjust-bar action kinds (mirrors `AdjustBar`'s internal union). */
type AdjustKind = 'easier' | 'harder' | 'longer' | 'rewrite';

/** Generation provenance for the open passage — drives the result chrome. */
type ProvenanceInfo = {
  kind: 'generated' | 'pasted';
  category: ReadingCategory | null;
  cefr: CefrLevel;
  length: ReadingTextLength;
  prompt: string;
  language: 'ES' | 'DE' | 'TR';
};

type Props = {
  entry: AnnotatedEntry;
  bank: string[];
  intensity: Intensity;
  activeWord: ActiveWord | null;
  /** On-demand deep-annotation state machine (Req 3, 9.3, 9.4, 11.4). */
  deepCard: DeepCardSlice;
  calibration: { eyebrow: string; explanation: string };
  /**
   * When set, the calibration strip shows the streaming progress UI
   * ("annotating · M / N" + determinate bar). Cleared once annotation
   * completes (Req 5.3, 5.5).
   */
  annotateStreaming?: { flaggedCount: number; candidateCount: number };
  /**
   * When true (and not streaming), the calibration strip's explanation slot
   * is replaced with "· no above-level words" (Req §NFR Usability).
   */
  noAboveLevelWords?: boolean;
  onIntensityChange: (intensity: Intensity) => void;
  /**
   * Called when a flagged-word button is clicked. `x` and `y` are already
   * computed relative to the rd-text container so the parent can dispatch
   * them straight into `OPEN_POPOVER`.
   */
  onPopoverOpen: (word: string, x: number, y: number) => void;
  onPopoverClose: () => void;
  /**
   * A tap on any word or a drag-selected phrase/sentence. Offsets + the
   * container-relative anchor are forwarded; the parent fires the deep
   * endpoint (or serves a cache hit) (Req 3.2, 4.1, 4.3, 5.1, 11.4).
   */
  onSpanSelect: (span: DeepSpan) => void;
  /** Re-run the deep annotation from the inline error state (Req 9.4). */
  onDeepRetry: () => void;
  /** Save the resolved word/phrase deep card to vocabulary (Req 8.4). */
  onSaveCard: (card: DeepCard, span: DeepSpan) => void;
  /** Undo the just-saved deep card (Req 8.5). */
  onUndoCard: () => void;
  /** Offsets of the just-saved span, so the open card shows the "saved" footer. */
  savedSpan: { start: number; end: number } | null;
  /** Lowercased surface forms saved to vocabulary, for the in-passage style. */
  savedWordKeys: Set<string>;
  /**
   * Everything saved from this passage (flagged + on-demand), rendered in the
   * word-bank panel. The superset of `bank`; persists across reloads.
   */
  savedVocab: SavedVocabItem[];
  /** Unsave (✕) a saved row — deletes the vocabulary record. */
  onUnsaveVocab: (item: SavedVocabItem) => void;
  /**
   * Words in the spaced-review rotation, for the distinct under-review highlight
   * (Req 13.2). Lowercased lemma + surface sets from `useActiveReviewLemmas`
   * (fetched in the page). Optional — absent ⇒ no highlight.
   */
  underReview?: { lemmas: Set<string>; surfaces: Set<string> };
  onBankToggle: (word: string) => void;
  onPasteNew: () => void;
  /**
   * Generation provenance. When `kind === 'generated'`, the reader mounts the
   * provenance header + adjust bar above the passage. `null`/`pasted` ⇒ lean
   * reader with no provenance chrome. Optional so non-generate callers (tests)
   * can omit it.
   */
  provenance?: ProvenanceInfo | null;
  /** Make-easier/harder/longer/rewrite (regenerates from provenance). */
  onAdjust?: (kind: AdjustKind) => void;
  /** True while an adjust/rewrite generation is in flight. */
  adjustBusy?: boolean;
  /** Counts for the bottom collect bar. */
  flaggedCount: number;
  savedCount: number;
  /** Save the open passage (with current bank) to the library. */
  onSaveToLibrary?: () => void;
  /**
   * Whether the passage text can still be saved to the library — false once it
   * already lives there (an opened/persisted entry). Drives the disabled state
   * of the "save text" button so it isn't a confusing no-op (it saves the TEXT,
   * not the collected words).
   */
  canSaveToLibrary?: boolean;
  /** Save the passage AND push its banked words into the vocabulary. */
  onAddToVocabulary?: () => void;
  /** True while a library/vocabulary save is in flight. */
  saving?: boolean;
  /** Native language name for the provenance subline + tags. */
  languageLabel: string;
};

export function AnnotatedView({
  entry,
  bank,
  intensity,
  activeWord,
  deepCard,
  calibration,
  annotateStreaming,
  noAboveLevelWords,
  onIntensityChange,
  onPopoverOpen,
  onPopoverClose,
  onSpanSelect,
  onDeepRetry,
  onSaveCard,
  onUndoCard,
  savedSpan,
  savedWordKeys,
  savedVocab,
  onUnsaveVocab,
  underReview,
  onBankToggle,
  onPasteNew,
  provenance,
  onAdjust,
  adjustBusy,
  flaggedCount,
  savedCount,
  onSaveToLibrary,
  canSaveToLibrary = true,
  onAddToVocabulary,
  saving,
  languageLabel,
}: Props) {
  const { activeLanguage } = useActiveLanguage();
  const flaggedKeys = Object.keys(entry.flaggedWords);
  const hasFlagged = flaggedKeys.length > 0;
  // While annotation is still streaming, we don't yet know if there will be
  // any above-level words — the iterator could still yield flags. Showing
  // `ZeroFlaggedStrip` ("this passage is well within your level — nice.") at
  // that moment misleads the user before annotation is complete. Reserve the
  // 2-column grid + bank rail during streaming too so the layout doesn't
  // shift when the first flag arrives (NFR Usability — no layout shift on
  // tint).
  const isStreaming = annotateStreaming !== undefined;
  const showRail = hasFlagged || isStreaming || savedVocab.length > 0;
  const showZeroFlaggedState = !hasFlagged && !isStreaming;

  const bankSet = React.useMemo(() => new Set(bank), [bank]);

  // Provenance chrome (generated texts only): the header + adjust bar above the
  // passage, plus a "~N min" reading-time subline. Word count drives the
  // estimate at ~200 wpm.
  const isGenerated = provenance?.kind === 'generated';
  const wordCount = React.useMemo(
    () => entry.text.split(/\s+/).filter(Boolean).length,
    [entry.text],
  );
  const readingMinutes = Math.max(1, Math.round(wordCount / 200));

  const provenanceChrome =
    isGenerated && provenance ? (
      <div className="mb-[18px] space-y-[12px]">
        <ProvenanceHeader
          prompt={provenance.prompt}
          category={provenance.category}
          cefr={provenance.cefr}
          length={provenance.length}
          languageLabel={languageLabel}
          onRewrite={() => onAdjust?.('rewrite')}
          rewriting={adjustBusy}
        />
        <AdjustBar
          cefr={provenance.cefr}
          length={provenance.length}
          onAdjust={(kind) => onAdjust?.(kind)}
          busy={adjustBusy}
        />
        <div className="t-micro text-ink-mute">
          generated · {languageLabel} · {provenance.cefr} · ~{readingMinutes} min
        </div>
      </div>
    ) : null;

  const collectBar = (
    <div className="mt-[22px]">
      <CollectBar
        flaggedCount={flaggedCount}
        savedCount={savedCount}
        onSaveToLibrary={() => onSaveToLibrary?.()}
        canSaveToLibrary={canSaveToLibrary}
        onAddToVocabulary={() => onAddToVocabulary?.()}
        saving={saving}
      />
    </div>
  );

  // Mobile (≤760px) swaps the sticky rail + anchored popover for bottom sheets:
  // a toolbar chip opens the bank sheet, a word tap opens the word sheet. The
  // reducer's `activeWord` state (and the same open/close handlers) is reused —
  // only the presentation differs (Req 8.1–8.3).
  const isMobile = useIsMobile();
  const [bankSheetOpen, setBankSheetOpen] = React.useState(false);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(1000);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.offsetWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const deepActive = deepCard.status !== 'idle';

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // Flagged-word buttons own their open/close transitions.
    if (target.closest('[data-word]')) return;
    // Popover stops propagation already, but defensive against future edits.
    if (target.closest('[data-testid="word-popover"]')) return;
    if (activeWord !== null || deepActive) onPopoverClose();
  };

  const activeFlag =
    activeWord !== null ? entry.flaggedWords[activeWord.word] : null;

  // Convert a viewport-space rect into the rd-text container's coordinate space
  // so the popover anchors correctly (mirrors `handleWordClick`).
  const containerXY = (rect: DOMRect): { x: number; y: number } => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const containerRect = container.getBoundingClientRect();
    return {
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.bottom - containerRect.top + 6,
    };
  };

  const handleWordClick = (word: string, rect: DOMRect) => {
    const { x, y } = containerXY(rect);
    track('reading_annotation_used', { language: activeLanguage, mode: 'skim' as const });
    onPopoverOpen(word, x, y);
  };

  // Every selection flows here — a tap (single word) or a drag (phrase /
  // sentence), on desktop (mouse) or mobile (touch-drag). The span is already
  // fully resolved in AnnotatedText, so this just maps the rect to the
  // container's coordinate space and forwards it; the card opens at the
  // selection (Req 3.2, 4.1, 5.1). Select-first means one model call per span
  // and no card covering the passage during selection.
  const handleSpanSelect = (sel: SpanSelection) => {
    const { x, y } = containerXY(sel.rect);
    // handleSpanSelect is only wired to the deep-lookup path (onSpanSelect fires
    // the deep annotation endpoint); skim popover opens via handleWordClick.
    track('reading_annotation_used', { language: activeLanguage, mode: 'deep' as const });
    onSpanSelect({ start: sel.start, end: sel.end, type: sel.type, x, y });
  };

  // ---- Card chrome wiring (shared desktop popover / mobile sheet) ----------
  // The deep slice is forwarded as-is; the chrome decides what to render by
  // status — `loading` with a flagged `entry` shows the skim card with an
  // inline "looking it up…" footer indicator (Req 3.1 + 3.3 clarity), and the
  // same `WordPopover`/`WordSheet` instance stays mounted across the swap to
  // the loaded deep card.
  const chromeDeepCard: DeepCardSlice | undefined = deepActive ? deepCard : undefined;
  const cardOpen = deepActive || (activeFlag !== null && activeWord !== null);
  const anchor = deepActive
    ? { x: deepCard.span.x, y: deepCard.span.y }
    : activeWord
      ? { x: activeWord.x, y: activeWord.y }
      : null;
  // Label/headword for the chrome: the active flagged word, else the selected
  // substring (so a phrase/sentence card has a sensible aria-label).
  const cardWord = deepActive
    ? entry.text.slice(deepCard.span.start, deepCard.span.end)
    : (activeWord?.word ?? '');

  // The loaded deep slice, if any (kept whole so its `span` narrows for save).
  const loadedDeep = deepCard.status === 'loaded' ? deepCard : null;
  // Whether the open deep card's span is the just-saved one — drives the
  // card footer's "✓ saved · remove" state (Req 8.4).
  const deepCardSaved =
    savedSpan !== null &&
    deepCard.status !== 'idle' &&
    savedSpan.start === deepCard.span.start &&
    savedSpan.end === deepCard.span.end;
  // `inBank` for the chrome: the deep-save state when a deep card is loaded,
  // otherwise the skim word's entry-bank membership.
  const cardInBank = loadedDeep
    ? deepCardSaved
    : activeWord !== null && bankSet.has(activeWord.word);

  const handleCardSave = () => {
    // Loaded word/phrase deep card → vocabulary save / undo (Req 8.4, 8.5).
    if (loadedDeep && loadedDeep.card.type !== 'sentence') {
      if (deepCardSaved) onUndoCard();
      else onSaveCard(loadedDeep.card, loadedDeep.span);
      return;
    }
    // Skim card (flagged word, incl. the loading preview) → entry-bank toggle.
    if (activeWord) onBankToggle(activeWord.word);
  };

  // ---- Mobile: single column + toolbar chip + bottom sheets ----------------
  if (isMobile) {
    return (
      <div>
        {/* Header — bank chip replaces the rail; intensity moves into the sheet */}
        <div className="mb-[12px] flex items-start justify-between gap-[16px]">
          <div className="min-w-0">
            <h2 className="t-display-m">{entry.title || 'untitled passage'}</h2>
            {entry.source && (
              <div className="t-small text-ink-soft mt-[4px]">{entry.source}</div>
            )}
          </div>
          {showRail && (
            <button
              type="button"
              onClick={() => setBankSheetOpen(true)}
              className="t-small inline-flex min-h-[44px] flex-none items-center gap-[6px] rounded-pill border border-rule bg-card px-[14px] font-medium text-ink transition-colors hover:border-ink"
            >
              word bank · {savedVocab.length}
            </button>
          )}
        </div>

        {/* Calibration */}
        <div className="border-b border-dashed border-rule pb-[14px] mb-[22px]">
          <CalibrationStrip
            eyebrow={calibration.eyebrow}
            explanation={calibration.explanation}
            streaming={annotateStreaming}
            noAboveLevelWords={noAboveLevelWords}
          />
        </div>

        {/* Provenance + adjust (generated texts only) */}
        {provenanceChrome}

        {/* Reader text — the word sheet replaces the click-anchored popover */}
        <div
          ref={containerRef}
          data-testid="rd-text"
          className="rd-text relative"
          onClick={handleContainerClick}
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 19,
            lineHeight: 1.75,
          }}
        >
          <AnnotatedText
            text={entry.text}
            flaggedMap={entry.flaggedWords}
            intensity={intensity}
            bankSet={bankSet}
            savedWordKeys={savedWordKeys}
            underReview={underReview}
            activeWord={activeWord?.word ?? null}
            onWordClick={handleWordClick}
            onSpanSelect={handleSpanSelect}
          />
        </div>

        {/* Footer — only the zero-flagged "well within your level" strip; bank
         *  saves persist immediately so there's no explicit "save N to bank"
         *  action, and the flagged/saved/skipped tally added little signal. */}
        {!hasFlagged && showZeroFlaggedState ? (
          <ZeroFlaggedStrip onPasteNew={onPasteNew} />
        ) : null}

        {/* Collect bar — flagged/saved counts + save-to-library / add-to-vocab */}
        {collectBar}

        {/* Bottom sheets (portaled) */}
        <WordSheet
          open={cardOpen}
          entry={activeFlag}
          word={cardWord}
          inBank={cardInBank}
          deepCard={chromeDeepCard}
          onRetry={onDeepRetry}
          onSave={handleCardSave}
          onSkip={onPopoverClose}
          onClose={onPopoverClose}
        />
        {showRail && (
          <WordBankSheet
            open={bankSheetOpen}
            onClose={() => setBankSheetOpen(false)}
            saved={savedVocab}
            intensity={intensity}
            onIntensityChange={onIntensityChange}
            onUnsave={onUnsaveVocab}
          />
        )}
      </div>
    );
  }

  // ---- Desktop: 2-column grid + anchored popover + sticky rail -------------
  return (
    <div
      className="grid items-start gap-s-6"
      style={{
        gridTemplateColumns: showRail
          ? 'minmax(0, 1fr) 280px'
          : 'minmax(0, 1fr)',
      }}
    >
      <div>
        {/* Header */}
        <div className="flex items-start justify-between gap-[16px] mb-[12px]">
          <div className="min-w-0">
            <h2 className="t-display-m">{entry.title || 'untitled passage'}</h2>
            {entry.source && (
              <div className="t-small text-ink-soft mt-[4px]">{entry.source}</div>
            )}
          </div>
          <div className="flex items-center gap-[8px]">
            <span className="t-micro text-ink-mute">highlight</span>
            <IntensityToggle value={intensity} onChange={onIntensityChange} />
          </div>
        </div>

        {/* Calibration */}
        <div className="border-b border-dashed border-rule pb-[14px] mb-[22px]">
          <CalibrationStrip
            eyebrow={calibration.eyebrow}
            explanation={calibration.explanation}
            streaming={annotateStreaming}
            noAboveLevelWords={noAboveLevelWords}
          />
        </div>

        {/* Provenance + adjust (generated texts only) */}
        {provenanceChrome}

        {/* Reader text */}
        <div
          ref={containerRef}
          data-testid="rd-text"
          className="rd-text relative"
          onClick={handleContainerClick}
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 19,
            lineHeight: 1.75,
          }}
        >
          <AnnotatedText
            text={entry.text}
            flaggedMap={entry.flaggedWords}
            intensity={intensity}
            bankSet={bankSet}
            savedWordKeys={savedWordKeys}
            underReview={underReview}
            activeWord={activeWord?.word ?? null}
            onWordClick={handleWordClick}
            onSpanSelect={handleSpanSelect}
          />
          {cardOpen && anchor && (
            <WordPopover
              entry={activeFlag}
              word={cardWord}
              x={anchor.x}
              y={anchor.y}
              containerWidth={containerWidth}
              inBank={cardInBank}
              deepCard={chromeDeepCard}
              onRetry={onDeepRetry}
              onSave={handleCardSave}
              onSkip={onPopoverClose}
              onClose={onPopoverClose}
            />
          )}
        </div>

        {/* Footer — only the zero-flagged "well within your level" strip; bank
         *  saves persist immediately so there's no explicit "save N to bank"
         *  action, and the flagged/saved/skipped tally added little signal. */}
        {!hasFlagged && showZeroFlaggedState ? (
          <ZeroFlaggedStrip onPasteNew={onPasteNew} />
        ) : null}

        {/* Collect bar — flagged/saved counts + save-to-library / add-to-vocab */}
        {collectBar}
      </div>

      {showRail && (
        <WordBankRail saved={savedVocab} onUnsave={onUnsaveVocab} />
      )}
    </div>
  );
}
