import type { SkillMovement, SkillMovementBand } from '@language-drill/shared';
import { Card } from '../../../../../components/ui';

// Mover display: glyph + lowercase phrase + color token + sort weight.
// `sort` orders movers positive-first (strong gain → gain → new → slip) so the
// panel ends on what to work on next.
const MOVER_DISPLAY: Record<
  Exclude<SkillMovementBand, 'steady'>,
  { glyph: string; phrase: string; className: string; sort: number }
> = {
  'strong-gain': { glyph: '▲▲', phrase: 'strong gain', className: 'text-emerald-600', sort: 0 },
  gain: { glyph: '▲', phrase: 'gained', className: 'text-emerald-600', sort: 1 },
  new: { glyph: '★', phrase: 'new — first evidence', className: 'text-ink-soft', sort: 2 },
  slip: { glyph: '▼', phrase: 'slipped', className: 'text-rose-600', sort: 3 },
};

const CONFIDENCE_PHRASE: Record<SkillMovement['confidence'], string> = {
  high: "we're confident",
  low: 'early signal',
};

function heldSteady(count: number): string {
  return `${count} ${count === 1 ? 'skill' : 'skills'} held steady`;
}

export interface SkillMovementsPanelProps {
  movements: SkillMovement[];
}

export function SkillMovementsPanel({ movements }: SkillMovementsPanelProps) {
  const movers = movements
    .filter((mv) => mv.band !== 'steady')
    .sort(
      (a, b) =>
        MOVER_DISPLAY[a.band as Exclude<SkillMovementBand, 'steady'>].sort -
        MOVER_DISPLAY[b.band as Exclude<SkillMovementBand, 'steady'>].sort,
    );
  const steadyCount = movements.length - movers.length;

  return (
    <Card padding="md">
      <p className="t-micro text-ink-soft mb-s-3">what moved</p>

      {movers.length > 0 ? (
        <>
          <div className="flex flex-col gap-s-2">
            {movers.map((mv) => {
              const d = MOVER_DISPLAY[mv.band as Exclude<SkillMovementBand, 'steady'>];
              return (
                <div
                  key={mv.grammarPointKey}
                  className="flex items-center justify-between t-body"
                >
                  <span className="text-ink flex items-center">
                    <span aria-hidden="true" className={`${d.className} mr-s-2`}>
                      {d.glyph}
                    </span>
                    <span>{mv.label}</span>
                  </span>
                  <span className={`${d.className} font-medium`}>
                    {d.phrase} · {CONFIDENCE_PHRASE[mv.confidence]}
                  </span>
                </div>
              );
            })}
          </div>
          {steadyCount > 0 && (
            <p className="t-micro text-ink-soft mt-s-3">{heldSteady(steadyCount)}</p>
          )}
        </>
      ) : movements.length > 0 ? (
        <p className="t-body text-ink-soft">
          Nothing shifted much this round — {heldSteady(steadyCount)}. That&apos;s normal;
          another short session adds signal.
        </p>
      ) : (
        <p className="t-body text-ink-soft">No skill movement recorded this round.</p>
      )}
    </Card>
  );
}
