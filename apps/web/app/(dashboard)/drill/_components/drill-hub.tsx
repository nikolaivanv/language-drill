'use client';

// ---------------------------------------------------------------------------
// DrillHub — the /drill landing menu (Drill Menu redesign)
// ---------------------------------------------------------------------------
// Shown when /drill is opened with no `?start=` intent: the page title, a thin
// "today's quick drill" status strip, then the drill-type cards (quick drill is
// the featured dark "today's drill" card), then the "work on these" weak-spot
// list. The difficulty / CEFR level is set inside the running session
// (DrillMeta), not on this menu. Presentational: the page owns the start intent
// and passes the launch callbacks.
// ---------------------------------------------------------------------------

import Link from 'next/link';
import type { InsightsErrorTheme } from '@language-drill/api-client';
import { cn } from '../../../../lib/cn';
import { DrillTodayStatus } from './drill-today-status';
import { WorkOnThese } from '../../_components/work-on-these';

type Props = {
  onStartQuick: () => void;
  onStartDictation: () => void;
  themes: InsightsErrorTheme[];
  onStartTargeted: (grammarPointKey: string) => void;
};

// Card frame + lift-on-hover (and active: for touch). Border/fill split out per
// variant so the featured (ink) card and the normal (paper) cards don't fight
// over a shared hover:border rule.
const CARD_BASE =
  'group flex items-center justify-between gap-s-7 rounded-lg border p-s-6 text-left no-underline shadow-1 transition-all hover:-translate-y-px hover:shadow-2 active:shadow-2 mobile:gap-s-4 mobile:p-s-5';
const CARD_NORMAL =
  'border-rule bg-card hover:border-rule-strong hover:bg-paper active:border-rule-strong active:bg-paper';
// Light: an ink (near-black) hero. Dark: the token flip would make it a large
// cream block, on which the yellow tag + peach "start" lose contrast — so in
// dark the featured card goes terracotta (the accent), keeping white text and
// the yellow tag legible (matches the design prototype's hero treatment).
const CARD_FEAT =
  'border-ink bg-ink hover:border-rule-strong active:border-rule-strong dark:border-accent dark:bg-accent dark:hover:border-accent dark:hover:bg-[#b15535] dark:active:border-accent dark:active:bg-[#b15535]';

// Display title via utilities (not .t-display-m) so the featured card can use
// text-paper — the .t-display-* classes hard-set their colour and win over
// utilities (they're unlayered).
const CARD_TITLE =
  'block font-display text-[28px] font-medium leading-[1.2] tracking-[-0.4px] mobile:text-[22px]';

function CardBody({
  featured = false,
  tag,
  title,
  sub,
}: {
  featured?: boolean;
  tag?: string;
  title: string;
  sub: string;
}) {
  return (
    <>
      <span className="min-w-0">
        {tag && (
          <span className="mb-s-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-hilite">
            {tag}
          </span>
        )}
        <span
          className={cn(
            CARD_TITLE,
            // Featured: white on the ink (light) / terracotta (dark) hero. The
            // token `text-paper` would flip to dark in dark mode, so pin white.
            featured ? 'text-paper dark:text-white' : 'text-ink',
          )}
        >
          {title}
        </span>
        <span
          className={cn(
            'mt-s-1 block text-[17px] leading-[1.45]',
            // On the ink card, --rule-strong reads as the muted body tone; on
            // the terracotta dark hero, a translucent white reads as muted.
            featured ? 'text-rule-strong dark:text-white/80' : 'text-ink-soft',
          )}
        >
          {sub}
        </span>
      </span>
      <span
        className={cn(
          't-mono flex-shrink-0 text-[20px] transition-colors mobile:text-[16px]',
          // Rest: light terracotta on the dark card, --accent-2 on normal cards.
          // Hover: normal cards brighten to the full --accent; the featured card
          // is itself terracotta in dark, so its arrow stays a pale peach.
          'group-hover:text-accent',
          featured
            ? 'text-[#f0a98c] dark:text-[#ffe2d6] dark:group-hover:text-white'
            : 'text-accent-2',
        )}
      >
        start →
      </span>
    </>
  );
}

export function DrillHub({
  onStartQuick,
  onStartDictation,
  themes,
  onStartTargeted,
}: Props) {
  return (
    <div className="p-s-6">
      <h1 className="t-display-xl">drill</h1>

      <div className="mt-s-6">
        <DrillTodayStatus />
      </div>

      {/* Drill-type cards */}
      <div className="mt-s-7 flex flex-col gap-s-4 mobile:mt-s-6">
        <button
          type="button"
          onClick={onStartQuick}
          className={cn(CARD_BASE, CARD_FEAT)}
        >
          <CardBody
            featured
            tag="today's drill"
            title="quick drill"
            sub="a 5-item mix — cloze, sentence building, translation, vocab."
          />
        </button>

        <button
          type="button"
          onClick={onStartDictation}
          className={cn(CARD_BASE, CARD_NORMAL)}
        >
          <CardBody
            title="dictation"
            sub="listen and transcribe — a short audio-only run."
          />
        </button>

        <Link href="/drill/free-writing" className={cn(CARD_BASE, CARD_NORMAL)}>
          <CardBody
            title="free writing"
            sub="write a paragraph to a prompt, then get IELTS-style feedback."
          />
        </Link>

        <Link href="/drill/conjugation" className={cn(CARD_BASE, CARD_NORMAL)}>
          <CardBody
            title="conjugation"
            sub="drill verb forms one at a time — a quick conjugation warm-up."
          />
        </Link>

        <Link href="/fluency" className={cn(CARD_BASE, CARD_NORMAL)}>
          <CardBody
            title="fluency"
            sub="timed drills on what you already know."
          />
        </Link>
      </div>

      {/* Work on these */}
      {themes.length > 0 && (
        <div className="mt-s-8 mobile:mt-s-7">
          <WorkOnThese themes={themes} onSelect={onStartTargeted} />
          <Link
            href="/progress"
            className="t-mono mt-s-3 inline-block text-[13px] text-ink-soft hover:text-ink"
          >
            see your full map <span className="lk-arr" aria-hidden="true">→</span>
          </Link>
        </div>
      )}
    </div>
  );
}
