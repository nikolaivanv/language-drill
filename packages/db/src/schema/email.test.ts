import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { emailPreferences, sentEmails } from './email';

describe('email schema', () => {
  it('email_preferences has the expected columns', () => {
    const cfg = getTableConfig(emailPreferences);
    expect(cfg.name).toBe('email_preferences');
    const cols = cfg.columns.map((c) => c.name).sort();
    expect(cols).toEqual(
      [
        'user_id',
        'weekly_summary',
        'unsubscribe_token',
        'confirm_token',
        'confirm_sent_at',
        'confirmed_at',
        'created_at',
        'updated_at',
      ].sort(),
    );
  });

  it('sent_emails enforces a (user_id, kind, period_key) unique constraint', () => {
    const cfg = getTableConfig(sentEmails);
    expect(cfg.name).toBe('sent_emails');
    const uniqueCols = cfg.uniqueConstraints.flatMap((u) =>
      u.columns.map((c) => c.name),
    );
    expect(uniqueCols).toEqual(
      expect.arrayContaining(['user_id', 'kind', 'period_key']),
    );
  });
});
