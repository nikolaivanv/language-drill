'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/cn';

interface NavItemProps {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Optional count pill (e.g. the Review due badge); hidden when 0. */
  badge?: number;
}

// Shared active-route logic: root `/` matches exactly; other destinations also
// match nested routes. Reused by the desktop rail and the mobile tab-bar.
export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavItem({ href, label, icon, badge }: NavItemProps) {
  const pathname = usePathname();
  const active = isActive(pathname, href);
  const showBadge = typeof badge === 'number' && badge > 0;

  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-s-3 px-s-3 py-s-2 rounded-sm text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--ring-app)]',
          active
            ? 'bg-ink text-paper'
            : 'text-ink-soft hover:bg-paper-2 hover:text-ink'
        )}
      >
        <span className="flex-shrink-0 w-4 h-4">{icon}</span>
        <span>{label}</span>
        {showBadge ? (
          <span
            data-testid="review-due-badge"
            aria-label={`${badge} due`}
            className={cn(
              'ml-auto min-w-[18px] rounded-full px-[6px] py-px text-center text-[11px] leading-[16px]',
              active ? 'bg-paper text-ink' : 'bg-ink text-paper'
            )}
          >
            {badge}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
