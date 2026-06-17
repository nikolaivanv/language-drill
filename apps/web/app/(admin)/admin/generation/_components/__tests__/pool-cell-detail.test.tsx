import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PoolStatusItem } from '@language-drill/api-client';

const mockUsePoolCell = vi.fn();
const mockGenerateMutateAsync = vi.fn();
const mockUseGenerateCell = vi.fn((_args?: unknown) => ({ mutateAsync: mockGenerateMutateAsync, isPending: false }));
const mockRevalidateMutateAsync = vi.fn();
const mockUseRevalidateCell = vi.fn((_args?: unknown) => ({ mutateAsync: mockRevalidateMutateAsync, isPending: false }));
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return {
    ...actual,
    usePoolCell: (args: unknown) => mockUsePoolCell(args),
    useGenerateCell: (args: unknown) => mockUseGenerateCell(args),
    useRevalidateCell: (args: unknown) => mockUseRevalidateCell(args),
  };
});

import { PoolCellDetail } from '../pool-cell-detail';

const item: PoolStatusItem = {
  language: 'ES', level: 'B1', type: 'cloze', grammarPointKey: 'es-b1-present-subjunctive',
  approved: 12, flagged: 1, rejected: 4, lastRefilledAt: '2026-06-01T00:00:00.000Z',
  depletionRate7d: 4.1, targetSize: 75, generationTarget: 30,
  coverageDistribution: { person: { '3sg': 8, '2pl': 1 } },
};
const fetchFn = vi.fn();

describe('PoolCellDetail', () => {
  beforeEach(() => {
    mockUseGenerateCell.mockReturnValue({ mutateAsync: mockGenerateMutateAsync, isPending: false });
    mockUseRevalidateCell.mockReturnValue({ mutateAsync: mockRevalidateMutateAsync, isPending: false });
  });

  it('renders diversity vs floors, flagging below-floor values', () => {
    mockUsePoolCell.mockReturnValue({
      isLoading: false, isError: false,
      data: { floors: { person: { '3sg': 5, '2pl': 2 } }, rejectionReasonCounts: {} },
    });
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    expect(screen.getByTestId('axis-person-3sg').textContent).toMatch(/3sg 8\/5/);
    const belowFloor = screen.getByTestId('axis-person-2pl');
    expect(belowFloor.textContent).toMatch(/2pl 1\/2/);
    expect(belowFloor.textContent).toMatch(/✗/);
  });

  it('renders rejection-reason chips and the numbers line', () => {
    mockUsePoolCell.mockReturnValue({
      isLoading: false, isError: false,
      data: { floors: {}, rejectionReasonCounts: { 'low-quality-reject': 6, ambiguous: 2 } },
    });
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    expect(screen.getByText(/: 6/)).toBeInTheDocument();
    expect(screen.getByText(/target 30/)).toBeInTheDocument();
  });

  it('renders the content-browser link with the cell query', () => {
    mockUsePoolCell.mockReturnValue({ isLoading: false, isError: false, data: { floors: {}, rejectionReasonCounts: {} } });
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    const link = screen.getByRole('link', { name: /approved exercises/i });
    expect(link).toHaveAttribute('href', '/admin/content?language=ES&level=B1&type=cloze&grammarPoint=es-b1-present-subjunctive');
  });

  it('renders a Langfuse traces link when the template env is set', () => {
    vi.stubEnv('NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE', 'https://lf/traces?q={cellKey}');
    mockUsePoolCell.mockReturnValue({ isLoading: false, isError: false, data: { floors: {}, rejectionReasonCounts: {} } });
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    expect(screen.getByRole('link', { name: /traces in langfuse/i }))
      .toHaveAttribute('href', 'https://lf/traces?q=es%3Ab1%3Acloze%3Aes-b1-present-subjunctive');
    vi.unstubAllEnvs();
  });

  it('omits the Langfuse link when the template env is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE', '');
    mockUsePoolCell.mockReturnValue({ isLoading: false, isError: false, data: { floors: {}, rejectionReasonCounts: {} } });
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    expect(screen.queryByRole('link', { name: /traces in langfuse/i })).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it('shows a loading state', () => {
    mockUsePoolCell.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows an error state', () => {
    mockUsePoolCell.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });
});

