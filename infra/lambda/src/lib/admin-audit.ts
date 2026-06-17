import { adminAuditLog, type Db } from '@language-drill/db';

export type AdminAuditAction =
  | 'flagged.approve'
  | 'flagged.reject'
  | 'content.demote'
  | 'content.reject'
  | 'generation.trigger'
  | 'revalidate.apply'
  | 'invite.create'
  | 'invite.revoke';

export type AdminAuditTargetType = 'exercise' | 'theory_topic' | 'cell' | 'invite';

export type AdminAuditEntry = {
  adminUserId: string;
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  targetId: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Append one row to admin_audit_log. Best-effort: a failed audit write logs a
 * warning and resolves — it must never fail an already-succeeded admin action.
 */
export async function recordAdminAction(db: Db, entry: AdminAuditEntry): Promise<void> {
  try {
    await db.insert(adminAuditLog).values({
      adminUserId: entry.adminUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata ?? null,
    });
  } catch (err) {
    console.error('[admin-audit] insert failed (non-fatal)', {
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      err,
    });
  }
}
