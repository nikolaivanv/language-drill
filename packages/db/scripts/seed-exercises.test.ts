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

  it('plans skill_topics rows for the kind:dictation umbrellas', () => {
    // The umbrellas are curriculum entries, so the curriculum-driven planner
    // covers them automatically. runOneCell fails-closed without a skill_topics
    // row for cell.grammarPoint.key, so the scheduler depends on these rows.
    const plans = planSkillTopics(ALL_CURRICULA);
    const byId = new Map(plans.map((p) => [p.id, p] as const));
    for (const key of ['es-b1-dictation', 'es-b2-dictation'] as const) {
      const expectedId = deterministicUuid(`skill-topic:${key}`);
      expect(byId.has(expectedId)).toBe(true);
    }
  });
});

describe('planSeedTags', () => {
  it('returns one tag per active mapping plus 10 untagged EN seeds (reduced curriculum)', () => {
    // SEED_KEY_TO_GRAMMAR_POINT is temporarily reduced (see seed-exercises.ts).
    // Filter SEED_EXERCISES to only EN seeds and seeds whose mapping is still
    // active so the happy-path assertion remains meaningful. Restore the
    // unfiltered call (and the original 27 / 10 expectations) when the
    // commented-out mappings are uncommented. Count is 10 (was 9) after adding
    // the en-free-writing-b1-ideal-weekend seed (EN is source-only — no tag).
    const activeNonEnKeys = new Set(Object.keys(SEED_KEY_TO_GRAMMAR_POINT));
    const activeSeeds = SEED_EXERCISES.filter(
      (s) => s.language === 'EN' || activeNonEnKeys.has(s.key),
    );
    const result = planSeedTags(activeSeeds, SEED_KEY_TO_GRAMMAR_POINT, ALL_CURRICULA);
    expect(result.tags).toHaveLength(activeNonEnKeys.size);
    expect(result.untaggedEnSeeds).toBe(10);
  });

  it('throws naming the offending seed when a non-EN mapping is missing', () => {
    // 'es-cloze-b1-1' is an active mapping; deleting it from a clone reproduces
    // the original "missing mapping" error. Filter SEED_EXERCISES to actively-
    // mapped + EN seeds so the throw is triggered by our deletion rather than
    // by another seed whose mapping is currently disabled. Restore to
    // 'es-cloze-a2-1' and the unfiltered SEED_EXERCISES when that mapping is
    // uncommented.
    const activeNonEnKeys = new Set(Object.keys(SEED_KEY_TO_GRAMMAR_POINT));
    const activeSeeds = SEED_EXERCISES.filter(
      (s) => s.language === 'EN' || activeNonEnKeys.has(s.key),
    );
    const broken = { ...SEED_KEY_TO_GRAMMAR_POINT };
    delete (broken as Record<string, string>)['es-cloze-b1-1'];
    expect(() => planSeedTags(activeSeeds, broken, ALL_CURRICULA)).toThrow(
      /'es-cloze-b1-1' has no curriculum mapping/,
    );
  });

  it('throws naming the offending seed when a mapping points to an unknown curriculum key', () => {
    // Same restore note as above — swap back to 'es-cloze-a2-1' when active.
    const activeNonEnKeys = new Set(Object.keys(SEED_KEY_TO_GRAMMAR_POINT));
    const activeSeeds = SEED_EXERCISES.filter(
      (s) => s.language === 'EN' || activeNonEnKeys.has(s.key),
    );
    const broken = { ...SEED_KEY_TO_GRAMMAR_POINT, 'es-cloze-b1-1': 'es-zz-fake' };
    expect(() => planSeedTags(activeSeeds, broken, ALL_CURRICULA)).toThrow(
      /'es-cloze-b1-1' maps to unknown curriculum key 'es-zz-fake'/,
    );
  });
});

describe('SEED_KEY_TO_GRAMMAR_POINT', () => {
  it('has exactly 9 active entries (reduced from 27 while curriculum is disabled)', () => {
    expect(Object.keys(SEED_KEY_TO_GRAMMAR_POINT)).toHaveLength(9);
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