describe('PoolCellDetail — refill', () => {
  beforeEach(() => {
    mockUsePoolCell.mockReturnValue({ isLoading: false, isError: false, data: { floors: {}, rejectionReasonCounts: {} } });
    mockGenerateMutateAsync.mockReset();
    mockUseGenerateCell.mockReturnValue({ mutateAsync: mockGenerateMutateAsync, isPending: false });
  });

  it('defaults the count to the gap (generationTarget - approved)', () => {
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    expect((screen.getByLabelText(/refill count/i) as HTMLInputElement).value).toBe('18');
  });

  it('does not generate when the confirm is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /refill/i }));
    expect(mockGenerateMutateAsync).not.toHaveBeenCalled();
  });

  it('queues a job and shows the queued message on success', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockGenerateMutateAsync.mockResolvedValue({ jobId: 'abcdef12-3456', status: 'queued' });
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /refill/i }));
    expect(mockGenerateMutateAsync).toHaveBeenCalledWith({
      language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 18,
    });
    expect(await screen.findByText(/queued \(job abcdef12\)/i)).toBeInTheDocument();
  });

  it('shows the in-progress message on a 409', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockGenerateMutateAsync.mockRejectedValue(Object.assign(new Error('x'), { status: 409 }));
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /refill/i }));
    expect(await screen.findByText(/already in progress/i)).toBeInTheDocument();
  });

  it('shows a generic failure message on a non-409 error', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockGenerateMutateAsync.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /refill/i }));
    expect(await screen.findByText(/failed to queue generation/i)).toBeInTheDocument();
  });
});

const previewSummary = {
  apply: false, scanned: 3, noChange: 2, demotedToFlagged: 1, demotedToRejected: 0,
  skipped: 0, skipReasons: {}, estCostUsd: 0.02, truncated: false, totalCandidates: 3,
  demotions: [{ id: 'e1', from: 'auto-approved', to: 'flagged', reasons: ['Ambiguous'] }],
};

describe('PoolCellDetail — revalidate', () => {
  beforeEach(() => {
    mockUsePoolCell.mockReturnValue({ isLoading: false, isError: false, data: { floors: {}, rejectionReasonCounts: {} } });
    mockGenerateMutateAsync.mockReset();
    mockRevalidateMutateAsync.mockReset();
    mockUseGenerateCell.mockReturnValue({ mutateAsync: mockGenerateMutateAsync, isPending: false });
    mockUseRevalidateCell.mockReturnValue({ mutateAsync: mockRevalidateMutateAsync, isPending: false });
  });

  it('previews (apply:false) and renders the dry-run summary', async () => {
    mockRevalidateMutateAsync.mockResolvedValue(previewSummary);
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /^preview$/i }));
    expect(mockRevalidateMutateAsync).toHaveBeenCalledWith({
      language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', apply: false,
    });
    const summary = await screen.findByText(/would demote/i);
    expect(summary.textContent).toMatch(/scanned 3/);
    expect(summary.textContent).toMatch(/flagged 1/);
    expect(summary.textContent).toMatch(/0\.02/);
  });

  it('disables Apply until a preview with demotions, then enables it', async () => {
    mockRevalidateMutateAsync.mockResolvedValue(previewSummary);
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^preview$/i }));
    await screen.findByText(/would demote/i);
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeEnabled();
  });

  it('applies (apply:true) after confirm and shows the applied summary', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockRevalidateMutateAsync.mockResolvedValueOnce(previewSummary);
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /^preview$/i }));
    await screen.findByText(/would demote/i);

    mockRevalidateMutateAsync.mockResolvedValueOnce({ ...previewSummary, apply: true });
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(mockRevalidateMutateAsync).toHaveBeenLastCalledWith({
      language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', apply: true,
    });
    expect(await screen.findByText(/applied:/i)).toBeInTheDocument();
  });

  it('shows a truncation note mentioning revalidate:cloze and the total', async () => {
    mockRevalidateMutateAsync.mockResolvedValue({ ...previewSummary, truncated: true, totalCandidates: 120 });
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /^preview$/i }));
    const note = await screen.findByText(/revalidate:cloze/i);
    expect(note.textContent).toMatch(/120/);
  });
});
