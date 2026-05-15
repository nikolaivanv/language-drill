import { redirect } from 'next/navigation';
import {
  TheoryCoverageResponseSchema,
  type TheoryCoverageResponse,
  type TheoryCoverageRow,
} from '@language-drill/api-client';
import { apiFetch } from '../../../../lib/api-server';

const LANGUAGES = ['ES', 'DE', 'TR'] as const;
const LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;

export default async function AdminTheoryPage() {
  const res = await apiFetch('/admin/theory/coverage');

  if (res.status === 403) {
    redirect('/');
  }

  let raw: unknown;
  let parseError: string | null = null;
  try {
    raw = await res.json();
  } catch (err) {
    parseError = err instanceof Error ? err.message : 'Invalid JSON';
  }

  const parsed = parseError
    ? null
    : TheoryCoverageResponseSchema.safeParse(raw);

  if (!res.ok || parseError || !parsed || !parsed.success) {
    const message = parseError ?? (parsed && !parsed.success ? parsed.error.message : `HTTP ${res.status}`);
    return (
      <div>
        <h1>Theory Coverage</h1>
        <p className="text-red-600">Failed to load: {message}</p>
      </div>
    );
  }

  const { rows }: TheoryCoverageResponse = parsed.data;
  const byKey = new Map<string, TheoryCoverageRow>();
  for (const row of rows) {
    byKey.set(`${row.language}:${row.level}`, row);
  }

  return (
    <div>
      <h1>Theory Coverage</h1>
      <table>
        <thead>
          <tr>
            <th>Language</th>
            {LEVELS.map((level) => (
              <th key={level}>{level}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LANGUAGES.map((language) => (
            <tr key={language}>
              <td>{language}</td>
              {LEVELS.map((level) => (
                <Cell key={level} row={byKey.get(`${language}:${level}`)} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ row }: { row: TheoryCoverageRow | undefined }) {
  if (!row || row.total === 0) {
    return <td>—</td>;
  }
  const { approved, flagged, total } = row;
  let badge: string;
  let bgClass: string;
  if (approved === total) {
    badge = '✓';
    bgClass = 'bg-green-100';
  } else if (approved > 0) {
    badge = '⚠';
    bgClass = 'bg-amber-100';
  } else {
    badge = '✗';
    bgClass = 'bg-red-100';
  }
  return (
    <td className={bgClass}>
      {approved}/{total} {badge}
      {flagged > 0 && <span className="t-micro"> +{flagged} flagged</span>}
    </td>
  );
}
