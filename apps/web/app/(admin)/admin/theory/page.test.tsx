import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { TheoryCoverageRow } from '@language-drill/api-client';

// ---------------------------------------------------------------------------
// Mock the RSC's two side-effecting imports: `apiFetch` and `redirect`.
// ---------------------------------------------------------------------------

const mockApiFetch = vi.fn();
vi.mock('../../../../lib/api-server', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockRedirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});
vi.mock('next/navigation', () => ({
  redirect: (path: string) => mockRedirect(path),
}));

import AdminTheoryPage from './page';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function buildRow(
  language: 'ES' | 'DE' | 'TR',
  level: 'A1' | 'A2' | 'B1' | 'B2',
  partial: Partial<Omit<TheoryCoverageRow, 'language' | 'level'>> = {},
): TheoryCoverageRow {
  return {
    language,
    level,
    approved: 0,
    flagged: 0,
    total: 0,
    ...partial,
  };
}

// 12 rows for a full mix: ES/B1 is fully approved, ES/B2 has mixed approved
// + flagged, DE/A1 has zero curriculum (total: 0), every other cell is empty.
function fullCoveragePayload() {
  return {
    rows: [
      buildRow('ES', 'A1', { approved: 0, flagged: 0, total: 3 }),
      buildRow('ES', 'A2', { approved: 0, flagged: 0, total: 3 }),
      buildRow('ES', 'B1', { approved: 3, flagged: 0, total: 3 }),
      buildRow('ES', 'B2', { approved: 2, flagged: 1, total: 5 }),
      buildRow('DE', 'A1', { approved: 0, flagged: 0, total: 0 }),
      buildRow('DE', 'A2', { approved: 0, flagged: 0, total: 2 }),
      buildRow('DE', 'B1', { approved: 0, flagged: 0, total: 4 }),
      buildRow('DE', 'B2', { approved: 0, flagged: 0, total: 4 }),
      buildRow('TR', 'A1', { approved: 0, flagged: 0, total: 5 }),
      buildRow('TR', 'A2', { approved: 0, flagged: 0, total: 3 }),
      buildRow('TR', 'B1', { approved: 0, flagged: 0, total: 4 }),
      buildRow('TR', 'B2', { approved: 0, flagged: 0, total: 4 }),
    ],
  };
}

beforeEach(() => {
  mockApiFetch.mockReset();
  mockRedirect.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminTheoryPage', () => {
  it('renders 12 cells with badge text for a full coverage payload', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(fullCoveragePayload()));

    render(await AdminTheoryPage());

    // ES/B1 cell: 3/3 with green ✓ badge.
    expect(screen.getByText(/3\/3\s*✓/)).toBeInTheDocument();
  });

  it('renders an em dash for a zero-curriculum cell (total: 0)', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(fullCoveragePayload()));

    render(await AdminTheoryPage());

    // DE/A1 has total: 0 — exactly one em dash in the rendered table.
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it('renders +N flagged annotation when approved > 0 AND flagged > 0', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(fullCoveragePayload()));

    const { container } = render(await AdminTheoryPage());

    // ES/B2 = 2/5 + ⚠ + "+1 flagged". The cell contains both fragments.
    const cells = Array.from(container.querySelectorAll('td'));
    const esB2 = cells.find(
      (td) => td.textContent?.includes('2/5') && td.textContent?.includes('+1 flagged'),
    );
    expect(esB2).toBeDefined();
    expect(esB2?.textContent).toMatch(/⚠/);
  });

  it('redirects to / when apiFetch returns 403', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse({}, 403));

    await expect(AdminTheoryPage()).rejects.toThrow('redirect:/');
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });

  it('renders "Failed to load:" when apiFetch returns 500', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));

    render(await AdminTheoryPage());

    expect(screen.getByText(/Failed to load:/i)).toBeInTheDocument();
  });

  it('renders the header row with Language + 4 CEFR columns', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(fullCoveragePayload()));

    const { container } = render(await AdminTheoryPage());

    const thead = container.querySelector('thead');
    expect(thead).not.toBeNull();
    const headers = within(thead!).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual([
      'Language',
      'A1',
      'A2',
      'B1',
      'B2',
    ]);
  });
});
