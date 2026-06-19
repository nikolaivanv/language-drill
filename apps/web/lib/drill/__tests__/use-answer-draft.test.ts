import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnswerDraft } from '../use-answer-draft';

const KEY = (id: string) => `drill:draft:${id}`;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('useAnswerDraft', () => {
  it('starts empty when there is no stored draft', () => {
    const { result } = renderHook(() => useAnswerDraft('ex-1'));
    expect(result.current[0]).toBe('');
  });

  it('initializes from the stored draft for that exercise id', () => {
    window.sessionStorage.setItem(KEY('ex-1'), 'çantan');
    const { result } = renderHook(() => useAnswerDraft('ex-1'));
    expect(result.current[0]).toBe('çantan');
  });

  it('persists the value to sessionStorage under the namespaced key', () => {
    const { result } = renderHook(() => useAnswerDraft('ex-1'));
    act(() => result.current[1]('como'));
    expect(result.current[0]).toBe('como');
    expect(window.sessionStorage.getItem(KEY('ex-1'))).toBe('como');
  });

  it('removes the stored draft when the value becomes empty', () => {
    window.sessionStorage.setItem(KEY('ex-1'), 'como');
    const { result } = renderHook(() => useAnswerDraft('ex-1'));
    act(() => result.current[1](''));
    expect(window.sessionStorage.getItem(KEY('ex-1'))).toBeNull();
  });

  it('keeps drafts isolated per exercise id', () => {
    const a = renderHook(() => useAnswerDraft('ex-a'));
    act(() => a.result.current[1]('answer-a'));
    const b = renderHook(() => useAnswerDraft('ex-b'));
    expect(b.result.current[0]).toBe('');
    expect(window.sessionStorage.getItem(KEY('ex-a'))).toBe('answer-a');
  });

  it('clearDraft removes storage but leaves the in-memory value intact', () => {
    const { result } = renderHook(() => useAnswerDraft('ex-1'));
    act(() => result.current[1]('comes'));
    act(() => result.current[2]());
    // Storage cleared so a reload would not restore it...
    expect(window.sessionStorage.getItem(KEY('ex-1'))).toBeNull();
    // ...but the locked input still shows what was typed.
    expect(result.current[0]).toBe('comes');
  });

  it('does not persist when no exercise id is provided (ephemeral fallback)', () => {
    const { result } = renderHook(() => useAnswerDraft(undefined));
    act(() => result.current[1]('typed'));
    expect(result.current[0]).toBe('typed');
    expect(window.sessionStorage.length).toBe(0);
  });

  it('degrades gracefully when sessionStorage throws (private mode / quota)', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
    const { result } = renderHook(() => useAnswerDraft('ex-1'));
    expect(() => act(() => result.current[1]('x'))).not.toThrow();
    expect(result.current[0]).toBe('x');
    spy.mockRestore();
  });
});
