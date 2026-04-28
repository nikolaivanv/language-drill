'use client';

import { createContext, useContext, useState } from 'react';
import { Language, type LanguageProfile } from '@language-drill/shared';
import {
  type LearningLanguage,
  isLearningLanguage,
  readActiveLanguageCookie,
  writeActiveLanguageCookie,
} from '../../lib/active-language';

interface ActiveLanguageContextValue {
  activeLanguage: LearningLanguage;
  setActiveLanguage: (lang: LearningLanguage) => void;
}

const ActiveLanguageContext = createContext<ActiveLanguageContextValue | null>(
  null
);

function resolveInitialLanguage(profiles: LanguageProfile[]): LearningLanguage {
  const learning = profiles
    .map((p) => p.language)
    .filter((l): l is LearningLanguage => isLearningLanguage(l));

  const cookie = readActiveLanguageCookie();
  if (cookie && learning.includes(cookie)) return cookie;
  return learning[0] ?? Language.ES;
}

export function ActiveLanguageProvider({
  profiles,
  children,
}: {
  profiles: LanguageProfile[];
  children: React.ReactNode;
}) {
  const [activeLanguage, setActiveLanguageState] = useState<LearningLanguage>(
    () => resolveInitialLanguage(profiles)
  );

  function setActiveLanguage(lang: LearningLanguage) {
    writeActiveLanguageCookie(lang);
    setActiveLanguageState(lang);
    window.location.reload();
  }

  return (
    <ActiveLanguageContext.Provider value={{ activeLanguage, setActiveLanguage }}>
      {children}
    </ActiveLanguageContext.Provider>
  );
}

export function useActiveLanguage(): ActiveLanguageContextValue {
  const ctx = useContext(ActiveLanguageContext);
  if (!ctx) {
    throw new Error(
      'useActiveLanguage must be used within an ActiveLanguageProvider'
    );
  }
  return ctx;
}
