import { describe, it, expect } from 'vitest';
import { BrainstormSchema, VocabBoostSchema, StartMyParagraphSchema } from './writing-helper';

describe('writing-helper schemas', () => {
  it('parses a valid brainstorm payload', () => {
    const parsed = BrainstormSchema.parse({ groups: [{ label: 'For', points: ['a', 'b'] }] });
    expect(parsed.groups[0].label).toBe('For');
  });

  it('rejects a brainstorm payload missing groups', () => {
    expect(() => BrainstormSchema.parse({})).toThrow();
  });

  it('parses a valid vocab payload', () => {
    const parsed = VocabBoostSchema.parse({ items: [{ term: 't', gloss: 'g' }] });
    expect(parsed.items[0].term).toBe('t');
  });

  it('rejects a vocab item missing gloss', () => {
    expect(() => VocabBoostSchema.parse({ items: [{ term: 't' }] })).toThrow();
  });

  it('parses a valid start-my-paragraph payload', () => {
    const parsed = StartMyParagraphSchema.parse({ opener: 'Hoy en día...' });
    expect(parsed.opener).toBe('Hoy en día...');
  });

  it('rejects a start-my-paragraph payload missing opener', () => {
    expect(() => StartMyParagraphSchema.parse({})).toThrow();
  });

  it('rejects a non-string opener', () => {
    expect(() => StartMyParagraphSchema.parse({ opener: 42 })).toThrow();
  });
});
