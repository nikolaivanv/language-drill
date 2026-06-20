import type { CurriculumMapPoint } from '@language-drill/api-client';

export type MapEntry =
  | { kind: 'point'; point: CurriculumMapPoint }
  | { kind: 'run'; count: number; points: CurriculumMapPoint[] };

const MIN_RUN = 3;

// Collapse runs of >=3 consecutive solid, NON-error-prone points so the eye lands
// on learning / error-prone points. An error-prone point always renders on its own.
export function collapseSolidRuns(points: readonly CurriculumMapPoint[]): MapEntry[] {
  const out: MapEntry[] = [];
  let run: CurriculumMapPoint[] = [];
  const flush = () => {
    if (run.length >= MIN_RUN) out.push({ kind: 'run', count: run.length, points: run });
    else for (const p of run) out.push({ kind: 'point', point: p });
    run = [];
  };
  for (const p of points) {
    if (p.state === 'solid' && !p.errorProne) run.push(p);
    else { flush(); out.push({ kind: 'point', point: p }); }
  }
  flush();
  return out;
}
