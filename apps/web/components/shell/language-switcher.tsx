'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  LANGUAGE_NAMES,
  type LanguageProfile,
} from '@language-drill/shared';
import {
  type LearningLanguage,
  isLearningLanguage,
} from '../../lib/active-language';
import { cn } from '../../lib/cn';
import { useActiveLanguage } from './active-language-provider';
import { Flagdot } from './flagdot';

interface LanguageSwitcherProps {
  profiles: LanguageProfile[];
}

type LearningProfile = LanguageProfile & { language: LearningLanguage };

const focusRing =
  'focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(26,22,18,0.08)]';

const triggerClass = cn(
  'w-full flex items-center justify-between gap-s-2 px-s-3 py-[10px] border border-rule rounded-r-md transition-colors duration-150 enabled:hover:bg-paper-2 disabled:cursor-default',
  focusRing,
);

export function LanguageSwitcher({ profiles }: LanguageSwitcherProps) {
  const { activeLanguage, setActiveLanguage } = useActiveLanguage();
  const [open, setOpen] = useState(false);

  const learningProfiles = useMemo<LearningProfile[]>(
    () =>
      profiles.filter((p): p is LearningProfile => isLearningLanguage(p.language)),
    [profiles],
  );

  if (learningProfiles.length === 0) return null;

  const activeProfile = learningProfiles.find((p) => p.language === activeLanguage);

  const triggerInner = (
    <>
      <span className="flex items-center gap-s-2 min-w-0">
        <Flagdot language={activeLanguage} />
        <span className="text-[13px] font-medium text-ink truncate">
          {LANGUAGE_NAMES[activeLanguage].toLowerCase()}
        </span>
      </span>
      {activeProfile && (
        <span className="font-mono text-[10px] text-ink-mute">
          {activeProfile.proficiencyLevel}
        </span>
      )}
    </>
  );

  // Single learning language: nothing to switch to — a plain disabled button.
  if (learningProfiles.length === 1) {
    return (
      <div className="mb-s-3">
        <button type="button" disabled className={triggerClass}>
          {triggerInner}
        </button>
      </div>
    );
  }

  function onValueChange(next: string) {
    if (isLearningLanguage(next) && next !== activeLanguage) {
      setActiveLanguage(next);
    }
  }

  return (
    <div className="mb-s-3">
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className={triggerClass}>
            {triggerInner}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            style={{ width: 'var(--radix-dropdown-menu-trigger-width)' }}
            className="z-10 bg-card border border-rule rounded-r-md shadow-2 py-1"
          >
            <DropdownMenu.RadioGroup value={activeLanguage} onValueChange={onValueChange}>
              {learningProfiles.map((p) => (
                <DropdownMenu.RadioItem
                  key={p.language}
                  value={p.language}
                  className={cn(
                    'w-full flex items-center gap-s-2 px-s-3 py-s-2 cursor-pointer outline-none transition-colors duration-150 hover:bg-paper-2 data-[highlighted]:bg-paper-2',
                    focusRing,
                  )}
                >
                  <Flagdot language={p.language} />
                  <span className="flex-1 text-left text-[13px] text-ink">
                    {LANGUAGE_NAMES[p.language].toLowerCase()}
                  </span>
                  <span className="font-mono text-[10px] text-ink-mute">
                    {p.proficiencyLevel}
                  </span>
                  {p.language === activeLanguage && (
                    <span className="w-2 h-2 rounded-full bg-accent" aria-hidden="true" />
                  )}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className="my-1 h-px bg-rule" />
            <DropdownMenu.Item asChild>
              <Link
                href="/settings"
                className={cn(
                  'block px-s-3 py-s-2 text-[12px] text-ink-soft outline-none transition-colors duration-150 hover:bg-paper-2 data-[highlighted]:bg-paper-2',
                  focusRing,
                )}
              >
                manage languages →
              </Link>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
