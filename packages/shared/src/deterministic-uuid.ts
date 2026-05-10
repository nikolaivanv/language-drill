/**
 * Deterministic UUID generation (v5-style using a simple FNV hash).
 *
 * Maps an arbitrary string key to a stable UUID. The version nibble is set to 5
 * and the variant nibble to 8, so the output passes RFC 4122 UUID v5 format
 * checks. Used by seed scripts, curriculum-derived row IDs, and the Phase 4
 * scheduler's same-day idempotency to keep upserts idempotent across runs.
 *
 * Lives in `@language-drill/shared` (Phase 4 break-the-cycle): both
 * `@language-drill/db` and `@language-drill/ai` consume it; pre-Phase-4 it
 * lived in `db` and forced `ai → db` at the runtime level. Hosting it here
 * lets `db → ai` stay the only cross-package edge in `packages/`.
 */
export function deterministicUuid(key: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let h3 = 0xdeadbeef;
  let h4 = 0xcafebabe;

  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
    h3 = Math.imul(h3 ^ c, 0x0100019d) >>> 0;
    h4 = Math.imul(h4 ^ c, 0x811c9dd1) >>> 0;
  }

  const hex = [h1, h2, h3, h4].map((h) => h.toString(16).padStart(8, '0')).join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '5' + hex.slice(13, 16),
    ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}
