'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useLanguageProfiles,
  useGetPreferences,
  useUpdateLanguages,
} from '@language-drill/api-client';
import {
  CefrLevel,
  LANGUAGE_NATIVE_NAMES,
  Language,
  type LearningLanguage,
} from '@language-drill/shared';
import { Section } from './section';
import { Button, Chip } from '../ui';
import { Flagdot } from '../shell/flagdot';

const CEFR_LEVELS = [
  CefrLevel.A1,
  CefrLevel.A2,
  CefrLevel.B1,
  CefrLevel.B2,
  CefrLevel.C1,
  CefrLevel.C2,
] as const;

const ALL_LEARNING: readonly LearningLanguage[] = [
  Language.ES,
  Language.DE,
  Language.TR,
];

type Profile = { language: LearningLanguage; proficiencyLevel: CefrLevel };

// Render languages in a fixed canonical order (the order they're declared in
// ALL_LEARNING) regardless of the order the API returns them in. Without this,
// a newly-added language is appended to the end optimistically and then snaps
// to a different slot when the query refetches (the server sorts its rows),
// producing a visible "jump". Sorting both the optimistic and the refetched
// state by the same key keeps cards stationary except when added/removed.
const sortProfiles = (profiles: Profile[]): Profile[] =>
  [...profiles].sort(
    (a, b) => ALL_LEARNING.indexOf(a.language) - ALL_LEARNING.indexOf(b.language),
  );

// ---------------------------------------------------------------------------
// AddLanguage subcomponent
// ---------------------------------------------------------------------------

function AddLanguage({
  available,
  onAdd,
}: {
  available: readonly LearningLanguage[];
  onAdd: (language: LearningLanguage) => void;
}) {
  const [open, setOpen] = useState(false);
  const disabled = available.length === 0;

  return (
    <div className="mt-s-4">
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label="add a language"
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        + add a language
      </Button>
      {open && !disabled && (
        <div className="flex gap-s-3 mt-s-3">
          {available.map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => {
                onAdd(lang);
                setOpen(false);
              }}
              className="flex items-center gap-s-2 px-s-3 py-s-2 rounded-sm border border-rule hover:border-ink transition-all"
            >
              <Flagdot language={lang} />
              <span className="t-body">{LANGUAGE_NATIVE_NAMES[lang]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LanguagesSection
// ---------------------------------------------------------------------------

export function LanguagesSection() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const profilesQuery = useLanguageProfiles({ fetchFn });
  const prefsQuery = useGetPreferences({ fetchFn });
  const update = useUpdateLanguages({ fetchFn });

  const [rows, setRows] = useState<Profile[]>([]);
  const [primary, setPrimary] = useState<LearningLanguage | null>(null);

  useEffect(() => {
    if (profilesQuery.data) {
      setRows(
        sortProfiles(
          profilesQuery.data.profiles.filter(
            (p): p is Profile => p.language !== Language.EN,
          ),
        ),
      );
    }
  }, [profilesQuery.data]);

  useEffect(() => {
    if (prefsQuery.data) setPrimary(prefsQuery.data.primaryLanguage);
  }, [prefsQuery.data]);

  const save = (nextRows: Profile[], nextPrimary: LearningLanguage) => {
    setRows(nextRows);
    setPrimary(nextPrimary);
    update.mutate({ profiles: nextRows, primaryLanguage: nextPrimary });
  };

  const setLevel = (language: LearningLanguage, level: CefrLevel) =>
    save(
      rows.map((r) =>
        r.language === language ? { ...r, proficiencyLevel: level } : r,
      ),
      primary ?? language,
    );

  const setFocus = (language: LearningLanguage) => save(rows, language);

  const remove = (language: LearningLanguage) => {
    if (rows.length <= 1) return;
    const nextRows = rows.filter((r) => r.language !== language);
    const nextPrimary = primary && primary !== language ? primary : nextRows[0].language;
    save(nextRows, nextPrimary);
  };

  const addLanguage = (language: LearningLanguage) =>
    save(
      sortProfiles([...rows, { language, proficiencyLevel: CefrLevel.A1 }]),
      primary ?? language,
    );

  const available = ALL_LEARNING.filter(
    (l) => !rows.some((r) => r.language === l),
  );

  return (
    <Section
      id="languages"
      title="languages & levels"
      sub="add a language, set your level, or pick today's focus."
    >
      <div className="flex flex-col gap-s-3">
        {rows.map((r) => (
          <div
            key={r.language}
            className="rounded-lg border border-rule p-s-5 flex flex-col gap-s-4"
          >
            <div className="flex items-center gap-s-3 flex-wrap">
              <Flagdot language={r.language} size="md" />
              <span className="text-[19px] font-medium text-ink">
                {LANGUAGE_NATIVE_NAMES[r.language]}
              </span>
              {primary === r.language && (
                <Chip variant="accent">today&apos;s focus</Chip>
              )}
              <div className="ml-auto flex gap-s-2">
                {primary !== r.language && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setFocus(r.language)}
                  >
                    set as focus
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={rows.length <= 1}
                  aria-label={`remove ${LANGUAGE_NATIVE_NAMES[r.language]}`}
                  onClick={() => remove(r.language)}
                >
                  remove
                </Button>
              </div>
            </div>
            <div
              role="radiogroup"
              aria-label={`${LANGUAGE_NATIVE_NAMES[r.language]} level`}
              className="flex gap-s-2 flex-wrap"
            >
              {CEFR_LEVELS.map((lvl) => {
                const selected = r.proficiencyLevel === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`set ${r.language} to ${lvl}`}
                    onClick={() => setLevel(r.language, lvl)}
                    className={
                      't-mono text-[13px] w-[54px] h-[44px] inline-flex items-center justify-center rounded-md border transition-all duration-150 ' +
                      (selected
                        ? 'bg-ink text-paper border-ink font-medium'
                        : 'bg-transparent text-ink-soft border-rule-strong hover:border-ink-mute hover:text-ink-2')
                    }
                  >
                    {lvl}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <AddLanguage available={available} onAdd={addLanguage} />
    </Section>
  );
}
