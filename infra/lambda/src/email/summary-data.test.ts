import { describe, it, expect } from 'vitest';
import { buildWeeklySummaryData } from './summary-data';

const labelFor = (k: string) => ({ 'es-ser-estar': 'Ser vs estar', 'es-subj': 'Subjunctive mood', 'tr-past': 'Past tense' }[k] ?? k);
const languageNameFor = (c: string) => ({ ES: 'Spanish', TR: 'Turkish' }[c] ?? c);

describe('buildWeeklySummaryData', () => {
  it('flags no activity when there are no history rows', () => {
    const data = buildWeeklySummaryData({
      historyRows: [],
      masteryRows: [{ grammarPointKey: 'es-subj', score: 0.2 }],
      labelFor,
      languageNameFor,
    });
    expect(data.hasActivity).toBe(false);
    expect(data.exercisesCompleted).toBe(0);
  });

  it('counts exercises, distinct languages and active days', () => {
    const data = buildWeeklySummaryData({
      historyRows: [
        { grammarPointKey: 'es-ser-estar', language: 'ES', score: 0.9, evaluatedAt: new Date('2026-06-16T10:00:00Z') },
        { grammarPointKey: 'es-ser-estar', language: 'ES', score: 0.8, evaluatedAt: new Date('2026-06-16T18:00:00Z') },
        { grammarPointKey: 'tr-past', language: 'TR', score: 0.3, evaluatedAt: new Date('2026-06-17T09:00:00Z') },
      ],
      masteryRows: [],
      labelFor,
      languageNameFor,
    });
    expect(data.hasActivity).toBe(true);
    expect(data.exercisesCompleted).toBe(3);
    expect(data.languagesPracticed).toEqual(['Spanish', 'Turkish']);
    expect(data.daysActive).toBe(2); // 06-16 and 06-17
  });

  it('picks movers as top-scoring practiced points and focus as lowest-mastery points', () => {
    const data = buildWeeklySummaryData({
      historyRows: [
        { grammarPointKey: 'es-ser-estar', language: 'ES', score: 0.95, evaluatedAt: new Date('2026-06-16T10:00:00Z') },
      ],
      masteryRows: [
        { grammarPointKey: 'es-subj', score: 0.15 },
        { grammarPointKey: 'tr-past', score: 0.35 },
      ],
      labelFor,
      languageNameFor,
    });
    expect(data.movers).toContain('Ser vs estar');
    expect(data.focus[0]).toBe('Subjunctive mood'); // lowest mastery first
  });
});
