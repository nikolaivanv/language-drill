import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { isPublicRoute } from '../proxy';

function req(path: string) {
  return new NextRequest(new URL(path, 'https://langdrill.app'));
}

describe('isPublicRoute', () => {
  it('treats the public try surface as public', () => {
    expect(isPublicRoute(req('/try'))).toBe(true);
    expect(isPublicRoute(req('/try/conjugation'))).toBe(true);
    expect(isPublicRoute(req('/try/conjugation?lang=TR&level=B1'))).toBe(true);
  });

  it('does not treat a sibling of /try as public', () => {
    // Pins the `:path*` form (matches on path-segment boundaries) over the
    // deprecated `(.*)` form, which would also match `/trybeta`, `/try-pro`, etc.
    expect(isPublicRoute(req('/tryadmin'))).toBe(false);
  });

  it('keeps the existing public pages public', () => {
    expect(isPublicRoute(req('/'))).toBe(true);
    expect(isPublicRoute(req('/privacy'))).toBe(true);
  });

  it('still protects the dashboard', () => {
    expect(isPublicRoute(req('/home'))).toBe(false);
    expect(isPublicRoute(req('/drill'))).toBe(false);
  });

  // The landing pages are the public entry points. A missing entry here does
  // not fail a build or a type check — it silently redirects the whole feature
  // to sign-in, which is why this list is asserted at all.
  it('treats every language landing page as public', () => {
    expect(isPublicRoute(req('/spanish'))).toBe(true);
    expect(isPublicRoute(req('/german'))).toBe(true);
    expect(isPublicRoute(req('/turkish'))).toBe(true);
  });

  it('does not make sibling paths public by accident', () => {
    expect(isPublicRoute(req('/spanishx'))).toBe(false);
    expect(isPublicRoute(req('/germany'))).toBe(false);
  });
});
