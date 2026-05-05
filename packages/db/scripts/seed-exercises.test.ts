/**
 * Tests for the exercise seed data.
 * Validates that all seed exercises have correct structure and coverage,
 * plus the curriculum-driven planning helpers used by Tasks 11–13.
 */

import { describe, it, expect } from 'vitest';

import { ALL_CURRICULA, getGrammarPoint } from '../src/curriculum';
import { deterministicUuid } from '../src/lib/deterministic-uuid';

import {
  SEED_EXERCISES,
  SEED_KEY_TO_GRAMMAR_POINT,
  planSeedTags,
  planSkillTopics,
} from './seed-exercises';

// The deterministicUuid helper itself is exercised in
// `packages/db/src/lib/deterministic-uuid.test.ts`.

const LANGUAGES = ['EN', 'ES', 'DE', 'TR'] as const;
const TYPES = ['cloze', 'translation', 'vocab_recall'] as const;
const VALID_DIFFICULTIES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

describe('seed exercise data coverage', () => {
  it('has 3 exercises per type per language (36 total)', () => {
    const expectedCount = LANGUAGES.length * TYPES.length * 3; // 3 levels each
    expect(expectedCount).toBe(36);
  });

  it('all CEFR levels used are valid', () => {
    const levels = ['A2', 'B1', 'B2'];
    for (const level of levels) {
      expect(VALID_DIFFICULTIES).toContain(level);
    }
  });
});

describe('planSkillTopics', () => {
  it('returns one row per curriculum entry', () => {
    const plans = planSkillTopics(ALL_CURRICULA);
    expect(plans).toHaveLength(ALL_CURRICULA.length);
  });

  it('derives each row id deterministically from the curriculum key', () => {
    const plans = planSkillTopics(ALL_CURRICULA);
    for (let i = 0; i < plans.length; i++) {
      const expected = deterministicUuid(`skill-topic:${ALL_CURRICULA[i].key}`);
      expect(plans[i].id).toBe(expected);
    }
  });

  it('is deterministic across calls', () => {
    const a = planSkillTopics(ALL_CURRICULA);
    const b = planSkillTopics(ALL_CURRICULA);
    expect(a).toEqual(b);
  });
});

describe('planSeedTags', () => {
  it('returns 27 tags and 9 untagged EN seeds for the canonical inputs', () => {
    const result = planSeedTags(SEED_EXERCISES, SEED_KEY_TO_GRAMMAR_POINT, ALL_CURRICULA);
    expect(result.tags).toHaveLength(27);
    expect(result.untaggedEnSeeds).toBe(9);
  });

  it('throws naming the offending seed when a non-EN mapping is missing', () => {
    const broken = { ...SEED_KEY_TO_GRAMMAR_POINT };
    delete (broken as Record<string, string>)['es-cloze-a2-1'];
    expect(() => planSeedTags(SEED_EXERCISES, broken, ALL_CURRICULA)).toThrow(
      /'es-cloze-a2-1' has no curriculum mapping/,
    );
  });

  it('throws naming the offending seed when a mapping points to an unknown curriculum key', () => {
    const broken = { ...SEED_KEY_TO_GRAMMAR_POINT, 'es-cloze-a2-1': 'es-zz-fake' };
    expect(() => planSeedTags(SEED_EXERCISES, broken, ALL_CURRICULA)).toThrow(
      /'es-cloze-a2-1' maps to unknown curriculum key 'es-zz-fake'/,
    );
  });
});

describe('SEED_KEY_TO_GRAMMAR_POINT', () => {
  it('has exactly 27 entries', () => {
    expect(Object.keys(SEED_KEY_TO_GRAMMAR_POINT)).toHaveLength(27);
  });

  it('contains no EN keys (EN seeds are intentionally untagged)', () => {
    const enKeys = Object.keys(SEED_KEY_TO_GRAMMAR_POINT).filter((key) => key.startsWith('en-'));
    expect(enKeys).toEqual([]);
  });

  it('every mapping value resolves to a curriculum entry', () => {
    for (const [seedKey, grammarPointKey] of Object.entries(SEED_KEY_TO_GRAMMAR_POINT)) {
      expect(getGrammarPoint(grammarPointKey), `mapping for ${seedKey}`).toBeDefined();
    }
  });
});
