import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { PoolStatusItem } from '@language-drill/api-client';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, createAuthenticatedFetch: () => vi.fn() };
});
vi.mock('../pool-cell-detail', () => ({
  PoolCellDetail: ({ item }: { item: PoolStatusItem }) => <div data-testid="cell-detail">{item.grammarPointKey}</div>,
}));

import { PoolCoverageTable } from '../pool-coverage-table';

const items: PoolStatusItem[] = [
  {
    language: 'ES', level: 'B1', type: 'cloze', grammarPointKey: 'es-b1-present-subjunctive',
    approved: 12, flagged: 1, rejected: 4, lastRefilledAt: null, depletionRate7d: 4.1,
    targetSize: 75, generationTarget: 30, coverageDistribution: null,
    status: 'saturated-dedup',
    lastJob: { approvedCount: 1, requestedCount: 20, dedupGivenUpCount: 18, curriculumVersion: '2026-06-17' },
  },
];

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
