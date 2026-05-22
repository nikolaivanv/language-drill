import { LANGUAGE_NAMES, type LearningLanguage } from '@language-drill/shared';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { useTheoryTopics } from '../../lib/hooks/use-theory-topics';

type TheoryEmptyProps = {
  attemptedTopicId: string;
  language: LearningLanguage;
  onSwitchTopic: (topicId: string) => void;
  fetchFn?: AuthenticatedFetch;
};

export function TheoryEmpty({
  attemptedTopicId,
  language,
  onSwitchTopic,
  fetchFn,
}: TheoryEmptyProps) {
  const { topics: others } = useTheoryTopics({ language, fetchFn });

  return (
    <div className="theory-empty">
      <div className="t-micro">theory · reference</div>
      <h3 className="theory-empty-title">
        no theory written yet for &ldquo;{attemptedTopicId}&rdquo;
      </h3>

      {others.length > 0 ? (
        <>
          <p className="t-small">
            we&apos;ll add this topic soon — try one of these:
          </p>
          <ul className="theory-empty-list">
            {others.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="theory-otherbtn"
                  onClick={() => onSwitchTopic(t.id)}
                >
                  → {t.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="t-small">
          no theory written yet for {LANGUAGE_NAMES[language]} — coming soon.
        </p>
      )}
    </div>
  );
}
