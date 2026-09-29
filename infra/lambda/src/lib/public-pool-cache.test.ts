import { describe, it, expect, vi } from 'vitest';
import {
  createPoolCache,
  shuffled,
  PUBLIC_POOL_TTL_MS,
  PUBLIC_POOL_NEGATIVE_TTL_MS,
} from './public-pool-cache';

describe('createPoolCache', () => {
  it('loads once and serves the cached rows within the TTL', async () => {
    let clock = 1_000;
    const load = vi.fn(async () => [{ id: 'a' }]);
    const cache = createPoolCache<{ id: string }>({ now: () => clock });

    expect(await cache.get('ES|B1', load)).toEqual([{ id: 'a' }]);
    clock += PUBLIC_POOL_TTL_MS - 1;
    expect(await cache.get('ES|B1', load)).toEqual([{ id: 'a' }]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads once the TTL has elapsed', async () => {
    let clock = 1_000;
    const load = vi.fn(async () => [{ id: 'a' }]);
    const cache = createPoolCache<{ id: string }>({ now: () => clock });

    await cache.get('ES|B1', load);
    clock += PUBLIC_POOL_TTL_MS;
    await cache.get('ES|B1', load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keys distinct pools separately', async () => {
    const cache = createPoolCache<{ id: string }>({ now: () => 0 });
    const es = vi.fn(async () => [{ id: 'es' }]);
    const de = vi.fn(async () => [{ id: 'de' }]);

    expect(await cache.get('ES|B1', es)).toEqual([{ id: 'es' }]);
    expect(await cache.get('DE|B1', de)).toEqual([{ id: 'de' }]);
    expect(cache.size()).toBe(2);
  });
});

describe('createPoolCache negative caching', () => {
  it('re-throws a load failure to the caller', async () => {
    const cache = createPoolCache<{ id: string }>({ now: () => 0 });
    const load = vi.fn(async () => {
      throw new Error('db down');
    });

    await expect(cache.get('ES|B1', load)).rejects.toThrow('db down');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not re-query on a repeat call within the negative TTL', async () => {
    let clock = 1_000;
    const cache = createPoolCache<{ id: string }>({ now: () => clock });
    const load = vi.fn(async () => {
      throw new Error('db down');
    });

    await expect(cache.get('ES|B1', load)).rejects.toThrow('db down');
    clock += PUBLIC_POOL_NEGATIVE_TTL_MS - 1;
    await expect(cache.get('ES|B1', load)).rejects.toThrow('db down');

    // The second call served the cached failure rather than calling load again.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('re-queries once the negative TTL has elapsed', async () => {
    let clock = 1_000;
    const cache = createPoolCache<{ id: string }>({ now: () => clock });
    const load = vi.fn(async () => {
      throw new Error('db down');
    });

    await expect(cache.get('ES|B1', load)).rejects.toThrow('db down');
    clock += PUBLIC_POOL_NEGATIVE_TTL_MS;
    await expect(cache.get('ES|B1', load)).rejects.toThrow('db down');

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('recovers into a normal cache entry once the database heals', async () => {
    let clock = 1_000;
    const cache = createPoolCache<{ id: string }>({ now: () => clock });
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([{ id: 'a' }]);

    await expect(cache.get('ES|B1', load)).rejects.toThrow('db down');
    clock += PUBLIC_POOL_NEGATIVE_TTL_MS;
    expect(await cache.get('ES|B1', load)).toEqual([{ id: 'a' }]);

    // The recovered result is now served from the (positive) cache, not
    // treated as a fresh error.
    expect(await cache.get('ES|B1', load)).toEqual([{ id: 'a' }]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a negative entry does not clobber an unrelated key positive cache', async () => {
    const cache = createPoolCache<{ id: string }>({ now: () => 0 });
    const good = vi.fn(async () => [{ id: 'es' }]);
    const bad = vi.fn(async () => {
      throw new Error('db down');
    });

    expect(await cache.get('ES|B1', good)).toEqual([{ id: 'es' }]);
    await expect(cache.get('DE|B1', bad)).rejects.toThrow('db down');
    expect(await cache.get('ES|B1', good)).toEqual([{ id: 'es' }]);
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe('shuffled', () => {
  // The cached array is shared across concurrent requests, so an in-place
  // shuffle would reorder rows another request is mid-iteration over.
  it('returns a new array and leaves the input untouched', () => {
    const input = Object.freeze([1, 2, 3, 4]) as readonly number[];
    const out = shuffled(input, () => 0);
    expect(out).not.toBe(input);
    expect(input).toEqual([1, 2, 3, 4]);
    expect([...out].sort()).toEqual([1, 2, 3, 4]);
  });

  it('permutes deterministically for a given rng', () => {
    const rows = [1, 2, 3, 4, 5];
    const rng = () => 0.999999;
    expect(shuffled(rows, rng)).toEqual(shuffled(rows, rng));
  });
});
