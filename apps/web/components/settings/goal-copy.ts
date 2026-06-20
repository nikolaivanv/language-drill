import type { GoalId } from '@language-drill/shared';

// Verbatim from R4.1. Emoji characters match the requirements doc byte-for-
// byte (note: 🗣 and ✍️ are presentation forms with no VS-16 selector — keep
// these exact codepoints if you reformat this file).
export const GOAL_COPY: Record<
  GoalId,
  { emoji: string; label: string; description: string }
> = {
  grammar: {
    emoji: '📝',
    label: 'grammar',
    description: 'subjunctive, tenses, conjugation',
  },
  speaking: {
    emoji: '🗣',
    label: 'speaking fluency',
    description: 'real conversations, less hesitation',
  },
  listening: {
    emoji: '🎧',
    label: 'understanding fast speech',
    description: 'podcasts, native speakers, films',
  },
  writing: {
    emoji: '✍️',
    label: 'writing',
    description: 'emails, essays, longer texts',
  },
  vocab: {
    emoji: '📚',
    label: 'vocabulary',
    description: 'expanding active range',
  },
  travel: {
    emoji: '🎯',
    label: 'prep for a trip / convo',
    description: 'specific upcoming need',
  },
};
