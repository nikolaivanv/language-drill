'use client';

import Link from 'next/link';
import { LANGUAGE_NAMES, type LanguageProfile } from '@language-drill/shared';
import {
  isLearningLanguage,
  type LearningLanguage,
} from '../../lib/active-language';
import { cn } from '../../lib/cn';
import { BottomSheet } from '../ui/bottom-sheet';
import { useActiveLanguage } from './active-language-provider';
import { Flagdot } from './flagdot';

interface LanguageSheetProps {
  open: boolean;
  onClose: () => void;
  profiles: LanguageProfile[];
}

type LearningProfile = LanguageProfile & { language: LearningLanguage };

// Touch-friendly language switcher: a bottom sheet listing the user's learning
// profiles. Selecting one sets it active (via the existing provider) and
// dismisses the sheet. EN and other non-learning profiles are filtered out.
export function LanguageSheet({ open, onClose, profiles }: LanguageSheetProps) {
  const { activeLanguage, setActiveLanguage } = useActiveLanguage();

  const learningProfiles = profiles.filter(
    (p): p is LearningProfile => isLearningLanguage(p.language),
  );

  function handleSelect(language: LearningLanguage) {
    onClose();
    if (language !== activeLanguage) setActiveLanguage(language);
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabel="choose language"
      title={<div className="t-micro pt-[2px]">language</div>}
    >
      <ul
        role="listbox"
        aria-label="learning languages"
        className="m-0 flex list-none flex-col gap-1 p-0"
      >
        {learningProfiles.map((p) => {
          const selected = p.language === activeLanguage;
          return (
            <li key={p.language}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => handleSelect(p.language)}
                className={cn(
                  'flex min-h-[48px] w-full items-center gap-s-3 rounded-r-md px-s-3 transition-colors duration-150',
                  selected ? 'bg-paper-2' : 'hover:bg-paper-2',
                )}
              >
                <Flagdot language={p.language} />
                <span className="flex-1 text-left text-[15px] text-ink">
                  {LANGUAGE_NAMES[p.language].toLowerCase()}
                </span>
                <span className="font-mono text-[10px] text-ink-mute">
                  {p.proficiencyLevel}
                </span>
                {selected && (
                  <span
                    className="h-2 w-2 rounded-full bg-accent"
                    aria-hidden="true"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <Link
        href="/onboarding?edit=1"
        onClick={onClose}
        className="mt-s-3 block border-t border-rule pt-s-3 text-[13px] text-ink-soft transition-colors duration-150 hover:text-ink"
      >
        manage languages →
      </Link>
    </BottomSheet>
  );
}
