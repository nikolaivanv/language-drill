import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Language } from '@language-drill/shared';
import type { RadarAxis, RadarAxisKey } from '@language-drill/api-client';
import { RadarChart } from '../radar-chart';

const ALL_KEYS: RadarAxisKey[] = [
  'listening',
  'reading',
  'speaking',
  'writing',
  'grammar',
  'vocabulary',
];

function buildAxes(
  overrides: Partial<Record<RadarAxisKey, { mastery: number; evidence?: number }>>,
): RadarAxis[] {
  return ALL_KEYS.map((key) => {
    const o = overrides[key];
    return {
      key,
      label: key,
      currentMastery: o?.mastery ?? 0,
      previousMastery: o?.mastery ?? 0,
      lastPracticedAt: o ? '2026-04-30T12:00:00.000Z' : null,
      evidenceCount: o?.evidence ?? (o ? 1 : 0),
    };
  });
}

describe('RadarChart', () => {
  it('renders an SVG with the right viewBox and a role of img', () => {
    const { container } = render(
      <RadarChart language={Language.ES} axes={buildAxes({})} />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('viewBox')).toBe('0 0 440 440');
    expect(svg.getAttribute('width')).toBe('100%');
  });

  it('clamps to a ~320px square on mobile while keeping the 440px desktop cap', () => {
    const { container } = render(
      <RadarChart language={Language.ES} axes={buildAxes({})} />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveClass('max-w-[440px]', 'mobile:max-w-[320px]');
    // Still fluid up to the cap (legible, centered by the flex wrapper).
    expect(svg.getAttribute('width')).toBe('100%');
  });

  it('renders all six axis labels as <text> children', () => {
    const { container } = render(
      <RadarChart language={Language.ES} axes={buildAxes({})} />,
    );
    const texts = Array.from(container.querySelectorAll('svg text'));
    const labels = texts.map((t) => t.textContent);
    expect(labels).toEqual([
      'listening',
      'reading',
      'speaking',
      'writing',
      'grammar',
      'vocabulary',
    ]);
  });

  it('emits a visually-hidden list with one item per axis at the right percentage', () => {
    render(
      <RadarChart
        language={Language.ES}
        axes={buildAxes({
          grammar: { mastery: 0.71 },
          vocabulary: { mastery: 0.65 },
        })}
      />,
    );
    const list = screen.getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items.find((li) => li.textContent === 'grammar: 71% mastery')).toBeDefined();
    expect(items.find((li) => li.textContent === 'vocabulary: 65% mastery')).toBeDefined();
  });

  it('aria-label cites the strongest and weakest practised axes', () => {
    const { container } = render(
      <RadarChart
        language={Language.ES}
        axes={buildAxes({
          listening: { mastery: 0.82 },
          reading: { mastery: 0.88 }, // strongest practised
          speaking: { mastery: 0.34 }, // weakest practised
          writing: { mastery: 0.5 },
          grammar: { mastery: 0.7 },
          vocabulary: { mastery: 0.6 },
        })}
      />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-label')).toBe(
      'Skill radar for español; strongest: reading at 88%, weakest: speaking at 34%.',
    );
  });

  it('aria-label degrades to a "no practice yet" line when no axis has evidence', () => {
    const { container } = render(
      <RadarChart language={Language.DE} axes={buildAxes({})} />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-label')).toBe(
      'Skill radar for deutsch; no practice yet.',
    );
  });

  it('renders four reference grid rings', () => {
    const { container } = render(
      <RadarChart language={Language.ES} axes={buildAxes({})} />,
    );
    const dashed = Array.from(container.querySelectorAll('svg polygon')).filter(
      (p) => p.getAttribute('stroke-dasharray') === '2 4',
    );
    expect(dashed).toHaveLength(4);
  });

  it('renders the previous polygon dashed and the current polygon filled with accent', () => {
    const { container } = render(
      <RadarChart
        language={Language.ES}
        axes={buildAxes({ grammar: { mastery: 0.7 } })}
      />,
    );
    const polygons = Array.from(container.querySelectorAll('svg polygon'));
    // Last two non-grid polygons are previous (dashed 3 4) and current (no dash, accent fill)
    const previous = polygons.find(
      (p) => p.getAttribute('stroke-dasharray') === '3 4',
    );
    const current = polygons.find(
      (p) =>
        !p.getAttribute('stroke-dasharray') &&
        p.getAttribute('fill') === 'var(--color-accent)',
    );
    expect(previous).toBeDefined();
    expect(current).toBeDefined();
  });
});
