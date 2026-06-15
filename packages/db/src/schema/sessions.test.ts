import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { practiceSessions } from './index';

describe('sessions schema', () => {
  // Right-to-erasure: deleting a user must sweep their practice sessions. This
  // FK predated the cascade convention and was missed by migration 0021's
  // backfill, which silently broke the user.deleted webhook for any user who
  // had ever started a drill (NO ACTION → FK violation on DELETE FROM users).
  it('cascades practiceSessions.userId on user deletion', () => {
    const cfg = getTableConfig(practiceSessions);
    const fk = cfg.foreignKeys.find((f) =>
      f.reference().columns.some((c) => c.name === 'user_id'),
    );
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('cascade');
  });
});
