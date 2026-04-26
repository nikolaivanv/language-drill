# Profile Onboarding Task 5

Execute task 5 from the profile-onboarding spec using the spec-task-executor agent.

## Instructions

Use the `spec-task-executor` agent with the following brief:

**Spec:** profile-onboarding  
**Task ID:** 5 — Create client-side schemas and hooks  

Read full context from these files before implementing:
- `.claude/specs/profile-onboarding/tasks.md` — find task 5 for exact implementation details
- `.claude/specs/profile-onboarding/design.md` — client layer specifications
- `packages/api-client/src/hooks/useExercise.ts` — existing hook pattern to follow
- `packages/api-client/src/schemas/exercise.ts` — existing schema pattern to follow
- `packages/api-client/src/index.ts` — exports to update

**Rules:**
- Implement ONLY task 5 — do not proceed to other tasks
- Follow exact file paths specified in the task
- After completing the task, check the checkbox in `.claude/specs/profile-onboarding/tasks.md` for task 5 (change `- [ ]` to `- [x]`)
- Run `pnpm typecheck` and `pnpm lint` to verify
- Report what was created/modified and confirm the task is complete
- Stop and wait for the user's next instruction
