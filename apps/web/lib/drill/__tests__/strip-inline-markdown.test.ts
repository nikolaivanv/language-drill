import { describe, it, expect } from 'vitest';
import { stripInlineMarkdown } from '../strip-inline-markdown';

describe('stripInlineMarkdown', () => {
  it('removes bold markers and keeps the inner text', () => {
    expect(
      stripInlineMarkdown(
        'Use all four words: **tú**, **poder**, **ayudar**, **mañana**.',
      ),
    ).toBe('Use all four words: tú, poder, ayudar, mañana.');
  });

  it('removes italic markers', () => {
    expect(stripInlineMarkdown('a *concrete* scenario')).toBe('a concrete scenario');
  });

  it('leaves plain text untouched', () => {
    const plain = 'Write one sentence in Spanish using the conditional.';
    expect(stripInlineMarkdown(plain)).toBe(plain);
  });

  it('leaves a single stray asterisk untouched', () => {
    expect(stripInlineMarkdown('the rule is 2 * 3 here')).toBe('the rule is 2 * 3 here');
  });

  it('handles an empty string', () => {
    expect(stripInlineMarkdown('')).toBe('');
  });

  it('does not cross between separate emphasis spans', () => {
    expect(stripInlineMarkdown('**one** and **two**')).toBe('one and two');
  });
});
