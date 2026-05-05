import { describe, it, expect } from 'vitest';

import { deterministicUuid } from './deterministic-uuid';

describe('deterministicUuid', () => {
  it('produces a valid UUID v5-shaped string', () => {
    const uuid = deterministicUuid('test-key');
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('is deterministic — same key always gives the same UUID', () => {
    const a = deterministicUuid('en-cloze-a2-1');
    const b = deterministicUuid('en-cloze-a2-1');
    expect(a).toBe(b);
  });

  it('produces different UUIDs for different keys', () => {
    const a = deterministicUuid('en-cloze-a2-1');
    const b = deterministicUuid('es-cloze-a2-1');
    expect(a).not.toBe(b);
  });

  it('generates unique UUIDs for all 36 seed exercise keys', () => {
    const seedKeys = [
      // EN
      'en-cloze-a2-1', 'en-cloze-b1-1', 'en-cloze-b2-1',
      'en-translation-a2-1', 'en-translation-b1-1', 'en-translation-b2-1',
      'en-vocab-a2-1', 'en-vocab-b1-1', 'en-vocab-b2-1',
      // ES
      'es-cloze-a2-1', 'es-cloze-b1-1', 'es-cloze-b2-1',
      'es-translation-a2-1', 'es-translation-b1-1', 'es-translation-b2-1',
      'es-vocab-a2-1', 'es-vocab-b1-1', 'es-vocab-b2-1',
      // DE
      'de-cloze-a2-1', 'de-cloze-b1-1', 'de-cloze-b2-1',
      'de-translation-a2-1', 'de-translation-b1-1', 'de-translation-b2-1',
      'de-vocab-a2-1', 'de-vocab-b1-1', 'de-vocab-b2-1',
      // TR
      'tr-cloze-a2-1', 'tr-cloze-b1-1', 'tr-cloze-b2-1',
      'tr-translation-a2-1', 'tr-translation-b1-1', 'tr-translation-b2-1',
      'tr-vocab-a2-1', 'tr-vocab-b1-1', 'tr-vocab-b2-1',
    ];

    expect(seedKeys).toHaveLength(36);

    const uuids = new Set(seedKeys.map((k) => deterministicUuid(k)));
    expect(uuids.size).toBe(36);
  });
});
