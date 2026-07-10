import { Button } from '../../../../components/ui/button';

// Shared frame for the non-list states so they sit consistently in the page
// (mirrors theory-list-states.tsx's StateFrame).
function StateFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="vocab-list-state"
      style={{
        margin: '24px 0',
        padding: 32,
        textAlign: 'center',
        background: 'var(--color-card)',
        border: '1px dashed var(--color-rule)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      {children}
    </div>
  );
}

/** Topic list is loading. */
export function VocabListLoading() {
  return (
    <StateFrame>
      <span className="t-small" role="status">
        loading vocabulary…
      </span>
    </StateFrame>
  );
}

/** Topic list fetch failed; offers a retry. */
export function VocabListError({ onRetry }: { onRetry: () => void }) {
  return (
    <StateFrame>
      <div className="t-body" style={{ fontWeight: 500 }}>
        couldn&apos;t load vocabulary
      </div>
      <Button variant="primary" size="sm" style={{ marginTop: 12 }} onClick={onRetry}>
        try again
      </Button>
    </StateFrame>
  );
}

/** Active language has zero vocab topics. */
export function VocabEmpty() {
  return (
    <StateFrame>
      <div className="t-body" style={{ fontWeight: 500 }}>
        no vocab topics for this language yet
      </div>
      <p className="t-small" style={{ marginTop: 6 }}>
        vocabulary coverage for this language is on its way — check back soon.
      </p>
    </StateFrame>
  );
}
