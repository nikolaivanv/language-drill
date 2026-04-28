import { describe, it, expect, beforeEach } from 'vitest';
import { Language } from '@language-drill/shared';
import {
  isLearningLanguage,
  readActiveLanguageCookie,
  writeActiveLanguageCookie,
} from '../active-language';

function clearCookie() {
  document.cookie = 'active_language=; path=/; max-age=0';
}

describe('isLearningLanguage', () => {
  it('accepts ES, DE, TR', () => {
    expect(isLearningLanguage('ES')).toBe(true);
    expect(isLearningLanguage('DE')).toBe(true);
    expect(isLearningLanguage('TR')).toBe(true);
  });

  it('rejects EN (not a learning language)', () => {
    expect(isLearningLanguage('EN')).toBe(false);
  });

  it('rejects unknown language codes', () => {
    expect(isLearningLanguage('FR')).toBe(false);
    expect(isLearningLanguage('XX')).toBe(false);
    expect(isLearningLanguage('es')).toBe(false); // case-sensitive
  });

  it('rejects non-string values', () => {
    expect(isLearningLanguage('')).toBe(false);
    expect(isLearningLanguage(null)).toBe(false);
    expect(isLearningLanguage(undefined)).toBe(false);
    expect(isLearningLanguage(123)).toBe(false);
    expect(isLearningLanguage({})).toBe(false);
    expect(isLearningLanguage([])).toBe(false);
  });
});

describe('readActiveLanguageCookie', () => {
  beforeEach(() => {
    clearCookie();
  });

  it('returns null when cookie is absent', () => {
    expect(readActiveLanguageCookie()).toBeNull();
  });

  it('returns parsed language for valid cookie', () => {
    document.cookie = 'active_language=DE; path=/';
    expect(readActiveLanguageCookie()).toBe('DE');
  });

  it('returns null for invalid value', () => {
    document.cookie = 'active_language=XX; path=/';
    expect(readActiveLanguageCookie()).toBeNull();
  });

  it('returns null when cookie value is EN (not a learning language)', () => {
    document.cookie = 'active_language=EN; path=/';
    expect(readActiveLanguageCookie()).toBeNull();
  });

  it('parses correctly when other cookies are present', () => {
    document.cookie = 'foo=bar; path=/';
    document.cookie = 'active_language=ES; path=/';
    document.cookie = 'baz=qux; path=/';
    expect(readActiveLanguageCookie()).toBe('ES');
  });
});

describe('writeActiveLanguageCookie', () => {
  beforeEach(() => {
    clearCookie();
  });

  it('writes a cookie that readActiveLanguageCookie can read back', () => {
    writeActiveLanguageCookie(Language.DE);
    expect(readActiveLanguageCookie()).toBe('DE');
  });

  it('overwrites a previous value', () => {
    writeActiveLanguageCookie(Language.ES);
    writeActiveLanguageCookie(Language.TR);
    expect(readActiveLanguageCookie()).toBe('TR');
  });
});
