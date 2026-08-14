'use client';

import { useState } from 'react';

/**
 * The mechanism vocabulary, in the panel rather than in CLAUDE.md. Static —
 * not generated, not fetched.
 */
export function DiversityGlossary() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-rule bg-paper-2 p-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-[12px] font-semibold uppercase tracking-wide text-ink-mute"
      >
        {open ? '▾' : '▸'} What these mechanisms do
      </button>
      {open && (
        <dl className="mt-2 flex flex-col gap-2 text-[12px] text-ink-soft">
          <div>
            <dt className="font-medium text-ink">Coverage axis</dt>
            <dd>
              A categorical dimension the validator records for every approved
              exercise (person, polarity, case…). An axis marked <code>*</code>{' '}
              is <em>controlled</em>: the point&apos;s <code>coverageSpec</code>{' '}
              declares a minimum count per value, and the scheduler steers drafts
              toward the values that are short. An unmarked axis is only
              monitored.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Construction variant</dt>
            <dd>
              A named sub-construction of a multi-construction point. Without
              them the generator collapses onto the most prototypical member.
              Each approved row records the variant it realizes in{' '}
              <code>content_json.seedWord</code>; the quota is that variant&apos;s
              fair share of the labelled rows, weighted by its declared share.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Seed source</dt>
            <dd>
              What each draft rotates over so the pool varies. Precedence:
              construction variants, then a curated pool (self-revealing target
              forms, predicate nominals, paraphrase scenarios), otherwise the
              frequency band from the vocabulary table. A curated pool is{' '}
              <strong>bounded</strong> — once the live pool covers every entry,
              seeding returns nothing and the cell silently stops generating.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Why &ldquo;at target&rdquo; is a problem</dt>
            <dd>
              The scheduler tops a cell up to its target. A cell already at
              target has no deficit, so it is never revisited — and its declared
              floors never fire, however loudly they are declared. Fixing that
              needs <code>pnpm demote:pool</code> to open headroom first.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">✗ versus ⚠</dt>
            <dd>
              <strong>✗</strong> means the denominator proves absence: every row
              in the cell is tagged (or carries a declared variant id) and the
              value is still below its declared floor (zero, for a construction
              variant). <strong>⚠</strong> means rows remain untagged or
              unlabelled, so a below-floor value may be a measurement gap rather
              than missing content. Demoting on a ⚠ destroys sound rows.
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
