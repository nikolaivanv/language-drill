export interface AdminNavDestination {
  href: string;
  label: string;
}

// Single source of truth for the admin left-nav, mirroring the learner
// `NAV_DESTINATIONS` idiom in components/shell/nav-items.tsx. New sections
// (Moderation, Ops, Users — see docs/admin-panel.md) are appended here as
// they're built.
export const ADMIN_NAV: AdminNavDestination[] = [
  { href: '/admin/moderation', label: 'Moderation' },
  { href: '/admin/content', label: 'Content' },
  { href: '/admin/generation', label: 'Pool' },
  { href: '/admin/theory', label: 'Theory' },
  { href: '/admin/invites', label: 'Invites' },
  { href: '/admin/audit', label: 'Audit' },
];
