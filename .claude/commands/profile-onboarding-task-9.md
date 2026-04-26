# Profile Onboarding Task 9

Execute task 9 from the profile-onboarding spec using the spec-task-executor agent.

## Instructions

Use the `spec-task-executor` agent with the following brief:

**Spec:** profile-onboarding  
**Task ID:** 9 — Add dashboard layout with onboarding gate  

Read full context from these files before implementing:
- `.claude/specs/profile-onboarding/tasks.md` — find task 9 for exact implementation details
- `.claude/specs/profile-onboarding/design.md` — onboarding gate section and route configuration
- `.claude/specs/profile-onboarding/requirements.md` — FR-3.1, FR-5.3
- `apps/web/app/(dashboard)/practice/page.tsx` — existing client component pattern
- `apps/web/app/layout.tsx` — root layout for reference

**Rules:**
- Implement ONLY task 9 — do not proceed to other tasks
- Follow exact file paths specified in the task
- After completing the task, check the checkbox in `.claude/specs/profile-onboarding/tasks.md` for task 9 (change `- [ ]` to `- [x]`)
- Run `pnpm typecheck` and `pnpm lint` to verify
- Report what was created/modified and confirm the task is complete
- Stop and wait for the user's next instruction
