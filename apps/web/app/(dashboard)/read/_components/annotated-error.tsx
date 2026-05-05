// ---------------------------------------------------------------------------
// AnnotatedError — inline error card for failed annotation attempts
// ---------------------------------------------------------------------------
// Heading "couldn't annotate this", server-supplied body, and two ghost
// buttons. "try again" is disabled for the rate-limit kind so the user
// cannot mash through the daily cap (Requirement 11.4).
// ---------------------------------------------------------------------------

import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';

export type AnnotatedErrorKind =
  | 'rateLimit'
  | 'unsupported'
  | 'aiUnavailable'
  | 'validation'
  | 'other';

type Props = {
  body: string;
  kind: AnnotatedErrorKind;
  onEditText: () => void;
  onTryAgain: () => void;
};

export function AnnotatedError({
  body,
  kind,
  onEditText,
  onTryAgain,
}: Props) {
  const tryAgainDisabled = kind === 'rateLimit';
  return (
    <Card padding="lg" className="bg-paper-2">
      <div className="t-display-s">couldn&apos;t annotate this</div>
      <p className="t-body text-ink-2 mt-[8px]">{body}</p>
      <div className="mt-[16px] flex gap-[8px]">
        <Button variant="ghost" onClick={onEditText}>
          edit text
        </Button>
        <Button
          variant="ghost"
          onClick={onTryAgain}
          disabled={tryAgainDisabled}
        >
          try again
        </Button>
      </div>
    </Card>
  );
}
