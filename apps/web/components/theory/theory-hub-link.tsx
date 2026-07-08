import Link from 'next/link';

type TheoryHubLinkProps = {
  topicId: string;
  /** Human title for the accessible name; falls back to topicId. */
  title?: string;
};

function OpenInNewTabIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="theory-hub-link-icon"
    >
      <path d="M10 2h4v4" />
      <path d="M6 10l8-8" />
      <path d="M13 9v5H3V5h5" />
    </svg>
  );
}

/**
 * Opens the same theory topic on the full-page theory hub in a new tab.
 * Used from the in-drill panel so learners can keep drilling while reading.
 */
export function TheoryHubLink({ topicId, title }: TheoryHubLinkProps) {
  const label = title ?? topicId;

  return (
    <Link
      href={`/theory/${encodeURIComponent(topicId)}`}
      target="_blank"
      rel="noreferrer noopener"
      className="theory-hub-link"
      aria-label={`open ${label} in theory hub (new tab)`}
    >
      <span className="theory-hub-link-label">open in new tab</span>
      <OpenInNewTabIcon />
    </Link>
  );
}
