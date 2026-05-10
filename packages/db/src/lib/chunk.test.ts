import { describe, expect, it } from 'vitest';

import { chunk } from './chunk';

describe('chunk', () => {
  it('returns an empty array for empty input', () => {
    expect(chunk([], 5)).toEqual([]);
  });

  it('returns singletons when size is 1', () => {
    expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it('returns one batch when size exceeds input length', () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it('returns evenly-sized batches when input is an exact multiple', () => {
    expect(chunk([1, 2, 3, 4, 5, 6], 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('puts the remainder in a final partial batch when input is not an exact multiple', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('handles 25 items with batch size 10 (the SQS-batch case the scheduler hits)', () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const batches = chunk(items, 10);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(10);
    expect(batches[1]).toHaveLength(10);
    expect(batches[2]).toHaveLength(5);
  });

  it('throws when size is 0', () => {
    expect(() => chunk([1, 2, 3], 0)).toThrow(/size must be > 0/);
  });

  it('throws when size is negative', () => {
    expect(() => chunk([1, 2, 3], -1)).toThrow(/size must be > 0/);
  });

  it('preserves element identity (slice, not deep copy)', () => {
    const obj = { x: 1 };
    const out = chunk([obj], 1);
    expect(out[0][0]).toBe(obj);
  });
});
