// Pure classifier for GET /progress/curriculum. Joins curriculum facts (supplied
// by the route — keeps this lib free of any DB/curriculum import) with mastery +
// recent-error maps into level-grouped, state-classified points + a readiness
// rollup. No I/O. Initial thresholds are named constants (design spec §Tunable).

export const SOLID_MASTERY = 0.8;
export const SOLID_CONFIDENCE = 0.6;
export const ERROR_PRONE_MIN = 2;
export const READINESS_RATIO = 0.8;

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2'] as const;

export function nextCefrLevel(level: string): string | null {
  const i = CEFR_ORDER.indexOf(level as (typeof CEFR_ORDER)[number]);
  if (i < 0 || i >= CEFR_ORDER.length - 1) return null;
  return CEFR_ORDER[i + 1];
}

export type PointState = 'not-started' | 'learning' | 'solid';

export type CurriculumFact = {
  key: string;
  name: string;
  cefrLevel: string;
  order: number;
  prereqKeys: string[];
  prereqNames: string[];
};

export type MasteryRow = {
  masteryScore: number;
  confidence: number;
  evidenceCount: number;
  lastPracticedAt: Date;
};

export type MapPoint = {
  key: string;
  name: string;
  cefrLevel: string;
  order: number;
  state: PointState;
  errorProne: boolean;
  mastery: number | null;
  confidence: number | null;
  evidenceCount: number;
  lastPracticedAt: string | null;
  recentErrorCount: number;
  prereqKeys: string[];
  prereqNames: string[];
  prereqUnmet: boolean;
};

export type MapLevel = {
  level: string;
  solidCount: number;
  total: number;
  readyToAdvance: boolean;
  isPreview: boolean;
  points: MapPoint[];
};

export type BuildInput = {
  activeLevel: string;
  activePoints: readonly CurriculumFact[];
  previewPoints: readonly CurriculumFact[];
  masteryByKey: ReadonlyMap<string, MasteryRow>;
  errorCountByKey: ReadonlyMap<string, number>;
  now: Date;
};

function classify(m: MasteryRow | undefined): PointState {
  if (!m || m.evidenceCount === 0) return 'not-started';
  if (m.masteryScore >= SOLID_MASTERY && m.confidence >= SOLID_CONFIDENCE) return 'solid';
  return 'learning';
}

function isSolid(key: string, masteryByKey: ReadonlyMap<string, MasteryRow>): boolean {
  return classify(masteryByKey.get(key)) === 'solid';
}

function toPoint(
  f: CurriculumFact,
  masteryByKey: ReadonlyMap<string, MasteryRow>,
  errorCountByKey: ReadonlyMap<string, number>,
): MapPoint {
  const m = masteryByKey.get(f.key);
  const state = classify(m);
  const recentErrorCount = errorCountByKey.get(f.key) ?? 0;
  return {
    key: f.key,
    name: f.name,
    cefrLevel: f.cefrLevel,
    order: f.order,
    state,
    errorProne: recentErrorCount >= ERROR_PRONE_MIN,
    mastery: m ? m.masteryScore : null,
    confidence: m ? m.confidence : null,
    evidenceCount: m ? m.evidenceCount : 0,
    lastPracticedAt: m ? m.lastPracticedAt.toISOString() : null,
    recentErrorCount,
    prereqKeys: f.prereqKeys,
    prereqNames: f.prereqNames,
    prereqUnmet: f.prereqKeys.some((pk) => !isSolid(pk, masteryByKey)),
  };
}

function buildLevel(
  level: string,
  facts: readonly CurriculumFact[],
  masteryByKey: ReadonlyMap<string, MasteryRow>,
  errorCountByKey: ReadonlyMap<string, number>,
  isPreview: boolean,
): MapLevel {
  const points = [...facts]
    .sort((a, b) => a.order - b.order)
    .map((f) => toPoint(f, masteryByKey, errorCountByKey));
  const solidCount = points.filter((p) => p.state === 'solid').length;
  const total = points.length;
  return {
    level,
    solidCount,
    total,
    readyToAdvance: total > 0 && solidCount / total >= READINESS_RATIO,
    isPreview,
    points,
  };
}

export function buildCurriculumMap(input: BuildInput): { activeLevel: string; levels: MapLevel[] } {
  const { activeLevel, activePoints, previewPoints, masteryByKey, errorCountByKey } = input;
  const levels: MapLevel[] = [
    buildLevel(activeLevel, activePoints, masteryByKey, errorCountByKey, false),
  ];
  if (previewPoints.length > 0) {
    const previewLevel = previewPoints[0].cefrLevel;
    levels.push(buildLevel(previewLevel, previewPoints, masteryByKey, errorCountByKey, true));
  }
  return { activeLevel, levels };
}
