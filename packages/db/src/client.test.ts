import { describe, expect, it, vi } from 'vitest';
import { createDb, describeDbError } from './client';

describe('createDb', () => {
  it('survives an idle-client error on the pool instead of crashing the process', () => {
    // No query is issued, so no connection is attempted.
    const db = createDb('postgresql://user:pass@localhost:5432/db');
    const pool = db.$client;
    expect(pool.listenerCount('error')).toBeGreaterThan(0);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // An EventEmitter with no 'error' listener throws here — that throw is
    // what became an uncaught exception in prod.
    expect(() => pool.emit('error', new Error('Connection terminated unexpectedly'))).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Connection terminated unexpectedly'));
    warn.mockRestore();
  });
});

describe('describeDbError', () => {
  it('includes the driver message drizzle hides in .cause', () => {
    const driver = new Error('Connection terminated unexpectedly');
    const wrapped = new Error('Failed query: select 1', { cause: driver });
    expect(describeDbError(wrapped)).toBe(
      'Failed query: select 1 — caused by: Connection terminated unexpectedly',
    );
  });

  it('handles non-Error values and plain errors', () => {
    expect(describeDbError('boom')).toBe('boom');
    expect(describeDbError(new Error('x'))).toBe('x');
  });

  it('stops on a cyclic cause chain', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as Error & { cause?: unknown }).cause = b;
    expect(describeDbError(a).split(' — caused by: ')).toHaveLength(5);
  });
});
