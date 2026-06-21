import type { CefrLevel, Language } from '@language-drill/shared';

export type LanguageProfileRow = {
  language: Language;
  proficiencyLevel: CefrLevel;
};

/** Returns a new profile list with `language`'s level set to `nextLevel`; other rows unchanged. */
export function withAdvancedLevel(
  profiles: readonly LanguageProfileRow[],
  language: Language,
  nextLevel: CefrLevel,
): LanguageProfileRow[] {
  return profiles.map((p) =>
    p.language === language ? { ...p, proficiencyLevel: nextLevel } : p,
  );
}
