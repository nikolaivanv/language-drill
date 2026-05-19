import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';

export const REDACTED_VALUE = '[redacted]';

// Exact-match (case-insensitive, lower-cased here) on object keys. Substring
// matching would catch benign names like `responseTime` / `apiResponse`.
export const REDACTED_KEYS: ReadonlySet<string> = new Set([
  'answer',
  'answers',
  'useranswer',
  'response',
  'submission',
  'submissions',
  'transcript',
  'passage',
  'usertext',
  'writtentext',
  'freewriting',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactObject);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (REDACTED_KEYS.has(key.toLowerCase())) {
        out[key] = REDACTED_VALUE;
      } else {
        out[key] = redactObject(val);
      }
    }
    return out;
  }
  return value;
}

function redactUrlQuery(url: string): string {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) return url;
  const base = url.slice(0, queryIndex);
  const rest = url.slice(queryIndex + 1);
  const hashIndex = rest.indexOf('#');
  const queryPart = hashIndex === -1 ? rest : rest.slice(0, hashIndex);
  const hashPart = hashIndex === -1 ? '' : rest.slice(hashIndex);
  const sanitized = queryPart
    .split('&')
    .map((pair) => {
      const eqIndex = pair.indexOf('=');
      return eqIndex === -1 ? pair : `${pair.slice(0, eqIndex)}=`;
    })
    .join('&');
  return `${base}?${sanitized}${hashPart}`;
}

function redactBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.category !== 'fetch' && breadcrumb.category !== 'xhr') {
    return breadcrumb;
  }
  const data = breadcrumb.data;
  if (!isPlainObject(data)) return breadcrumb;
  const url = data.url;
  if (typeof url !== 'string') return breadcrumb;
  return {
    ...breadcrumb,
    data: { ...data, url: redactUrlQuery(url) },
  };
}

export function beforeSend(event: ErrorEvent): ErrorEvent | null {
  try {
    if (event.extra) {
      event.extra = redactObject(event.extra) as ErrorEvent['extra'];
    }
    if (event.contexts) {
      event.contexts = redactObject(event.contexts) as ErrorEvent['contexts'];
    }
    if (event.request) {
      if (event.request.data !== undefined) {
        event.request.data = redactObject(event.request.data);
      }
      if (typeof event.request.url === 'string') {
        event.request.url = redactUrlQuery(event.request.url);
      }
      const qs = event.request.query_string;
      if (typeof qs === 'string') {
        event.request.query_string = redactUrlQuery(`?${qs}`).slice(1);
      } else if (isPlainObject(qs)) {
        const stripped: Record<string, string> = {};
        for (const k of Object.keys(qs)) stripped[k] = '';
        event.request.query_string =
          stripped as unknown as typeof event.request.query_string;
      }
    }
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs.map(redactBreadcrumb);
    }
    return event;
  } catch {
    return event;
  }
}
