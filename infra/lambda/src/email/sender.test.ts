import { describe, it, expect, vi, beforeEach } from 'vitest';

const claimReturning = vi.fn();
const updateReturning = vi.fn();
const historyRows = vi.fn<() => Promise<unknown[]>>(async () => []);
const masteryRows = vi.fn<() => Promise<unknown[]>>(async () => []);

// selectCall is declared outside the factory so beforeEach can reset it.
// This is the vitest adaptation: vi.clearAllMocks() resets mock function state
// but not local closure variables; resetting here ensures each test gets
// selectCall=0 so select() #1 → historyRows, #2 → masteryRows regardless of
// how many selects prior tests issued.
let selectCall = 0;

vi.mock('@language-drill/db', () => {
  const insertChain = {
    values: () => ({ onConflictDoNothing: () => ({ returning: () => claimReturning() }) }),
  };
  const updateChain = { set: () => ({ where: () => ({ returning: () => updateReturning() }) }) };
  const withLimit = (p: Promise<unknown[]>) =>
    Object.assign(p, { limit: () => p });
  const selectChain = (rows: () => Promise<unknown[]>) => ({
    from: () => ({
      innerJoin: () => ({ where: () => rows() }),
      where: () => withLimit(rows()),
    }),
  });
  return {
    createDb: vi.fn(() => ({
      insert: () => insertChain,
      update: () => updateChain,
      select: () => {
        selectCall += 1;
        return selectChain(selectCall === 1 ? historyRows : masteryRows);
      },
    })),
    requireEnv: () => 'x',
    emailPreferences: {}, sentEmails: { userId: 'user_id', kind: 'kind', periodKey: 'period_key' },
    userExerciseHistory: { userId: 'user_id', exerciseId: 'exercise_id', score: 'score', evaluatedAt: 'evaluated_at' },
    userGrammarMastery: { userId: 'user_id', grammarPointKey: 'grammar_point_key', score: 'score' },
    exercises: { id: 'id', grammarPointKey: 'grammar_point_key', language: 'language' },
    getGrammarPoint: vi.fn(() => ({ label: 'Some Point' })),
  };
});

const sendEmailMock = vi.fn(async () => ({ id: 'eml', delivered: true }));
vi.mock('@language-drill/email', () => ({
  sendEmail: sendEmailMock,
  renderEmail: vi.fn(async () => ({ html: '<p>x</p>', text: 'x' })),
  WeeklySummaryEmail: vi.fn(() => null),
}));

function evt() {
  return {
    Records: [
      {
        messageId: 'm1',
        body: JSON.stringify({
          userId: 'u1', email: 'u1@x.com', periodKey: '2026-W25',
          windowStartIso: '2026-06-15T08:00:00Z', windowEndIso: '2026-06-22T08:00:00Z',
        }),
      },
    ],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('weekly-summary sender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCall = 0; // reset the select-call counter so each test gets the right row sets
    historyRows.mockResolvedValue([]);
    masteryRows.mockResolvedValue([]);
  });

  it('skips (status=skipped) and does NOT send when there is no activity', async () => {
    claimReturning.mockResolvedValue([{ id: 1 }]); // claim succeeded
    updateReturning.mockResolvedValue([{ id: 1 }]);
    historyRows.mockResolvedValue([]); // zero activity
    const { handler } = await import('./sender');
    const res = await handler(evt());
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(res.batchItemFailures).toHaveLength(0);
  });

  it('renders and sends when there is activity', async () => {
    claimReturning.mockResolvedValue([{ id: 1 }]);
    updateReturning.mockResolvedValue([{ id: 1 }]);
    historyRows.mockResolvedValue([
      { grammarPointKey: 'es-x', language: 'ES', score: 0.9, evaluatedAt: new Date('2026-06-16T10:00:00Z') },
    ]);
    const { handler } = await import('./sender');
    const res = await handler(evt());
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(res.batchItemFailures).toHaveLength(0);
  });

  it('treats a claim conflict as already-sent and no-ops', async () => {
    claimReturning.mockResolvedValue([]); // ON CONFLICT DO NOTHING returned nothing
    const { handler } = await import('./sender');
    const res = await handler(evt());
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(res.batchItemFailures).toHaveLength(0);
  });

  it('reports the record as a batch failure when sending throws', async () => {
    claimReturning.mockResolvedValue([{ id: 1 }]);
    historyRows.mockResolvedValue([
      { grammarPointKey: 'es-x', language: 'ES', score: 0.9, evaluatedAt: new Date('2026-06-16T10:00:00Z') },
    ]);
    sendEmailMock.mockRejectedValueOnce(new Error('resend down'));
    const { handler } = await import('./sender');
    const res = await handler(evt());
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm1' }]);
  });
});
