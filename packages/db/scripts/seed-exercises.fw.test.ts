import { describe, it, expect } from 'vitest';
import { SEED_EXERCISES } from './seed-exercises';

describe('free_writing seeds', () => {
  const fw = SEED_EXERCISES.filter((e) => e.type === 'free_writing');

  it('includes at least four free_writing prompts', () => {
    expect(fw.length).toBeGreaterThanOrEqual(4);
  });

  it('each carries the full constraint set', () => {
    for (const e of fw) {
      const c = e.contentJson as Record<string, unknown>;
      expect(c.type).toBe('free_writing');
      expect(typeof c.title).toBe('string');
      expect(typeof c.task).toBe('string');
      expect(['informal', 'neutral', 'formal']).toContain(c.register);
      expect(typeof c.minWords).toBe('number');
      expect(typeof c.maxWords).toBe('number');
      expect(Array.isArray(c.requiredElements)).toBe(true);
    }
  });

  it('includes the Spanish B2 remote-work prompt', () => {
    expect(fw.some((e) => e.language === 'ES' && e.difficulty === 'B2')).toBe(true);
  });
});
