import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqsSend = vi.fn();
// Vitest 4.x requires `new`-able mocks to use function syntax, not arrow fns.
vi.mock('@aws-sdk/client-sqs', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SQSClient: vi.fn(function (this: any) { this.send = sqsSend; }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SendMessageBatchCommand: vi.fn(function (this: any, input: any) { this.input = input; }),
}));

const subscriberRows = vi.fn();
const sentRows = vi.fn();
vi.mock('@language-drill/db', () => {
  return {
    createDb: vi.fn(() => ({
      // We model two sequential awaited selects via mockResolvedValueOnce.
      select: vi.fn(() => ({
        from: () => ({
          innerJoin: () => ({ where: () => subscriberRows() }),
          where: () => sentRows(),
        }),
      })),
    })),
    requireEnv: (k: string) => (k === 'DATABASE_URL' ? 'postgres://x' : 'queue-url'),
    emailPreferences: { userId: 'user_id', weeklySummary: 'weekly_summary' },
    sentEmails: { userId: 'user_id', kind: 'kind', periodKey: 'period_key' },
    users: { id: 'id', email: 'email' },
  };
});

describe('weekly-summary dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_REGION = 'eu-central-1';
    process.env.EMAIL_QUEUE_URL = 'queue-url';
  });

  it('enqueues one message per confirmed user not already sent this period', async () => {
    subscriberRows.mockResolvedValue([
      { userId: 'u1', email: 'u1@x.com' },
      { userId: 'u2', email: 'u2@x.com' },
    ]);
    sentRows.mockResolvedValue([{ userId: 'u1' }]); // u1 already handled
    sqsSend.mockResolvedValue({});
    const { handler } = await import('./dispatcher');
    await handler();
    expect(sqsSend).toHaveBeenCalledOnce();
    const batch = sqsSend.mock.calls[0][0].input.Entries;
    expect(batch).toHaveLength(1);
    expect(JSON.parse(batch[0].MessageBody).userId).toBe('u2');
  });

  it('does not open SQS when there is nothing to send', async () => {
    subscriberRows.mockResolvedValue([{ userId: 'u1', email: 'u1@x.com' }]);
    sentRows.mockResolvedValue([{ userId: 'u1' }]);
    const { handler } = await import('./dispatcher');
    await handler();
    expect(sqsSend).not.toHaveBeenCalled();
  });
});
