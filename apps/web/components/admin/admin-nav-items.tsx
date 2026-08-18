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
  { href: '/admin/flags', label: 'User flags' },
  { href: '/admin/content', label: 'Content' },
  { href: '/admin/pool', label: 'Pool' },
  { href: '/admin/invites', label: 'Invites' },
  { href: '/admin/audit', label: 'Audit' },
  { href: '/admin/capacity', label: 'Usage & cost' },
  { href: '/admin/activity', label: 'Activity' },
  { href: '/admin/curriculum', label: 'Curriculum' },
];
