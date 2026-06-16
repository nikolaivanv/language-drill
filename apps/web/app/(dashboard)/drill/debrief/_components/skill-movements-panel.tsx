import type { SkillMovement, SkillMovementBand } from '@language-drill/shared';
import { Card } from '../../../../../components/ui';

const MOVER_DISPLAY: Record<Exclude<SkillMovementBand, 'steady'>, { glyph: string; label: string; className: string }> = {
  'strong-gain': { glyph: '▲▲', label: 'Strong gain', className: 'text-emerald-600' },
  gain: { glyph: '▲', label: 'Gain', className: 'text-emerald-600' },
  new: { glyph: '★', label: 'New · first evidence', className: 'text-ink-soft' },
  slip: { glyph: '▼', label: 'Slipped', className: 'text-rose-600' },
};

export interface SkillMovementsPanelProps {
  movements: SkillMovement[];
}

export function SkillMovementsPanel({ movements }: SkillMovementsPanelProps) {
  if (movements.length === 0) return null;
  const movers = movements.filter((m) => m.band !== 'steady');
  const steadyCount = movements.length - movers.length;
  if (movers.length === 0 && steadyCount === 0) return null;

  return (
    <Card padding="md">
      <p className="t-micro text-ink-soft mb-s-3">Skills you moved</p>
      <div className="flex flex-col gap-s-2">
        {movers.map((m) => {
          const d = MOVER_DISPLAY[m.band as Exclude<SkillMovementBand, 'steady'>];
          return (
            <div key={m.grammarPointKey} className="flex items-center justify-between t-body">
              <span className="text-ink">{m.label}</span>
              <span className={`${d.className} font-medium`}>
                {d.glyph} {d.label} · {m.confidence} confidence
              </span>
            </div>
          );
        })}
      </div>
      {steadyCount > 0 && (
        <p className="t-micro text-ink-soft mt-s-3">{steadyCount} held steady</p>
      )}
    </Card>
  );
}
