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
      className="w-[300px] flex-shrink-0 flex flex-col gap-1 min-h-0 overflow-y-auto border-r border-rule bg-paper px-[22px] pt-[30px] pb-[22px]"
    >
      <Brand />
      <LanguageSwitcher profiles={profiles} />
      <NavItems />
      <UserFooter />
    </nav>
  );
}
