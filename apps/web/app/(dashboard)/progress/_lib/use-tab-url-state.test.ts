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
  it("defaults to 'map' when ?tab is absent", () => {
    const { result } = renderHook(() => useTabUrlState());
    expect(result.current.tab).toBe('map');
  });

  it("returns 'fluency' when ?tab=fluency", () => {
    mockSearchParams = new URLSearchParams('tab=fluency');
    const { result } = renderHook(() => useTabUrlState());
    expect(result.current.tab).toBe('fluency');
  });

  it("returns 'words' when ?tab=words", () => {
    mockSearchParams = new URLSearchParams('tab=words');
    const { result } = renderHook(() => useTabUrlState());
    expect(result.current.tab).toBe('words');
  });

  it("returns 'history' when ?tab=history", () => {
    mockSearchParams = new URLSearchParams('tab=history');
    const { result } = renderHook(() => useTabUrlState());
    expect(result.current.tab).toBe('history');
  });

  it("falls back to 'map' on an unknown ?tab value (including legacy 'heatmap')", () => {
    mockSearchParams = new URLSearchParams('tab=garbage');
    const { result } = renderHook(() => useTabUrlState());
    expect(result.current.tab).toBe('map');
  });

  it("falls back to 'map' when ?tab=heatmap (stale URL)", () => {
    mockSearchParams = new URLSearchParams('tab=heatmap');
    const { result } = renderHook(() => useTabUrlState());
    expect(result.current.tab).toBe('map');
  });

  it('calls router.replace with the new ?tab when setTab is invoked', () => {
    const { result } = renderHook(() => useTabUrlState());

    act(() => {
      result.current.setTab('fluency');
    });
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('?tab=fluency', { scroll: false });

    act(() => {
      result.current.setTab('history');
    });
    expect(mockReplace).toHaveBeenLastCalledWith('?tab=history', {
      scroll: false,
    });
  });
});
