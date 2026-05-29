import { LANGUAGE_NAMES, type LearningLanguage } from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';

// Shared frame for the non-list states so they sit consistently in the page.
function StateFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="theory-list-state"
      style={{
        margin: '24px 0',
        padding: 32,
        textAlign: 'center',
        background: 'var(--card)',
        border: '1px dashed var(--rule)',
        borderRadius: 'var(--r-lg)',
      }}
    >
      {children}
    </div>
  );
}

/** Topic list is loading (Requirement 2.5). */
export function TheoryListLoading() {
  return (
    <StateFrame>
      <span className="t-small" role="status">
        loading theory…
      </span>
    </StateFrame>
  );
}

/** Topic list fetch failed; offers a retry (Requirement 2.5). */
export function TheoryListError({ onRetry }: { onRetry: () => void }) {
  return (
    <StateFrame>
      <div className="t-body" style={{ fontWeight: 500 }}>
        couldn&apos;t load theory
      </div>
      <Button variant="primary" size="sm" style={{ marginTop: 12 }} onClick={onRetry}>
        try again
      </Button>
    </StateFrame>
  );
}

/** Active language has zero approved topics (Requirement 2.4). */
export function TheoryEmptyLanguage({ language }: { language: LearningLanguage }) {
  return (
    <StateFrame>
      <div className="t-body" style={{ fontWeight: 500 }}>
        no topics yet for {LANGUAGE_NAMES[language]}
      </div>
      <p className="t-small" style={{ marginTop: 6 }}>
        theory for this language is on its way — check back soon.
      </p>
    </StateFrame>
  );
}

/** Search matched nothing; offers a one-tap clear (Requirement 5.4). */
export function TheoryNoResults({
  query,
  onClear,
}: {
  query: string;
  onClear: () => void;
}) {
  return (
    <StateFrame>
      <div className="t-body" style={{ fontWeight: 500 }}>
        no topics match &ldquo;{query}&rdquo;
      </div>
      <Button variant="default" size="sm" style={{ marginTop: 12 }} onClick={onClear}>
        clear search
      </Button>
    </StateFrame>
  );
}
