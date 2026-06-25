'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/cn';
import { NAV_DESTINATIONS } from './nav-items';
import { isActive } from './nav-item';
import { useReviewDueCount } from './use-review-due-count';

// Thumb-reachable primary nav at phone width: a fixed ~64px bar mapping the
// shared NAV_DESTINATIONS to icon + label buttons, anchored above the
// home-indicator safe area. Active state mirrors the desktop rail's NavItem.
export function MobileTabBar() {
  const pathname = usePathname();
  const dueCount = useReviewDueCount();

  return (
    <nav
      aria-label="primary"
      data-testid="mobile-tab-bar"
      className="fixed inset-x-0 bottom-0 z-40 flex min-h-[64px] items-stretch border-t border-rule bg-paper pb-[env(safe-area-inset-bottom)]"
    >
      {NAV_DESTINATIONS.map((d) => {
        const active = isActive(pathname, d.href);
        const showBadge = d.href === '/review' && dueCount > 0;
        return (
          <Link
            key={d.href}
            href={d.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-[44px] flex-1 flex-col items-center justify-center gap-[3px] text-[10px] transition-colors duration-150',
              active ? 'text-ink' : 'text-ink-mute hover:text-ink-soft',
            )}
          >
            <span className="relative flex h-4 w-4 items-center justify-center">
              {d.icon}
              {showBadge ? (
                <span
                  data-testid="review-due-badge"
                  aria-label={`${dueCount} due`}
                  className="absolute -right-2 -top-1.5 min-w-[15px] rounded-full bg-ink px-[4px] text-center text-[9px] leading-[15px] text-paper"
                >
                  {dueCount}
                </span>
              ) : null}
            </span>
            <span>{d.mobileLabel ?? d.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
