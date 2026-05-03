import {
  LANGUAGE_NATIVE_NAMES,
  type LearningLanguage,
} from '@language-drill/shared';
import type { RadarAxis } from '@language-drill/api-client';

// ---------------------------------------------------------------------------
// RadarChart — pure-SVG 6-axis radar with current + 30-day-ago overlay.
// No charting library; geometry is ~30 lines of trig. The accessible
// summary lives in <title>/<desc>/aria-label plus a visually-hidden list
// so screen readers get the same numbers a sighted user reads off the
// chart.
// Design reference: design.md §"Component 5 — RadarChart"
// ---------------------------------------------------------------------------

const VIEW = 440;
const CENTER = VIEW / 2; // 220
const RADIUS = 170;
const LABEL_OFFSET = 26;

const GRID_RINGS = [0.25, 0.5, 0.75, 1] as const;

export type RadarChartProps = {
  language: LearningLanguage;
  axes: readonly RadarAxis[];
};

export function RadarChart({ language, axes }: RadarChartProps) {
  const n = axes.length; // always 6 in production but kept generic for tests
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;

  function pointsAtRadius(r: number): string {
    return axes
      .map(
        (_, i) =>
          `${CENTER + Math.cos(angle(i)) * RADIUS * r},${
            CENTER + Math.sin(angle(i)) * RADIUS * r
          }`,
      )
      .join(' ');
  }

  function pointsAtMastery(getter: (axis: RadarAxis) => number): string {
    return axes
      .map((axis, i) => {
        const v = clamp01(getter(axis));
        return `${CENTER + Math.cos(angle(i)) * RADIUS * v},${
          CENTER + Math.sin(angle(i)) * RADIUS * v
        }`;
      })
      .join(' ');
  }

  // Strongest / weakest read off practised axes only — "all-zero" radars
  // (no evidence anywhere) skip the strongest/weakest framing in the label.
  const practised = axes.filter((a) => a.evidenceCount > 0);
  const ariaLabel = buildAriaLabel(language, practised);
  const languageName = LANGUAGE_NATIVE_NAMES[language];

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        width="100%"
        height="auto"
        style={{ maxWidth: 440 }}
      >
        <title>{`Skill radar for ${languageName}`}</title>
        <desc>
          Six axes: listening, reading, speaking, writing, grammar,
          vocabulary. Solid polygon shows current mastery; dashed polygon
          shows mastery 30 days ago.
        </desc>

        {/* Reference grid rings */}
        {GRID_RINGS.map((r) => (
          <polygon
            key={r}
            points={pointsAtRadius(r)}
            fill="none"
            stroke="var(--color-rule)"
            strokeWidth={1}
            strokeDasharray="2 4"
          />
        ))}

        {/* Axis spokes + labels */}
        {axes.map((axis, i) => {
          const x = CENTER + Math.cos(angle(i)) * RADIUS;
          const y = CENTER + Math.sin(angle(i)) * RADIUS;
          const tx = CENTER + Math.cos(angle(i)) * (RADIUS + LABEL_OFFSET);
          const ty = CENTER + Math.sin(angle(i)) * (RADIUS + LABEL_OFFSET);
          return (
            <g key={axis.key}>
              <line
                x1={CENTER}
                y1={CENTER}
                x2={x}
                y2={y}
                stroke="var(--color-rule)"
                strokeWidth={0.6}
              />
              <text
                x={tx}
                y={ty + 5}
                fontFamily="Inter"
                fontSize={12}
                fill="var(--color-ink-soft)"
                textAnchor="middle"
              >
                {axis.label}
              </text>
            </g>
          );
        })}

        {/* Previous polygon (dashed outline only) */}
        <polygon
          points={pointsAtMastery((a) => a.previousMastery)}
          fill="var(--color-ink)"
          fillOpacity={0.06}
          stroke="var(--color-ink-mute)"
          strokeWidth={1}
          strokeDasharray="3 4"
        />

        {/* Current polygon (filled accent) */}
        <polygon
          points={pointsAtMastery((a) => a.currentMastery)}
          fill="var(--color-accent)"
          fillOpacity={0.18}
          stroke="var(--color-accent)"
          strokeWidth={2}
        />

        {/* Vertex dots on the current polygon */}
        {axes.map((axis, i) => {
          const v = clamp01(axis.currentMastery);
          const x = CENTER + Math.cos(angle(i)) * RADIUS * v;
          const y = CENTER + Math.sin(angle(i)) * RADIUS * v;
          return (
            <circle
              key={axis.key}
              cx={x}
              cy={y}
              r={4}
              fill="var(--color-accent)"
              stroke="#fff"
              strokeWidth={1.5}
            />
          );
        })}
      </svg>

      {/* Visually-hidden text summary for screen readers */}
      <ul style={visuallyHidden}>
        {axes.map((axis) => (
          <li key={axis.key}>
            {axis.label}: {Math.round(clamp01(axis.currentMastery) * 100)}%
            mastery
          </li>
        ))}
      </ul>
    </div>
  );
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function buildAriaLabel(
  language: LearningLanguage,
  practised: readonly RadarAxis[],
): string {
  const languageName = LANGUAGE_NATIVE_NAMES[language];
  if (practised.length === 0) {
    return `Skill radar for ${languageName}; no practice yet.`;
  }
  const strongest = practised.reduce((b, a) =>
    a.currentMastery > b.currentMastery ? a : b,
  );
  const weakest = practised.reduce((w, a) =>
    a.currentMastery < w.currentMastery ? a : w,
  );
  const sPct = Math.round(clamp01(strongest.currentMastery) * 100);
  const wPct = Math.round(clamp01(weakest.currentMastery) * 100);
  return `Skill radar for ${languageName}; strongest: ${strongest.label} at ${sPct}%, weakest: ${weakest.label} at ${wPct}%.`;
}

const visuallyHidden: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  border: 0,
  clip: 'rect(0 0 0 0)',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
};
