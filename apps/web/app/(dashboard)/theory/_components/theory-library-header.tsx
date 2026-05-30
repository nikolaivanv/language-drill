type TheoryLibraryHeaderProps = {
  /** Total approved topics for the active language (not the filtered count). */
  topicCount: number;
};

/**
 * Index page header: eyebrow with the topic count, the "theory library." title,
 * and a one-line intro. The count is the full language total (Requirement 2.6),
 * independent of any active search.
 */
export function TheoryLibraryHeader({ topicCount }: TheoryLibraryHeaderProps) {
  return (
    <header className="theory-library-header">
      <div className="t-micro">
        grammar reference · {topicCount} {topicCount === 1 ? 'topic' : 'topics'}
      </div>
      <h1 className="t-display-xl" style={{ margin: '4px 0 0' }}>
        theory library.
      </h1>
      <p className="t-body-l" style={{ marginTop: 8, maxWidth: 680 }}>
        everything we drill, on its own. browse, sort, or search.
      </p>
    </header>
  );
}
