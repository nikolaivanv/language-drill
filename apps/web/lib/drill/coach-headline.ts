export interface SessionError {
  grammarPointKey: string | null;
  errorType: string;
  severity: string;
  text: string;
  correction: string;
}

import type { InsightsErrorTheme } from '@language-drill/api-client';

const MIN_REPEATS = 2;

/** Top within-session repeated error group (≥2), phrased from its most recent slip. */
export function withinSessionHeadline(errors: readonly SessionError[]): string | null {
  if (errors.length === 0) return null;
  const groups = new Map<string, { items: SessionError[]; major: number }>();
  for (const e of errors) {
    const key = e.grammarPointKey ?? e.errorType;
    const g = groups.get(key) ?? { items: [], major: 0 };
    g.items.push(e);
    if (e.severity === 'major') g.major += 1;
    groups.set(key, g);
  }
  let best: { items: SessionError[]; major: number } | null = null;
  for (const g of groups.values()) {
    if (g.items.length < MIN_REPEATS) continue;
    if (
      best === null ||
      g.items.length > best.items.length ||
      (g.items.length === best.items.length && g.major > best.major)
    ) {
      best = g;
    }
  }
  if (best === null) return null;
  const last = best.items[best.items.length - 1];
  return `watch · ${last.text} → ${last.correction} · slipped ${best.items.length}× this session`;
}

/** Top cross-session theme (count ≥2). `themes` are assumed ranked (the endpoint sorts them). */
export function crossSessionHeadline(themes: readonly InsightsErrorTheme[]): string | null {
  const top = themes.find((t) => t.count >= MIN_REPEATS);
  if (!top) return null;
  const pair = `${top.sample.wrongText} → ${top.sample.correction}`;
  return top.grammarPointName
    ? `lately · ${top.grammarPointName}: ${pair} (${top.count}×)`
    : `lately · ${pair} (${top.count}×)`;
}

/** Within-session pattern first, else the top cross-session theme, else null. */
export function coachHeadline(args: {
  sessionErrors: readonly SessionError[];
  themes: readonly InsightsErrorTheme[];
}): string | null {
  return withinSessionHeadline(args.sessionErrors) ?? crossSessionHeadline(args.themes);
}
