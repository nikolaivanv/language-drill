'use client';

import type { LanguageProfile } from '@language-drill/shared';
import { useIsMobile } from '../../lib/responsive';
import { Nav } from './nav';
import { MobileTopBar } from './mobile-top-bar';
import { MobileTabBar } from './mobile-tab-bar';
import { AppFooter } from './app-footer';

interface AppShellProps {
  profiles: LanguageProfile[];
  children: React.ReactNode;
}

export function AppShell({ profiles, children }: AppShellProps) {
  const isMobile = useIsMobile();

  // Mobile: top app-bar + scrollable content + bottom tab-bar. `useIsMobile`
  // is false on the server and first client render, so the desktop tree below
  // is always the SSR/hydration output — this branch mounts after reconcile.
  if (isMobile) {
    return (
      <div className="flex min-h-screen flex-col bg-paper">
        <MobileTopBar profiles={profiles} />
        <main className="min-w-0 flex-1 bg-paper px-[22px] pt-[18px] pb-[calc(64px+env(safe-area-inset-bottom)+18px)]">
          {children}
          <AppFooter />
        </main>
        <MobileTabBar />
      </div>
    );
  }

  // `overflow-hidden` clamps the shell to the viewport so nothing escapes into a
  // document-level scroll. The two columns each own their scroll: the Nav scrolls
  // internally when its content is taller than a short window (otherwise it would
  // overflow the fixed-height shell and the whole page would scroll past its
  // bottom edge), and `main` is the primary scroll region.
  //
  // `relative` on `main` makes it the containing block for absolutely-positioned
  // descendants (e.g. the `sr-only` plan summary in TodayTimeline). Without it,
  // such an element resolves its containing block to <body> and its static
  // position deep in the content extends the document height — reintroducing the
  // page-level scroll past the bottom edge. Scoping it to `main` keeps it inside
  // the internal scroll region instead.
  return (
    <div className="flex h-screen overflow-hidden bg-paper">
      <Nav profiles={profiles} />
      <main className="relative flex-1 min-w-0 min-h-0 overflow-y-auto bg-paper">
        {/* Flex column with the content area growing (`flex-1`) pins the footer
            to the bottom of the viewport on short pages — so its rule lines up
            with the Nav's bottom-pinned user-footer rule instead of floating up
            after the content. `pb-[22px]` matches the Nav's bottom padding so
            both footer dividers sit at the same offset from the bottom. */}
        <div className="max-w-max-content mx-auto flex min-h-full w-full flex-col px-[48px] pt-[36px] pb-[22px]">
          <div className="flex-1">{children}</div>
          <AppFooter />
        </div>
      </main>
    </div>
  );
}
