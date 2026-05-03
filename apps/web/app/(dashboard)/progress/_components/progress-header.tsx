import {
  type CefrLevel,
  LANGUAGE_NATIVE_NAMES,
  type LearningLanguage,
} from '@language-drill/shared';

// ---------------------------------------------------------------------------
// ProgressHeader — eyebrow + title + subtitle for /progress.
// Each eyebrow segment is omitted independently when its value is null.
// Design reference: design.md §"Component 2 — ProgressHeader" + the
// "your progress." prototype wording.
// ---------------------------------------------------------------------------

export type ProgressHeaderProps = {
  language: LearningLanguage;
  proficiencyLevel: CefrLevel | null;
  weeksActive: number | null;
};

export function ProgressHeader({
  language,
  proficiencyLevel,
  weeksActive,
}: ProgressHeaderProps) {
  const segments: string[] = [LANGUAGE_NATIVE_NAMES[language]];
  if (proficiencyLevel !== null) segments.push(proficiencyLevel);
  if (weeksActive !== null) segments.push(`${weeksActive} weeks in`);

  return (
    <header>
      <div className="t-micro">{segments.join(' · ')}</div>
      <h1 className="t-display-xl" style={{ margin: '4px 0 0' }}>
        your progress.
      </h1>
      <p className="t-body-l" style={{ marginTop: 8, maxWidth: 560 }}>
        honest skill numbers. no XP, no levels — just where you actually are.
      </p>
    </header>
  );
}
