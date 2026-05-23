'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/cn';

interface NavItemProps {
  href: string;
  label: string;
  icon: React.ReactNode;
}

// Shared active-route logic: root `/` matches exactly; other destinations also
// match nested routes. Reused by the desktop rail and the mobile tab-bar.
export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavItem({ href, label, icon }: NavItemProps) {
  const pathname = usePathname();
  const active = isActive(pathname, href);

  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-s-3 px-s-3 py-s-2 rounded-r-sm text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(26,22,18,0.08)]',
          active
            ? 'bg-ink text-paper'
            : 'text-ink-soft hover:bg-paper-2 hover:text-ink'
        )}
      >
        <span className="flex-shrink-0 w-4 h-4">{icon}</span>
        <span>{label}</span>
      </Link>
    </li>
  );
}
