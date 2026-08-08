/**
 * Tests for the `pnpm demote:pool` CLI argument parser.
 *
 * Pure planning tests — no DB. Mirrors the `parseDedupeArgs` /
 * `parseReviewArgs` test style.
 */

import { describe, expect, it } from 'vitest';

import { parseDemoteArgs } from './demote-cell-pool';

describe('parseDemoteArgs', () => {
  const required = [
    '--language', 'TR', '--cefr', 'A1', '--type', 'cloze',
    '--grammar-point', 'tr-a1-numbers-ordinals', '--reason', 'quality',
  ];

  it('defaults to dry-run with all filters parsed', () => {
    const args = parseDemoteArgs(required);
    expect(args).toEqual({
      language: 'TR', cefr: 'A1', type: 'cloze',
      grammarPoint: 'tr-a1-numbers-ordinals',
      contentIlike: null, apply: false, reason: 'quality',
    });
  });

  it('parses --apply and --content-ilike', () => {
    const args = parseDemoteArgs([...required, '--content-ilike', 'üçüncü', '--apply']);
    expect(args.apply).toBe(true);
    expect(args.contentIlike).toBe('üçüncü');
  });

  it('throws when a required filter is missing', () => {
    expect(() => parseDemoteArgs(['--language', 'TR'])).toThrow(/required/i);
  });

  it('uppercases --language and --cefr but leaves --type as-given', () => {
    const args = parseDemoteArgs([
      '--language', 'tr', '--cefr', 'a1', '--type', 'cloze',
      '--grammar-point', 'tr-a1-numbers-ordinals', '--reason', 'quality',
    ]);
    expect(args.language).toBe('TR');
    expect(args.cefr).toBe('A1');
    expect(args.type).toBe('cloze');
  });

  it('requires --reason so demotion intent is never guessed later', () => {
    expect(() =>
      parseDemoteArgs(['--language', 'TR', '--cefr', 'A1', '--type', 'cloze', '--grammar-point', 'tr-a1-locative']),
    ).toThrow(/--reason/);
  });

  it('rejects a reason outside the vocabulary', () => {
    expect(() =>
      parseDemoteArgs([
        '--language', 'TR', '--cefr', 'A1', '--type', 'cloze',
        '--grammar-point', 'tr-a1-locative', '--reason', 'because-i-said-so',
      ]),
    ).toThrow(/--reason/);
  });

  it('accepts each documented reason', () => {
    for (const reason of ['quality', 'learner-flag', 'duplicate', 'pool-hygiene'] as const) {
      const args = parseDemoteArgs([
        '--language', 'TR', '--cefr', 'A1', '--type', 'cloze',
        '--grammar-point', 'tr-a1-locative', '--reason', reason,
      ]);
      expect(args.reason).toBe(reason);
    }
  });
});
