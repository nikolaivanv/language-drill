import { describe, it, expect } from 'vitest';
import type { SkillMovement } from '@language-drill/shared';
import { movementSummary } from '../movement-summary';

let seq = 0;
const mv = (band: SkillMovement['band'], key = `gp-${band}-${seq++}`): SkillMovement => ({
  grammarPointKey: key,
  label: `Point ${key}`,
  band,
  confidence: 'high',
});

describe('movementSummary — states', () => {
  it('is "none" for no movements at all', () => {
    const s = movementSummary([]);
    expect(s.state).toBe('none');
    expect(s.title).toBe('session done.');
    expect(s.subline).toBe('nothing graded this round');
  });

  it('is "steady" when every movement is steady', () => {
    const s = movementSummary([mv('steady'), mv('steady')]);
    expect(s.state).toBe('steady');
    expect(s.title).toBe('steady session.');
    expect(s.subline).toBe("nothing shifted much — that's normal");
  });

  it('is "gained" for gains with no slips', () => {
    const s = movementSummary([mv('gain')]);
    expect(s.state).toBe('gained');
    expect(s.title).toBe('solid session.');
    expect(s.subline).toBe('one skill gained · nothing slipped');
  });

  it('counts strong-gain as a gain', () => {
    const s = movementSummary([mv('strong-gain')]);
    expect(s.state).toBe('gained');
  });

  it('is "slipped" for slips with no gains', () => {
    const s = movementSummary([mv('slip')]);
    expect(s.state).toBe('slipped');
    expect(s.title).toBe('worth another look.');
    expect(s.subline).toBe('one slipped');
  });

  it('is "mixed" when gains and slips both appear', () => {
    const s = movementSummary([mv('gain'), mv('gain'), mv('slip')]);
    expect(s.state).toBe('mixed');
    expect(s.title).toBe('mixed session.');
    expect(s.subline).toBe('two gained · one slipped');
  });

  it('is "new" when new is the only mover', () => {
    const s = movementSummary([mv('new'), mv('new')]);
    expect(s.state).toBe('new');
    expect(s.title).toBe('new ground.');
    expect(s.subline).toBe('two skills · first evidence');
  });
});

describe('movementSummary — precedence', () => {
  it('new alongside a gain does NOT change the title', () => {
    expect(movementSummary([mv('gain'), mv('new')]).state).toBe('gained');
  });

  it('new alongside a slip does NOT change the title', () => {
    expect(movementSummary([mv('slip'), mv('new')]).state).toBe('slipped');
  });

  it('gain + slip + new is mixed', () => {
    expect(movementSummary([mv('gain'), mv('slip'), mv('new')]).state).toBe('mixed');
  });

  it('steady movements never mask a real mover', () => {
    expect(movementSummary([mv('steady'), mv('slip'), mv('steady')]).state).toBe('slipped');
  });
});

describe('movementSummary — number words', () => {
  it('spells out one through nine', () => {
    const nine = movementSummary(Array.from({ length: 9 }, (_, i) => mv('slip', `k${i}`)));
    expect(nine.subline).toBe('nine slipped');
  });

  it('uses digits from ten up', () => {
    const ten = movementSummary(Array.from({ length: 10 }, (_, i) => mv('slip', `k${i}`)));
    expect(ten.subline).toBe('10 slipped');
  });

  it('renders no percent sign in any state', () => {
    const all: SkillMovement['band'][] = ['new', 'strong-gain', 'gain', 'steady', 'slip'];
    for (const band of all) {
      expect(movementSummary([mv(band)]).subline).not.toContain('%');
    }
  });
});
