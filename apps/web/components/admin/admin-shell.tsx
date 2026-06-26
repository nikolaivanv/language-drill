import Link from 'next/link';
import { AdminNav } from './admin-nav';
import { UserFooter } from '../shell/user-footer';

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-paper">
      <nav
        aria-label="admin"
        data-testid="admin-rail"
        className="w-[220px] flex-shrink-0 flex flex-col gap-1 border-r border-rule bg-paper px-s-4 py-[22px]"
      >
        <Link
          href="/admin"
          className="px-s-2 pb-[18px] font-display text-[20px] font-semibold tracking-[-0.4px] text-ink focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--ring-app)] rounded-sm"
        >
          Admin
        </Link>
        <AdminNav />
        {/* Escape hatch back to the learner-facing app, mirroring the rail's
            nav-item styling. Sits above the account menu (which UserFooter
            pins to the bottom via mt-auto). */}
        <Link
          href="/home"
          className="flex items-center gap-s-2 px-s-3 py-s-2 rounded-sm text-[13px] text-ink-soft hover:bg-paper-2 hover:text-ink transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--ring-app)]"
        >
          Open app
          <span aria-hidden="true">↗</span>
        </Link>
        {/* Shared account menu — carries the Light/Dark/System appearance
            selector (ThemeToggle), settings, and sign-out. */}
        <UserFooter />
      </nav>
      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-paper">
        <div className="max-w-max-content mx-auto w-full py-[36px] px-[48px]">
          {children}
        </div>
      </main>
    </div>
  );
}
