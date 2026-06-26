import type { GoalId } from '@language-drill/shared';

// Inner SVG geometry per goal, verbatim from the prototype
// (Onboarding - Desktop.html, GOALS[].icon). Rendered inside a shared
// 24x24 stroke wrapper. Decorative only — aria-hidden; the goal label is
// the meaningful text.
const GOAL_ICON_PATHS: Record<GoalId, string> = {
  grammar:
    '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/>',
  speaking: '<path d="M20 11.5a7 7 0 0 1-9.8 6.4L5 19.5l1.6-5A7 7 0 1 1 20 11.5z"/>',
  listening:
    '<path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="7" rx="1.6"/><rect x="17" y="13" width="4" height="7" rx="1.6"/>',
  writing: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  vocab:
    '<path d="M12 5.5C10.5 4.4 8.3 4 5.5 4.2 4.7 4.2 4 4.9 4 5.7v11.6c0 .8.7 1.4 1.5 1.4 2.8-.2 5 .2 6.5 1.3 1.5-1.1 3.7-1.5 6.5-1.3.8 0 1.5-.6 1.5-1.4V5.7c0-.8-.7-1.5-1.5-1.5-2.8-.2-5 .2-6.5 1.3z"/><path d="M12 5.5v13"/>',
  travel:
    '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2.2 5.3-5.3 2.2 2.2-5.3z"/>',
};

export function GoalIcon({ id }: { id: GoalId }) {
  return (
    <svg
      data-testid={`goal-icon-${id}`}
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="w-[23px] h-[23px] flex-shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      // eslint-disable-next-line -- static, in-repo icon geometry
      dangerouslySetInnerHTML={{ __html: GOAL_ICON_PATHS[id] }}
    />
  );
}
