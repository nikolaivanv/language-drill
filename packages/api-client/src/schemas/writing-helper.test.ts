import { describe, it, expect } from 'vitest';
import { BrainstormSchema, VocabBoostSchema } from './writing-helper';

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
});
