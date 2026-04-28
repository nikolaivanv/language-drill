'use client';

import type { LanguageProfile } from '@language-drill/shared';
import { Nav } from './nav';

interface AppShellProps {
  profiles: LanguageProfile[];
  children: React.ReactNode;
}

export function AppShell({ profiles, children }: AppShellProps) {
  return (
    <div className="flex h-screen bg-paper">
      <Nav profiles={profiles} />
      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-paper">
        <div className="max-w-max-content mx-auto w-full py-[36px] px-[48px]">
          {children}
        </div>
      </main>
    </div>
  );
}
