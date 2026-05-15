/**
 * Tests for cleanup-zombie-jobs.ts. The CLI-parser tests run unconditionally
 * (pure functions, no DB). The integration tests are gated on
 * TEST_DATABASE_URL — they seed three rows (old-running, fresh-running,
 * succeeded-old) and assert findZombieJobs picks only the old-running one,
 * and deleteZombieJobs removes exactly that one.
 */

import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type Db } from '../src/client';
import { generationJobs } from '../src/schema/index';
import {
  deleteZombieJobs,
  findZombieJobs,
  parseCleanupArgs,
} from './cleanup-zombie-jobs';

describe('parseCleanupArgs', () => {
  it('defaults to dry-run with sensible window + limit', () => {
    expect(parseCleanupArgs([])).toEqual({
      apply: false,
      maxAgeMinutes: 15,
      limit: 50,
    });
  });

  it('parses --apply', () => {
    expect(parseCleanupArgs(['--apply'])).toEqual({
      apply: true,
      maxAgeMinutes: 15,
      limit: 50,
    });
  });

  it('--dry-run wins over a prior --apply', () => {
    expect(parseCleanupArgs(['--apply', '--dry-run'])).toEqual({
      apply: false,
      maxAgeMinutes: 15,
      limit: 50,
    });
  });

  it('parses --max-age-minutes <n>', () => {
    expect(parseCleanupArgs(['--max-age-minutes', '30'])).toEqual({
      apply: false,
      maxAgeMinutes: 30,
      limit: 50,
    });
  });

  it('parses --limit <n>', () => {
    expect(parseCleanupArgs(['--limit', '10'])).toEqual({
      apply: false,
      maxAgeMinutes: 15,
      limit: 10,
    });
  });

  it('rejects --max-age-minutes <= 0', () => {
    expect(() => parseCleanupArgs(['--max-age-minutes', '0'])).toThrow(
      /positive number/,
    );
    expect(() => parseCleanupArgs(['--max-age-minutes', '-5'])).toThrow(
      /positive number/,
    );
  });

  it('rejects --limit that is not a positive integer', () => {
    expect(() => parseCleanupArgs(['--limit', '0'])).toThrow(
      /positive integer/,
    );
    expect(() => parseCleanupArgs(['--limit', '1.5'])).toThrow(
      /positive integer/,
    );
  });

  it('rejects unrecognized arguments', () => {
    expect(() => parseCleanupArgs(['--unknown'])).toThrow(/Unrecognized/);
  });
});

const TEST_CELL_PREFIX = 'cleanup-zombie-test:';

describe.skipIf(!process.env['TEST_DATABASE_URL'])(
  'cleanup-zombie-jobs integration',
  () => {
    let db: Db;
    let seededIds: string[] = [];

    beforeAll(() => {
      db = createDb(process.env['TEST_DATABASE_URL']!);
    });

    beforeEach(() => {
      seededIds = [];
    });

    afterEach(async () => {
      if (seededIds.length > 0) {
        await db
          .delete(generationJobs)
          .where(inArray(generationJobs.id, seededIds));
      }
    });

    async function seed(
      status: 'running' | 'succeeded' | 'failed',
      startedAtIso: string,
      cellSuffix: string,
    ): Promise<string> {
      const id = randomUUID();
      await db.insert(generationJobs).values({
        id,
        cellKey: `${TEST_CELL_PREFIX}${cellSuffix}`,
        requestedCount: 5,
        status,
        startedAt: new Date(startedAtIso),
        trigger: 'cli',
      });
      seededIds.push(id);
      return id;
    }

    it('findZombieJobs returns only old running rows', async () => {
      const oldRunning = await seed(
        'running',
        new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        'old-running',
      );
      const freshRunning = await seed(
        'running',
        new Date(Date.now() - 60 * 1000).toISOString(),
        'fresh-running',
      );
      const oldSucceeded = await seed(
        'succeeded',
        new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        'old-succeeded',
      );

      const zombies = await findZombieJobs(db, {
        maxAgeMinutes: 15,
        limit: 50,
      });
      const zombieIds = zombies.map((z) => z.id);

      expect(zombieIds).toContain(oldRunning);
      expect(zombieIds).not.toContain(freshRunning);
      expect(zombieIds).not.toContain(oldSucceeded);
    });

    it('--max-age-minutes widens / narrows the window', async () => {
      const tenMinutesAgo = await seed(
        'running',
        new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        'ten-min',
      );

      const wide = await findZombieJobs(db, { maxAgeMinutes: 5, limit: 50 });
      expect(wide.map((z) => z.id)).toContain(tenMinutesAgo);

      const narrow = await findZombieJobs(db, {
        maxAgeMinutes: 30,
        limit: 50,
      });
      expect(narrow.map((z) => z.id)).not.toContain(tenMinutesAgo);
    });

    it('--limit caps the result count', async () => {
      const ids = await Promise.all([
        seed(
          'running',
          new Date(Date.now() - 60 * 60 * 1000 - 1000).toISOString(),
          'a',
        ),
        seed(
          'running',
          new Date(Date.now() - 60 * 60 * 1000 - 2000).toISOString(),
          'b',
        ),
        seed(
          'running',
          new Date(Date.now() - 60 * 60 * 1000 - 3000).toISOString(),
          'c',
        ),
      ]);

      const capped = await findZombieJobs(db, {
        maxAgeMinutes: 15,
        limit: 2,
      });
      const cappedIds = capped.map((z) => z.id);
      // We don't know exactly which 2 the DB returned (there may be other
      // unrelated zombies in the test DB), but our 3 seeded IDs should not
      // ALL be present.
      const seededInResult = ids.filter((id) => cappedIds.includes(id));
      expect(seededInResult.length).toBeLessThanOrEqual(2);
      expect(capped.length).toBeLessThanOrEqual(2);
    });

    it('deleteZombieJobs deletes only the requested ids that are still running', async () => {
      const oldRunning = await seed(
        'running',
        new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        'delete-target',
      );
      const oldSucceeded = await seed(
        'succeeded',
        new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        'delete-skip',
      );

      const deleted = await deleteZombieJobs(db, [oldRunning, oldSucceeded]);
      expect(deleted.map((r) => r.id)).toEqual([oldRunning]);

      const remaining = await db
        .select({ id: generationJobs.id })
        .from(generationJobs)
        .where(eq(generationJobs.id, oldSucceeded));
      expect(remaining).toHaveLength(1);
    });

    it('deleteZombieJobs([]) returns [] without hitting the DB', async () => {
      expect(await deleteZombieJobs(db, [])).toEqual([]);
    });
  },
);
