import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  DEFAULT_THEME,
  THEME_INIT_SCRIPT,
  isThemeChoice,
  resolveTheme,
  applyResolvedTheme,
} from '../theme';

describe('theme helpers', () => {
  describe('isThemeChoice', () => {
    it('accepts the three valid choices', () => {
      expect(isThemeChoice('light')).toBe(true);
      expect(isThemeChoice('dark')).toBe(true);
      expect(isThemeChoice('system')).toBe(true);
    });
    it('rejects anything else', () => {
      expect(isThemeChoice('blue')).toBe(false);
      expect(isThemeChoice(null)).toBe(false);
      expect(isThemeChoice(undefined)).toBe(false);
      expect(isThemeChoice(1)).toBe(false);
    });
  });

  describe('resolveTheme', () => {
    it('returns explicit choices unchanged', () => {
      expect(resolveTheme('light', true)).toBe('light');
      expect(resolveTheme('dark', false)).toBe('dark');
    });
    it('maps "system" to the OS preference', () => {
      expect(resolveTheme('system', true)).toBe('dark');
      expect(resolveTheme('system', false)).toBe('light');
    });
  });

  describe('applyResolvedTheme', () => {
    it('adds the .dark class and sets color-scheme for dark', () => {
      const root = document.createElement('html');
      applyResolvedTheme('dark', root);
      expect(root.classList.contains('dark')).toBe(true);
      expect(root.style.colorScheme).toBe('dark');
    });
    it('removes the .dark class and sets color-scheme for light', () => {
      const root = document.createElement('html');
      root.classList.add('dark');
      applyResolvedTheme('light', root);
      expect(root.classList.contains('dark')).toBe(false);
      expect(root.style.colorScheme).toBe('light');
    });
    it('defaults to document.documentElement', () => {
      applyResolvedTheme('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      applyResolvedTheme('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  describe('THEME_INIT_SCRIPT', () => {
    const matchMedia = vi.fn();

    beforeEach(() => {
      document.documentElement.className = '';
      document.documentElement.style.colorScheme = '';
      localStorage.clear();
      vi.stubGlobal('matchMedia', matchMedia);
      matchMedia.mockReturnValue({ matches: false });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      localStorage.clear();
    });

    function run() {
      // The script reads window.matchMedia; jsdom exposes window === globalThis.
      // Indirect eval keeps it in global scope, matching the real <script> tag.
      (0, eval)(THEME_INIT_SCRIPT);
    }

    it('applies dark when the stored choice is "dark"', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      run();
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.style.colorScheme).toBe('dark');
    });

    it('applies light when the stored choice is "light" (ignoring dark OS)', () => {
      matchMedia.mockReturnValue({ matches: true });
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      run();
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.style.colorScheme).toBe('light');
    });

    it('follows the OS when the stored choice is "system"', () => {
      matchMedia.mockReturnValue({ matches: true });
      localStorage.setItem(THEME_STORAGE_KEY, 'system');
      run();
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it(`falls back to the default (${DEFAULT_THEME}) when nothing is stored`, () => {
      matchMedia.mockReturnValue({ matches: true });
      run();
      // DEFAULT_THEME is "system", so a dark OS yields dark.
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('never throws when localStorage access fails', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(() => run()).not.toThrow();
      spy.mockRestore();
    });
  });
});
