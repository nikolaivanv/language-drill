import { Language, type LearningLanguage } from '@language-drill/shared';

// Re-export the canonical `LearningLanguage` type from `@language-drill/shared`
// so callers that import it from this module keep working. The shared
// definition is structurally identical (`Exclude<Language, Language.EN>`).
export type { LearningLanguage };

const COOKIE_NAME = 'active_language';

const VALID_LEARNING_LANGUAGES = new Set<string>([
  Language.ES,
  Language.DE,
  Language.TR,
]);

export function isLearningLanguage(value: unknown): value is LearningLanguage {
  return typeof value === 'string' && VALID_LEARNING_LANGUAGES.has(value);
}

export function readActiveLanguageCookie(): LearningLanguage | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)active_language=([^;]+)/);
  if (!match) return null;
  const raw = decodeURIComponent(match[1]);
  return isLearningLanguage(raw) ? raw : null;
}

export function writeActiveLanguageCookie(lang: LearningLanguage): void {
  document.cookie = `${COOKIE_NAME}=${lang}; path=/; SameSite=Lax; max-age=31536000`;
}
