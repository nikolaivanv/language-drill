import { isProperNounPos } from '@language-drill/ai';
import type { CefrLevel, DeepCard, LearningLanguage } from '@language-drill/shared';
import type { NewGlossCacheRow } from '../schema/gloss-cache';

export type SeedVocabRow = {
  language: LearningLanguage;
  lemma: string;
  gloss: string;
  pos: string;
  cefrBand: CefrLevel | null;
  frequencyRank: number | null;
  card: DeepCard | null;
  addedAt: Date;
};

type Picked = { row: NewGlossCacheRow; preferDeep: boolean; addedAt: Date };

/** Resolve the clean base gloss for one vocab row, or null to skip it. */
function baseGlossOf(r: SeedVocabRow): { value: string; preferDeep: boolean } | null {
  if (r.card && r.card.type === 'word') {
    const bg = r.card.baseGloss;
    if (typeof bg === 'string' && bg.trim() !== '') return { value: bg, preferDeep: true };
    return null; // deep row whose gloss is contextual — never fall back to it
  }
  if (r.card === null && r.gloss.trim() !== '') return { value: r.gloss, preferDeep: false };
  return null;
}

export function deriveSeedRows(rows: SeedVocabRow[]): NewGlossCacheRow[] {
  const best = new Map<string, Picked>();
  for (const r of rows) {
    if (r.pos === 'phrase') continue;
    // Never seed a proper noun — a named entity must not become a skim
    // highlight (Req 2.4). Matches the deep write-through + serve-side guards.
    if (isProperNounPos(r.pos)) continue;
    if (r.cefrBand === null) continue;
    const bg = baseGlossOf(r);
    if (bg === null) continue;

    const key = `${r.language}:${r.lemma}`;
    const candidate: Picked = {
      row: {
        language: r.language,
        lemma: r.lemma,
        baseGloss: bg.value,
        pos: r.pos,
        cefr: r.cefrBand,
        freqRank: r.frequencyRank,
        source: 'seed',
        promptVersion: null,
      },
      preferDeep: bg.preferDeep,
      addedAt: r.addedAt,
    };

    const existing = best.get(key);
    if (
      existing === undefined ||
      (candidate.preferDeep && !existing.preferDeep) ||
      (candidate.preferDeep === existing.preferDeep && candidate.addedAt > existing.addedAt)
    ) {
      best.set(key, candidate);
    }
  }
  return [...best.values()].map((p) => p.row);
}
