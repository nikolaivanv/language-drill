'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
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

export function LanguageSwitcher({ profiles }: LanguageSwitcherProps) {
  const { activeLanguage, setActiveLanguage } = useActiveLanguage();

  const learningProfiles = useMemo<LearningProfile[]>(
    () =>
      profiles.filter((p): p is LearningProfile => isLearningLanguage(p.language)),
    [profiles]
  );
  const activeProfile = learningProfiles.find((p) => p.language === activeLanguage);

  const [open, setOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);
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

  if (learningProfiles.length === 0) return null;

  const single = learningProfiles.length === 1;

  function handleListboxKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIdx((i) => (i + 1) % learningProfiles.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIdx(
        (i) => (i - 1 + learningProfiles.length) % learningProfiles.length
      );
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const target = learningProfiles[focusedIdx];
      if (target) {
        setOpen(false);
        if (target.language !== activeLanguage) setActiveLanguage(target.language);
      }
    }
  }

  return (
    <div ref={ref} className="relative mb-s-3">
      <button
        type="button"
        onClick={single ? undefined : () => setOpen((o) => !o)}
        aria-haspopup={single ? undefined : 'listbox'}
        aria-expanded={single ? undefined : open}
        disabled={single}
        className={cn(
          'w-full flex items-center justify-between gap-s-2 px-s-3 py-[10px] border border-rule rounded-r-md transition-colors duration-150 enabled:hover:bg-paper-2 disabled:cursor-default',
          focusRing
        )}
      >
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
      </button>

      {open && (
        <div
          role="listbox"
          tabIndex={-1}
          onKeyDown={handleListboxKey}
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-10 bg-card border border-rule rounded-r-md shadow-2 py-1"
        >
          {learningProfiles.map((p, idx) => (
            <button
              key={p.language}
              role="option"
              aria-selected={p.language === activeLanguage}
              data-focused={idx === focusedIdx}
              onClick={() => {
                setOpen(false);
                if (p.language !== activeLanguage) setActiveLanguage(p.language);
              }}
              className={cn(
                'w-full flex items-center gap-s-2 px-s-3 py-s-2 hover:bg-paper-2 transition-colors duration-150',
                idx === focusedIdx && 'bg-paper-2',
                focusRing
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
                <span
                  className="w-2 h-2 rounded-full bg-accent"
                  aria-hidden="true"
                />
              )}
            </button>
          ))}
          <Link
            href="/onboarding?edit=1"
            className={cn(
              'block px-s-3 py-s-2 mt-1 border-t border-rule text-[12px] text-ink-soft hover:bg-paper-2 transition-colors duration-150',
              focusRing
            )}
            onClick={() => setOpen(false)}
          >
            manage languages →
          </Link>
        </div>
      )}
    </div>
  );
}
