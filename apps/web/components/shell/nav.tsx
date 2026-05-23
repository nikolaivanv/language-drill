'use client';

import type { LanguageProfile } from '@language-drill/shared';
import { Brand } from './brand';
import { LanguageSwitcher } from './language-switcher';
import { NavItems } from './nav-items';
import { UserFooter } from './user-footer';

interface NavProps {
  profiles: LanguageProfile[];
}

export function Nav({ profiles }: NavProps) {
  return (
    <nav
      aria-label="primary"
      data-testid="desktop-rail"
      className="w-[220px] flex-shrink-0 flex flex-col gap-1 border-r border-rule bg-paper px-s-4 py-[22px]"
    >
      <Brand />
      <LanguageSwitcher profiles={profiles} />
      <NavItems />
      <UserFooter />
    </nav>
  );
}
