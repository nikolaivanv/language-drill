'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/cn';
import { isActive } from '../shell/nav-item';
import { ADMIN_NAV } from './admin-nav-items';

export function AdminNav() {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1 list-none p-0 m-0">
      {ADMIN_NAV.map((d) => {
        const active = isActive(pathname, d.href);
        return (
          <li key={d.href}>
            <Link
              href={d.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center px-s-3 py-s-2 rounded-sm text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--ring-app)]',
                active
                  ? 'bg-ink text-paper'
                  : 'text-ink-soft hover:bg-paper-2 hover:text-ink',
              )}
            >
              {d.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
