// Templated coach narrative for the post-session debrief screen. No Claude
// call — copy is keyed by accuracy tier (high / mid / low) plus the
// `attemptedCount === 0` fallback. Each tier emits 1–2 short lowercase
// paragraphs and a what's-next link target.
//
// What's-next routing (Req 4.4):
//   high → /progress (review what moved)
//   else → /drill (try another session)

import { LANGUAGE_NAMES, type Language } from '@language-drill/shared';
import type { AccuracyTier } from './accuracy-tier';

export interface Narrative {
  paragraphs: [string] | [string, string];
  whatsNextHref: '/drill' | '/progress';
  whatsNextLabel: string;
}

export interface NarrativeInput {
  tier: AccuracyTier;
  language: Language;
  exerciseCount: number;
  correctCount: number;
  attemptedCount: number;
  skippedCount: number;
}

export function debriefNarrative(input: NarrativeInput): Narrative {
  const { tier, language, exerciseCount, correctCount, attemptedCount } = input;
  const lang = LANGUAGE_NAMES[language].toLowerCase();

  // What's-next link is purely tier-driven (Req 4.4).
  const whatsNext: Pick<Narrative, 'whatsNextHref' | 'whatsNextLabel'> =
    tier === 'high'
      ? { whatsNextHref: '/progress', whatsNextLabel: 'see what moved →' }
      : { whatsNextHref: '/drill', whatsNextLabel: 'another short session →' };

  // Special case: zero attempts (e.g., session ended early via rate-limit).
  // Falls into the low tier per accuracy-tier.ts but needs different copy
  // because "0 of 0 stuck" doesn't read well.
  if (attemptedCount === 0) {
    return {
      paragraphs: [
        `no items attempted in this ${lang} round of ${exerciseCount}.`,
        'ready when you are — try a fresh session.',
      ],
      ...whatsNext,
    };
  }

  const stuck = `${correctCount} of ${attemptedCount} stuck`;

  switch (tier) {
    case 'high':
      return {
        paragraphs: [
          `solid ${lang} run — ${stuck}.`,
          'that pattern is landing — see what moved on the progress page.',
        ],
        ...whatsNext,
      };
    case 'mid':
      return {
        paragraphs: [
          `mixed ${lang} round — ${stuck}.`,
          'another short session and the shape tightens.',
        ],
        ...whatsNext,
      };
    case 'low':
      return {
        paragraphs: [
          `tougher ${lang} round — ${stuck}.`,
          'one more short session usually clears it.',
        ],
        ...whatsNext,
      };
    default: {
      const _exhaustive: never = tier;
      throw new Error(`unknown AccuracyTier: ${String(_exhaustive)}`);
    }
  }
}
