import { Button, Card } from '../../../../components/ui';

interface SubmissionErrorCardProps {
  error: Error;
  onRetry: () => void;
  onSkip?: () => void;
  onEndSession?: () => void;
}

export function SubmissionErrorCard({
  error,
  onRetry,
  onSkip,
  onEndSession,
}: SubmissionErrorCardProps) {
  const isRateLimit = error.message.includes('429') || /rate limit/i.test(error.message);
  const message = isRateLimit
    ? "You've reached your daily practice limit. Come back tomorrow!"
    : `Failed to submit answer: ${error.message}`;

  return (
    <Card
      padding="lg"
      className={isRateLimit ? 'bg-[var(--color-hilite-soft)]' : 'bg-[var(--color-accent-soft)]'}
    >
      <p className="t-body">{message}</p>
      <div className="mt-s-3 flex gap-s-3">
        <Button variant="default" onClick={onRetry}>try again</Button>
        {isRateLimit && onEndSession ? (
          <Button variant="default" onClick={onEndSession}>end session early</Button>
        ) : null}
        {!isRateLimit && onSkip ? (
          <Button variant="default" onClick={onSkip}>skip item</Button>
        ) : null}
      </div>
    </Card>
  );
}
