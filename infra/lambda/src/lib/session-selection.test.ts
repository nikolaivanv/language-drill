import { describe, expect, it } from 'vitest';
import { mergeSessionRows } from './session-selection';

const row = (id: string) => ({ id, n: id });

describe('mergeSessionRows', () => {
  it('returns targeted rows first, then top-up, capped at count', () => {
    const out = mergeSessionRows([row('a'), row('b')], [row('c'), row('d')], 3);
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops top-up rows whose id is already in targeted', () => {
    const out = mergeSessionRows([row('a'), row('b')], [row('b'), row('c')], 5);
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns just targeted when already at/over count', () => {
    const out = mergeSessionRows([row('a'), row('b'), row('c')], [row('d')], 2);
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('handles an empty top-up', () => {
    const out = mergeSessionRows([row('a')], [], 5);
    expect(out.map((r) => r.id)).toEqual(['a']);
  });
});
