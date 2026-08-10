import { describe, expect, it, vi, beforeEach } from 'vitest';

const runMock = vi.fn();
vi.mock('@language-drill/db', () => ({
  createDb: () => ({}),
  requireEnv: (k: string) => (k === 'DATABASE_URL' ? 'postgres://stub' : ''),
  run: (...args: unknown[]) => runMock(...args),
  summarize: () => 'summary',
  formatDiffReport: () => 'diff',
}));

beforeEach(() => {
  runMock.mockReset();
  delete process.env['MASTERY_REBUILD_MAX_DELETES'];
  vi.resetModules();
});

describe('mastery rebuild handler', () => {
  it('applies with the default delete threshold of 5', async () => {
    runMock.mockResolvedValue({ upserts: 1, deletes: 0, groupCount: 1, historyRowCount: 1, aborted: false, diff: { shifts: [], existingKeys: new Set(), deleted: [] } });
    const { handler } = await import('./rebuild-handler');
    await handler();
    expect(runMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apply: true, includeDemoted: false, maxDeletes: 5 }));
  });

  it('honours MASTERY_REBUILD_MAX_DELETES', async () => {
    process.env['MASTERY_REBUILD_MAX_DELETES'] = '12';
    runMock.mockResolvedValue({ upserts: 0, deletes: 0, groupCount: 0, historyRowCount: 0, aborted: false, diff: { shifts: [], existingKeys: new Set(), deleted: [] } });
    const { handler } = await import('./rebuild-handler');
    await handler();
    expect(runMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxDeletes: 12 }));
  });

  it('throws when the run aborted, so the Lambda Errors metric alarms', async () => {
    runMock.mockResolvedValue({ upserts: 0, deletes: 9, groupCount: 1, historyRowCount: 1, aborted: true, diff: { shifts: [], existingKeys: new Set(), deleted: [{ userId: 'u1', language: 'TR', grammarPointKey: 'p' }] } });
    const { handler } = await import('./rebuild-handler');
    await expect(handler()).rejects.toThrow(/aborted/i);
  });

  it('falls back to the default threshold when MASTERY_REBUILD_MAX_DELETES is unparseable', async () => {
    process.env['MASTERY_REBUILD_MAX_DELETES'] = 'not-a-number';
    runMock.mockResolvedValue({ upserts: 0, deletes: 0, groupCount: 0, historyRowCount: 0, aborted: false, diff: { shifts: [], existingKeys: new Set(), deleted: [] } });
    const { handler } = await import('./rebuild-handler');
    await handler();
    expect(runMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxDeletes: 5 }));
  });
});
