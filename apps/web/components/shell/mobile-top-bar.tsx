'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useClerk, useUser } from '@clerk/nextjs';
import { LANGUAGE_NAMES, type LanguageProfile } from '@language-drill/shared';
import {
  isLearningLanguage,
  type LearningLanguage,
} from '../../lib/active-language';
import { cn } from '../../lib/cn';
import { BrandMark } from './brand-mark';
import { useActiveLanguage } from './active-language-provider';
import { Flagdot } from './flagdot';
import { LanguageSheet } from './language-sheet';

type LearningProfile = LanguageProfile & { language: LearningLanguage };

const focusRing =
  'focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(26,22,18,0.08)]';

function getInitials(
  firstName?: string | null,
  lastName?: string | null,
): string {
  const f = firstName?.[0];
  const l = lastName?.[0];
  if (f && l) return (f + l).toUpperCase();
  if (f) return f.toUpperCase();
  return '?';
}

// Compact user avatar + dropdown (settings / sign out), mirroring UserFooter's
// menu but anchored under a top-bar avatar instead of the rail footer.
function AvatarMenu() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initials = getInitials(user?.firstName, user?.lastName);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="account menu"
        className={cn(
          'flex h-[36px] w-[36px] items-center justify-center rounded-full bg-accent-soft font-display text-[14px] font-semibold text-accent-2',
          focusRing,
        )}
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-[160px] rounded-r-md border border-rule bg-card py-1 shadow-2"
        >
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={cn(
              'block px-s-3 py-s-2 text-[13px] text-ink transition-colors duration-150 hover:bg-paper-2',
              focusRing,
            )}
          >
            settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => signOut({ redirectUrl: '/sign-in' })}
            className={cn(
              'block w-full px-s-3 py-s-2 text-left text-[13px] text-ink transition-colors duration-150 hover:bg-paper-2',
              focusRing,
            )}
          >
            sign out
          </button>
        </div>
      )}
    </div>
  );
}

interface MobileTopBarProps {
  profiles: LanguageProfile[];
}

// Top chrome at phone width: a 52px sticky bar with the brand mark, a compact
// language pill (opens the LanguageSheet; inert with a single language), and
// the user avatar.
export function MobileTopBar({ profiles }: MobileTopBarProps) {
  const { activeLanguage } = useActiveLanguage();
  const [sheetOpen, setSheetOpen] = useState(false);

  const learningProfiles = profiles.filter(
    (p): p is LearningProfile => isLearningLanguage(p.language),
  );
  const activeProfile = learningProfiles.find(
    (p) => p.language === activeLanguage,
  );
  const single = learningProfiles.length <= 1;

  return (
    <header className="sticky top-0 z-40 flex h-[52px] flex-none items-center justify-between border-b border-rule bg-paper px-[18px]">
      <Link
        href="/home"
        aria-label="drill — home"
        className={cn('flex items-center gap-s-2 rounded-r-sm', focusRing)}
      >
        <BrandMark size={28} />
        <span className="font-display text-[18px] font-semibold tracking-[-0.4px] text-ink">
          drill
        </span>
      </Link>

      <div className="flex items-center gap-s-3">
        <button
          type="button"
          disabled={single}
          onClick={single ? undefined : () => setSheetOpen(true)}
          aria-haspopup={single ? undefined : 'dialog'}
          aria-expanded={single ? undefined : sheetOpen}
          className={cn(
            'flex items-center gap-s-2 rounded-r-pill border border-rule py-[6px] pl-[6px] pr-s-3 transition-colors duration-150 enabled:hover:bg-paper-2 disabled:cursor-default',
            focusRing,
          )}
        >
          <Flagdot language={activeLanguage} />
          <span className="text-[13px] font-medium text-ink">
            {LANGUAGE_NAMES[activeLanguage].toLowerCase()}
          </span>
          {activeProfile && (
            <span className="font-mono text-[10px] text-ink-mute">
              {activeProfile.proficiencyLevel}
            </span>
          )}
        </button>

        <AvatarMenu />
      </div>

      {!single && (
        <LanguageSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          profiles={profiles}
        />
      )}
    </header>
  );
}
