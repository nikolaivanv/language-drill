# Profile Onboarding Task 7

Execute task 7 from the profile-onboarding spec using the spec-task-executor agent.

## Instructions

Use the `spec-task-executor` agent with the following brief:

**Spec:** profile-onboarding  
**Task ID:** 7 — Build the onboarding page  

Read full context from these files before implementing:
- `.claude/specs/profile-onboarding/tasks.md` — find task 7 for exact implementation details
- `.claude/specs/profile-onboarding/design.md` — onboarding page UI structure and behavior
- `.claude/specs/profile-onboarding/requirements.md` — FR-1.1 through FR-1.6, FR-3.2, FR-3.3, FR-5.1
- `apps/web/app/(dashboard)/practice/page.tsx` — existing page pattern (client component, useAuth, fetchFn)
- `packages/shared/src/index.ts` — LANGUAGE_NAMES, CEFR_DESCRIPTIONS, Language, CefrLevel

**Rules:**
- Implement ONLY task 7 — do not proceed to other tasks
- Follow exact file paths specified in the task
- After completing the task, check the checkbox in `.claude/specs/profile-onboarding/tasks.md` for task 7 (change `- [ ]` to `- [x]`)
- Run `pnpm typecheck` and `pnpm lint` to verify
- Report what was created/modified and confirm the task is complete
- Stop and wait for the user's next instruction
