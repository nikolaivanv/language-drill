import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { DiversityCell, PoolStatusItem } from '@language-drill/api-client';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, createAuthenticatedFetch: () => vi.fn() };
});
vi.mock('../pool-cell-detail', () => ({
  PoolCellDetail: ({ item }: { item: PoolStatusItem }) => <div data-testid="cell-detail">{item.grammarPointKey}</div>,
}));

import { PoolCoverageTable } from '../pool-coverage-table';
import { diversityByCellKey } from '../../../../../../lib/admin/diversity-status';

const items: PoolStatusItem[] = [
  {
    language: 'ES', level: 'B1', type: 'cloze', grammarPointKey: 'es-b1-present-subjunctive',
    approved: 12, flagged: 1, rejected: 4, lastRefilledAt: null, depletionRate7d: 4.1,
    targetSize: 75, generationTarget: 30, coverageDistribution: null,
    status: 'saturated-dedup',
    lastJob: { approvedCount: 1, requestedCount: 20, dedupGivenUpCount: 18, curriculumVersion: '2026-06-17' },
  },
];

function diversityFor(cell: Partial<DiversityCell>, kind = 'grammar') {
  return diversityByCellKey([
    {
      key: 'es-b1-present-subjunctive',
      name: 'Present subjunctive',
      language: 'ES',
      cefrLevel: 'B1',
      kind,
      targetOverride: null,
      provenIssues: 0,
      unknowns: 0,
      cells: [
        {
          cellKey: 'es:b1:cloze:es-b1-present-subjunctive',
          type: 'cloze',
          level: 'B1',
          approved: 12,
          target: 30,
          atTarget: false,
          axes: [],
          seed: { kind: 'none' },
          shortfalls: [],
          provenIssues: 0,
          unknowns: 0,
          ...cell,
        },
      ],
    },
  ]);
}

describe('PoolCoverageTable — Diversity column', () => {
  it('marks a grammar cell that declares neither mechanism family', () => {
    render(<PoolCoverageTable items={items} diversityByCell={diversityFor({})} />);
    expect(screen.getByTestId('mechanism-spec')).toHaveTextContent('spec — ✗');
    expect(screen.getByTestId('mechanism-seed')).toHaveTextContent('seed none ✗');
  });

  it('names the declared spec axis count and seed source when both are present', () => {
    render(
      <PoolCoverageTable
        items={items}
        diversityByCell={diversityFor({
          axes: [
            { name: 'person', role: 'controlled', values: [], untagged: 0 },
            { name: 'polarity', role: 'controlled', values: [], untagged: 0 },
            { name: 'wordClass', role: 'monitored', values: [], untagged: 0 },
          ],
          seed: { kind: 'construction-variants', variants: [], unlabelledRows: 0 },
        })}
      />,
    );
    // Monitored axes carry no floors and must not be counted.
    expect(screen.getByTestId('mechanism-spec')).toHaveTextContent('spec 2ax ✓');
    expect(screen.getByTestId('mechanism-seed')).toHaveTextContent('seed variants ✓');
  });

  it('badges the cell\'s proven and unknown deficiencies separately', () => {
    render(
      <PoolCoverageTable items={items} diversityByCell={diversityFor({ provenIssues: 3, unknowns: 2 })} />,
    );
    expect(screen.getByTestId('mechanism-proven-issues')).toHaveTextContent('✗ 3');
    expect(screen.getByTestId('mechanism-unknowns')).toHaveTextContent('⚠ 2');
  });

  // An umbrella kind has no coverageSpec BY DESIGN — rendering it as a red
  // failure would drown the missing-mechanism signal in false positives.
  it('renders an umbrella kind as n/a, not as a failure', () => {
    render(<PoolCoverageTable items={items} diversityByCell={diversityFor({}, 'free-writing')} />);
    expect(screen.getByTestId('mechanism-spec')).toHaveTextContent('spec n/a');
    expect(screen.getByTestId('mechanism-spec')).not.toHaveTextContent('✗');
  });

  // Absence of evidence is not evidence of absence.
  it('claims nothing while the diversity data is unresolved', () => {
    render(<PoolCoverageTable items={items} />);
    expect(screen.queryByTestId('mechanism-spec')).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /diversity/i })).toBeInTheDocument();
  });
});

describe('PoolCoverageTable', () => {
  it('expands a row to show the cell detail, and collapses it again', () => {
    render(<PoolCoverageTable items={items} />);
    expect(screen.queryByTestId('cell-detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /es-b1-present-subjunctive/i }));
    expect(screen.getByTestId('cell-detail')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /es-b1-present-subjunctive/i }));
    expect(screen.queryByTestId('cell-detail')).not.toBeInTheDocument();
  });

  it('renders a Status column with the human label for the cell status', () => {
    render(<PoolCoverageTable items={items} />);
    expect(screen.getByRole('columnheader', { name: /status/i })).toBeInTheDocument();
    expect(screen.getByText('Saturated')).toBeInTheDocument();
  });
});
