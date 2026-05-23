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
import type { FlaggedMap } from '@language-drill/shared';
import { AnnotatedText } from './annotated-text';
import {
  AnnotatedFooter,
  ZeroFlaggedStrip,
} from './annotated-footer';
import { CalibrationStrip } from './calibration-strip';
import { IntensityToggle } from './intensity-toggle';
import { WordBankRail } from './word-bank-rail';
import { WordBankSheet } from './word-bank-sheet';
import { WordPopover } from './word-popover';
import { WordSheet } from './word-sheet';
import { useIsMobile } from '../../../../lib/responsive';
import type { ActiveWord, Intensity } from '../_state/read-page-reducer';

type AnnotatedEntry = {
  text: string;
  title: string;
  source: string;
  flaggedWords: FlaggedMap;
};

type Props = {
  entry: AnnotatedEntry;
  bank: string[];
  intensity: Intensity;
  activeWord: ActiveWord | null;
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
  isSaving: boolean;
  onIntensityChange: (intensity: Intensity) => void;
  /**
   * Called when a flagged-word button is clicked. `x` and `y` are already
   * computed relative to the rd-text container so the parent can dispatch
   * them straight into `OPEN_POPOVER`.
   */
  onPopoverOpen: (word: string, x: number, y: number) => void;
  onPopoverClose: () => void;
  onBankToggle: (word: string) => void;
  onClearBank: () => void;
  onSave: () => void;
  onPasteNew: () => void;
};

export function AnnotatedView({
  entry,
  bank,
  intensity,
  activeWord,
  calibration,
  annotateStreaming,
  noAboveLevelWords,
  isSaving,
  onIntensityChange,
  onPopoverOpen,
  onPopoverClose,
  onBankToggle,
  onClearBank,
  onSave,
  onPasteNew,
}: Props) {
  const flaggedKeys = Object.keys(entry.flaggedWords);
  const flaggedCount = flaggedKeys.length;
  const hasFlagged = flaggedCount > 0;
  // While annotation is still streaming, we don't yet know if there will be
  // any above-level words — the iterator could still yield flags. Showing
  // `ZeroFlaggedStrip` ("this passage is well within your level — nice.") at
  // that moment misleads the user before annotation is complete. Reserve the
  // 2-column grid + bank rail during streaming too so the layout doesn't
  // shift when the first flag arrives (NFR Usability — no layout shift on
  // tint).
  const isStreaming = annotateStreaming !== undefined;
  const showRail = hasFlagged || isStreaming;
  const showZeroFlaggedState = !hasFlagged && !isStreaming;

  const bankSet = React.useMemo(() => new Set(bank), [bank]);

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

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // Flagged-word buttons own their open/close transitions.
    if (target.closest('[data-word]')) return;
    // Popover stops propagation already, but defensive against future edits.
    if (target.closest('[data-testid="word-popover"]')) return;
    if (activeWord !== null) onPopoverClose();
  };

  const activeFlag =
    activeWord !== null ? entry.flaggedWords[activeWord.word] : null;

  const handleWordClick = (word: string, rect: DOMRect) => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const x = rect.left - containerRect.left + rect.width / 2;
    const y = rect.bottom - containerRect.top + 6;
    onPopoverOpen(word, x, y);
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
              className="t-small inline-flex min-h-[44px] flex-none items-center gap-[6px] rounded-r-pill border border-rule bg-card px-[14px] font-medium text-ink transition-colors hover:border-ink"
            >
              word bank · {bank.length}
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
            activeWord={activeWord?.word ?? null}
            onWordClick={handleWordClick}
          />
        </div>

        {/* Footer */}
        {hasFlagged ? (
          <AnnotatedFooter
            flaggedCount={flaggedCount}
            savedCount={bank.length}
            onClearBank={onClearBank}
            onSave={onSave}
            isSaving={isSaving}
          />
        ) : showZeroFlaggedState ? (
          <ZeroFlaggedStrip onPasteNew={onPasteNew} />
        ) : null}

        {/* Bottom sheets (portaled) */}
        <WordSheet
          open={activeFlag !== null}
          entry={activeFlag}
          word={activeWord?.word ?? ''}
          inBank={activeWord !== null && bankSet.has(activeWord.word)}
          onSave={() => {
            if (activeWord) onBankToggle(activeWord.word);
          }}
          onSkip={onPopoverClose}
          onClose={onPopoverClose}
        />
        {showRail && (
          <WordBankSheet
            open={bankSheetOpen}
            onClose={() => setBankSheetOpen(false)}
            bank={bank}
            flaggedMap={entry.flaggedWords}
            intensity={intensity}
            onIntensityChange={onIntensityChange}
            onRemove={onBankToggle}
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
            activeWord={activeWord?.word ?? null}
            onWordClick={handleWordClick}
          />
          {activeFlag && activeWord && (
            <WordPopover
              entry={activeFlag}
              word={activeWord.word}
              x={activeWord.x}
              y={activeWord.y}
              containerWidth={containerWidth}
              inBank={bankSet.has(activeWord.word)}
              onSave={() => onBankToggle(activeWord.word)}
              onSkip={onPopoverClose}
              onClose={onPopoverClose}
            />
          )}
        </div>

        {/* Footer */}
        {hasFlagged ? (
          <AnnotatedFooter
            flaggedCount={flaggedCount}
            savedCount={bank.length}
            onClearBank={onClearBank}
            onSave={onSave}
            isSaving={isSaving}
          />
        ) : showZeroFlaggedState ? (
          <ZeroFlaggedStrip onPasteNew={onPasteNew} />
        ) : null}
      </div>

      {showRail && (
        <WordBankRail
          bank={bank}
          flaggedMap={entry.flaggedWords}
          onRemove={onBankToggle}
        />
      )}
    </div>
  );
}
