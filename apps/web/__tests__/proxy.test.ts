import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { isPublicRoute } from '../proxy';

function req(path: string) {
  return new NextRequest(new URL(path, 'https://langdrill.app'));
}

describe('isPublicRoute', () => {
  it('treats the public try surface as public', () => {
    expect(isPublicRoute(req('/try/conjugation'))).toBe(true);
    expect(isPublicRoute(req('/try/conjugation?lang=TR&level=B1'))).toBe(true);
  });

  it('keeps the existing public pages public', () => {
    expect(isPublicRoute(req('/'))).toBe(true);
    expect(isPublicRoute(req('/privacy'))).toBe(true);
  });

  it('still protects the dashboard', () => {
    expect(isPublicRoute(req('/home'))).toBe(false);
    expect(isPublicRoute(req('/drill'))).toBe(false);
  });
});
