import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/nextjs';

import { REDACTED_KEYS, REDACTED_VALUE, beforeSend } from '../before-send';

function makeEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return { event_id: 'evt_test', ...overrides } as ErrorEvent;
}

describe('beforeSend — REDACTED_KEYS coverage', () => {
  for (const key of REDACTED_KEYS) {
    it(`redacts "${key}" in event.extra`, () => {
      const event = makeEvent({ extra: { [key]: 'secret learner content' } });
      const result = beforeSend(event)!;
      expect((result.extra as Record<string, unknown>)[key]).toBe(REDACTED_VALUE);
    });

    it(`redacts "${key}" in event.contexts.app`, () => {
      const event = makeEvent({
        contexts: { app: { [key]: 'secret learner content' } },
      });
      const result = beforeSend(event)!;
      const app = (result.contexts as Record<string, Record<string, unknown>>).app;
      expect(app[key]).toBe(REDACTED_VALUE);
    });

    it(`redacts "${key}" in event.request.data`, () => {
      const event = makeEvent({
        request: { data: { [key]: 'secret learner content' } },
      });
      const result = beforeSend(event)!;
      const data = result.request!.data as Record<string, unknown>;
      expect(data[key]).toBe(REDACTED_VALUE);
    });
  }
});

describe('beforeSend — case-insensitive matching', () => {
  it.each([
    ['Answer', 'answer'],
    ['USERANSWER', 'useranswer'],
    ['Transcript', 'transcript'],
    ['FreeWriting', 'freewriting'],
  ])('redacts "%s" (lower-cases to "%s")', (key) => {
    const event = makeEvent({ extra: { [key]: 'secret' } });
    const result = beforeSend(event)!;
    expect((result.extra as Record<string, unknown>)[key]).toBe(REDACTED_VALUE);
  });
});

describe('beforeSend — benign keys preserved', () => {
  it.each(['responseTime', 'apiResponse', 'answerLength', 'submissionId'])(
    'does NOT redact "%s"',
    (key) => {
      const event = makeEvent({ extra: { [key]: 42 } });
      const result = beforeSend(event)!;
      expect((result.extra as Record<string, unknown>)[key]).toBe(42);
    },
  );
});

describe('beforeSend — URL query stripping', () => {
  it('strips request.url query values, preserving keys', () => {
    const event = makeEvent({
      request: { url: 'https://example.com/foo?id=abc123&token=secret' },
    });
    const result = beforeSend(event)!;
    expect(result.request!.url).toBe('https://example.com/foo?id=&token=');
  });

  it('preserves URLs without a query string', () => {
    const event = makeEvent({ request: { url: 'https://example.com/foo' } });
    const result = beforeSend(event)!;
    expect(result.request!.url).toBe('https://example.com/foo');
  });

  it('preserves URL fragments after stripping query', () => {
    const event = makeEvent({
      request: { url: '/foo?a=1&b=2#anchor' },
    });
    const result = beforeSend(event)!;
    expect(result.request!.url).toBe('/foo?a=&b=#anchor');
  });

  it('strips request.query_string when a raw string', () => {
    const event = makeEvent({
      request: { query_string: 'id=abc&token=secret' },
    });
    const result = beforeSend(event)!;
    expect(result.request!.query_string).toBe('id=&token=');
  });

  it('strips request.query_string when an object', () => {
    const event = makeEvent({
      request: { query_string: { id: 'abc', token: 'secret' } as unknown as string },
    });
    const result = beforeSend(event)!;
    expect(result.request!.query_string).toEqual({ id: '', token: '' });
  });
});

describe('beforeSend — breadcrumb URL stripping', () => {
  it('strips query values from fetch breadcrumb URLs', () => {
    const event = makeEvent({
      breadcrumbs: [
        {
          category: 'fetch',
          data: { url: '/api/exercises?id=abc&user=u_123', method: 'GET' },
        },
      ],
    });
    const result = beforeSend(event)!;
    const data = result.breadcrumbs![0].data as Record<string, unknown>;
    expect(data.url).toBe('/api/exercises?id=&user=');
    expect(data.method).toBe('GET');
  });

  it('strips query values from xhr breadcrumb URLs', () => {
    const event = makeEvent({
      breadcrumbs: [
        { category: 'xhr', data: { url: '/api/foo?key=value' } },
      ],
    });
    const result = beforeSend(event)!;
    const data = result.breadcrumbs![0].data as Record<string, unknown>;
    expect(data.url).toBe('/api/foo?key=');
  });

  it('leaves navigation breadcrumb URLs untouched', () => {
    const event = makeEvent({
      breadcrumbs: [
        {
          category: 'navigation',
          data: { from: '/a?x=1', to: '/b?y=2' },
        },
      ],
    });
    const result = beforeSend(event)!;
    const data = result.breadcrumbs![0].data as Record<string, unknown>;
    expect(data.from).toBe('/a?x=1');
    expect(data.to).toBe('/b?y=2');
  });
});

describe('beforeSend — event without matching keys', () => {
  it('returns the event unchanged', () => {
    const event = makeEvent({
      extra: { foo: 'bar', count: 1 },
      contexts: { app: { name: 'language-drill' } },
    });
    const result = beforeSend(event)!;
    expect(result.extra).toEqual({ foo: 'bar', count: 1 });
    expect(result.contexts).toEqual({ app: { name: 'language-drill' } });
  });
});

describe('beforeSend — internal failure safety', () => {
  it('returns the original event when redaction throws internally', () => {
    const event = makeEvent();
    // Make reading event.extra throw — beforeSend should swallow and return the event.
    Object.defineProperty(event, 'extra', {
      get() {
        throw new Error('boom');
      },
      configurable: true,
    });
    expect(() => beforeSend(event)).not.toThrow();
    expect(beforeSend(event)).toBe(event);
  });
});
