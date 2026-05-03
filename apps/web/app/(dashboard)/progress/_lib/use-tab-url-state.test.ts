import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTabUrlState } from './use-tab-url-state';

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

beforeEach(() => {
  mockReplace.mockClear();
  mockSearchParams = new URLSearchParams();
});

describe('useTabUrlState', () => {
  it("defaults to 'shape' when ?tab is absent", () => {
    const { result } = renderHook(() => useTabUrlState());
    expect(result.current.tab).toBe('shape');
  });

  it("returns 'heatmap' when ?tab=heatmap", () => {
    mockSearchParams = new URLSearchParams('tab=heatmap');
    const { result } = renderHook(() => useTabUrlState());
    expect(result.current.tab).toBe('heatmap');
  });

  it("returns 'history' when ?tab=history", () => {
    mockSearchParams = new URLSearchParams('tab=history');
    const { result } = renderHook(() => useTabUrlState());
    expect(result.current.tab).toBe('history');
  });

  it("falls back to 'shape' on an unknown ?tab value", () => {
    mockSearchParams = new URLSearchParams('tab=garbage');
    const { result } = renderHook(() => useTabUrlState());
    expect(result.current.tab).toBe('shape');
  });

  it('calls router.replace with the new ?tab when setTab is invoked', () => {
    const { result } = renderHook(() => useTabUrlState());

    act(() => {
      result.current.setTab('heatmap');
    });
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('?tab=heatmap', { scroll: false });

    act(() => {
      result.current.setTab('history');
    });
    expect(mockReplace).toHaveBeenLastCalledWith('?tab=history', {
      scroll: false,
    });
  });
});
