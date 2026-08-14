import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DiversityPoint } from '@language-drill/api-client';

import { DiversityPointRow } from '../diversity-point-row';

function pointWith(overrides: Partial<DiversityPoint> = {}): DiversityPoint {
  return {
    key: 'es-b1-impersonal-plural',
    name: 'Impersonal plural',
    language: 'ES',
    cefrLevel: 'B1',
    kind: 'grammar',
    targetOverride: null,
    provenIssues: 0,
    unknowns: 0,
    cells: [],
    ...overrides,
  };
}

const variantCell = (unlabelledRows: number): DiversityPoint['cells'][number] => ({
  cellKey: 'ES:B1:cloze:es-b1-impersonal-plural',
  type: 'cloze',
  level: 'B1',
  approved: 47,
  target: 50,
  atTarget: false,
  axes: [],
  seed: {
    kind: 'construction-variants',
    variants: [
      { id: 'hearsay', directive: 'H.', share: 3, count: 31, quota: 30 },
      { id: 'passive-like', directive: 'P.', share: 1, count: 0, quota: 10 },
    ],
    unlabelledRows,
  },
  shortfalls: [],
});

describe('DiversityPointRow', () => {
  it('marks a variant at zero as PROVEN absent when no rows are unlabelled', () => {
    render(
      <DiversityPointRow
        point={pointWith({ cells: [variantCell(0)], provenIssues: 1 })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /impersonal plural/i }));
    expect(screen.getByTestId('variant-passive-like')).toHaveTextContent('✗');
  });

  it('marks the SAME zero as UNKNOWN while rows remain unlabelled', () => {
    render(
      <DiversityPointRow
        point={pointWith({ cells: [variantCell(9)], unknowns: 1 })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /impersonal plural/i }));
    const chip = screen.getByTestId('variant-passive-like');
    expect(chip).toHaveTextContent('⚠');
    expect(chip).not.toHaveTextContent('✗');
    expect(screen.getByText(/9 rows unlabelled/i)).toBeInTheDocument();
  });

  it('marks an axis value at zero as UNKNOWN while rows are untagged', () => {
    const cell = {
      ...variantCell(0),
      axes: [
        {
          name: 'person',
          role: 'controlled' as const,
          values: [
            { value: '1sg', count: 12, floor: 4 },
            { value: '2pl', count: 0, floor: 2 },
          ],
          untagged: 14,
        },
      ],
      shortfalls: [{ axis: 'person', value: '2pl', floor: 2, actual: 0 }],
    };
    render(<DiversityPointRow point={pointWith({ cells: [cell], unknowns: 1 })} />);
    fireEvent.click(screen.getByRole('button', { name: /impersonal plural/i }));
    const chip = screen.getByTestId('axis-person-2pl');
    expect(chip).toHaveTextContent('⚠');
    expect(screen.getByText(/14 rows untagged/i)).toBeInTheDocument();
  });

  it('calls out an at-target cell with unmet floors as needing demote:pool', () => {
    const cell = {
      ...variantCell(0),
      approved: 50,
      atTarget: true,
      axes: [
        {
          name: 'person',
          role: 'controlled' as const,
          values: [{ value: '2pl', count: 0, floor: 2 }],
          untagged: 0,
        },
      ],
      shortfalls: [{ axis: 'person', value: '2pl', floor: 2, actual: 0 }],
    };
    render(<DiversityPointRow point={pointWith({ cells: [cell], provenIssues: 2 })} />);
    fireEvent.click(screen.getByRole('button', { name: /impersonal plural/i }));
    expect(screen.getByText(/at target/i)).toBeInTheDocument();
    expect(screen.getByText(/demote:pool/i)).toBeInTheDocument();
  });

  it('shows curated pool burn-down', () => {
    const cell = {
      ...variantCell(0),
      seed: {
        kind: 'curated' as const,
        source: 'conjugationSeedWords',
        poolSize: 12,
        usedCount: 9,
        unused: ['a', 'b', 'c'],
      },
    };
    render(<DiversityPointRow point={pointWith({ cells: [cell] })} />);
    fireEvent.click(screen.getByRole('button', { name: /impersonal plural/i }));
    expect(screen.getByText(/9 of 12 used/i)).toBeInTheDocument();
  });
});
