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
              className="flex items-center gap-s-2 px-s-3 py-s-2 rounded-r-sm border border-rule hover:border-ink transition-all"
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
        profilesQuery.data.profiles.filter(
          (p): p is Profile => p.language !== Language.EN,
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
      [...rows, { language, proficiencyLevel: CefrLevel.A1 }],
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
            className="rounded-r-md border border-rule p-s-4 flex flex-col gap-s-3"
          >
            <div className="flex items-center gap-s-3">
              <Flagdot language={r.language} />
              <span className="t-body text-ink">
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
              className="flex gap-[6px] flex-wrap"
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
                      't-mono text-[12px] px-s-3 py-[8px] rounded-r-sm border transition-all duration-150 ' +
                      (selected
                        ? 'bg-ink text-paper border-ink'
                        : 'bg-card text-ink-soft border-rule hover:border-ink')
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
