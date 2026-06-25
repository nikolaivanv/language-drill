'use client';

// ---------------------------------------------------------------------------
// SkillSnapshotGrid + EmptySnapshotCard — the dashboard's skill section
// ---------------------------------------------------------------------------
// Self-contained: section header (eyebrow + title + ghost button to /progress)
// + one of four bodies (skeleton / error card / empty card / 6-row grid).
// ---------------------------------------------------------------------------

import Link from 'next/link';
import type { ProgressRadarResponse } from '@language-drill/api-client';
import {
  LANGUAGE_NAMES,
  type LearningLanguage,
} from '@language-drill/shared';
import { Button, Card } from '../../../components/ui';
import { SkillRow } from './skill-row';

type GridProps = {
  data: ProgressRadarResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  language: LearningLanguage;
};

export function SkillSnapshotGrid({
  data,
  isLoading,
  error,
  onRetry,
  language,
}: GridProps) {
  return (
    <section className="space-y-s-4">
      <SectionHeader language={language} />

      {isLoading && <GridSkeleton />}

      {!isLoading && error && (
        <Card padding="lg">
          <div className="space-y-s-4">
            <p className="t-body-l">{error.message}</p>
            <Button variant="default" size="md" onClick={onRetry}>
              retry
            </Button>
          </div>
        </Card>
      )}

      {!isLoading && !error && data && isEmpty(data) && (
        <EmptySnapshotCard language={language} />
      )}

      {!isLoading && !error && data && !isEmpty(data) && (
        <div className="grid grid-cols-2 mobile:grid-cols-1 gap-x-s-7 gap-y-s-4">
          {(() => {
            const trained = data.axes
              .filter((a) => a.evidenceCount > 0)
              .sort(
                (a, b) =>
                  a.currentMastery - b.currentMastery ||
                  a.key.localeCompare(b.key),
              );
            const notStarted = data.axes.filter((a) => a.evidenceCount === 0);
            return (
              <>
                {trained.map((a) => (
                  <SkillRow key={a.key} axis={a} />
                ))}
                {notStarted.length > 0 && (
                  <p className="t-micro text-ink-soft mt-s-2 col-span-2 mobile:col-span-1">
                    not started yet ·{' '}
                    {notStarted.map((a) => a.label.toLowerCase()).join(' · ')}
                  </p>
                )}
              </>
            );
          })()}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// EmptySnapshotCard — exported for reuse by the page-level test fixtures
// ---------------------------------------------------------------------------

type EmptyProps = { language: LearningLanguage };

export function EmptySnapshotCard({ language: _language }: EmptyProps) {
  return (
    <Card padding="lg">
      <div className="space-y-s-4">
        <p className="t-body-l">
          practice a few exercises and your skill snapshot will appear here.
        </p>
        <Button
          variant="primary"
          size="md"
          href="/drill?start=quick"
        >
          start a session →
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function SectionHeader({ language }: { language: LearningLanguage }) {
  // Per Req 5.1 + prototype: "your <language>" uses the human-readable name
  // (e.g. "spanish"), not the enum code "es".
  const languageName = LANGUAGE_NAMES[language].toLowerCase();
  return (
    <div className="flex items-baseline justify-between gap-s-4">
      <div>
        <p className="t-micro">your {languageName}</p>
        <h2 className="t-display-m mt-s-1">skill snapshot</h2>
      </div>
      <Link href="/progress" className="link-arrow">
        see full progress →
      </Link>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div
      className="grid grid-cols-2 mobile:grid-cols-1 gap-x-s-7 gap-y-s-4"
      aria-hidden
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="h-[34px] animate-pulse rounded-r-sm bg-paper-2"
        />
      ))}
    </div>
  );
}

function isEmpty(data: ProgressRadarResponse): boolean {
  return data.axes.every((a) => a.evidenceCount === 0);
}

