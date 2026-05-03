import { LANGUAGE_NAMES, type LearningLanguage } from '@language-drill/shared';
import {
  listTheoryTopics,
  type TheoryTopicId,
} from '../../content/theory';

type TheoryEmptyProps = {
  attemptedTopicId: string;
  language: LearningLanguage;
  onSwitchTopic: (topicId: TheoryTopicId) => void;
};

export function TheoryEmpty({
  attemptedTopicId,
  language,
  onSwitchTopic,
}: TheoryEmptyProps) {
  const others = listTheoryTopics(language);

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
                  onClick={() => onSwitchTopic(t.id as TheoryTopicId)}
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
