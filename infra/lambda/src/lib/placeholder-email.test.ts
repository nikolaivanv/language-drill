import { describe, it, expect } from 'vitest';
import { PLACEHOLDER_EMAIL, isPlaceholderEmail } from './placeholder-email';

describe('isPlaceholderEmail', () => {
  it('matches the canonical seeded placeholder', () => {
    expect(isPlaceholderEmail(PLACEHOLDER_EMAIL)).toBe(true);
  });

  it('matches any address on the placeholder domain (variant shapes)', () => {
    expect(isPlaceholderEmail('pending-user_123@placeholder')).toBe(true);
  });

  it('does not match a real address', () => {
    expect(isPlaceholderEmail('ivan.v.nikola@gmail.com')).toBe(false);
  });

  it('does not match an address that merely contains the word placeholder', () => {
    expect(isPlaceholderEmail('placeholder@example.com')).toBe(false);
  });

  it('handles null/undefined/empty', () => {
    expect(isPlaceholderEmail(null)).toBe(false);
    expect(isPlaceholderEmail(undefined)).toBe(false);
    expect(isPlaceholderEmail('')).toBe(false);
  });
});
