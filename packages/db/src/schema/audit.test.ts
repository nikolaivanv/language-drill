import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { adminAuditLog } from './index';

describe('admin_audit_log schema', () => {
  it('has the expected columns with correct nullability', () => {
    const cfg = getTableConfig(adminAuditLog);
    expect(cfg.name).toBe('admin_audit_log');
    const byName = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    expect(Object.keys(byName).sort()).toEqual(
      ['action', 'admin_user_id', 'created_at', 'id', 'metadata', 'target_id', 'target_type'].sort(),
    );
    expect(byName['admin_user_id'].notNull).toBe(true);
    expect(byName['action'].notNull).toBe(true);
    expect(byName['target_type'].notNull).toBe(true);
    expect(byName['target_id'].notNull).toBe(false);
    expect(byName['metadata'].notNull).toBe(false);
  });

  it('has no foreign keys (trail survives user deletion)', () => {
    const cfg = getTableConfig(adminAuditLog);
    expect(cfg.foreignKeys).toHaveLength(0);
  });
});
