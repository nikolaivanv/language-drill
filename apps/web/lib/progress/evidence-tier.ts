/** Below this many graded attempts, an axis's mastery is "thin" — shown but flagged. */
export const THIN_EVIDENCE_THRESHOLD = 5;

export type EvidenceTier = 'untrained' | 'thin' | 'robust';

/** Classify an axis by how much evidence backs its mastery score. */
export function evidenceTier(evidenceCount: number): EvidenceTier {
  if (evidenceCount <= 0) return 'untrained';
  if (evidenceCount < THIN_EVIDENCE_THRESHOLD) return 'thin';
  return 'robust';
}
