# Profile Onboarding Task 8

Execute task 8 from the profile-onboarding spec using the spec-task-executor agent.

## Instructions

Use the `spec-task-executor` agent with the following brief:

**Spec:** profile-onboarding  
**Task ID:** 8 — Seed dev user language profiles  

Read full context from these files before implementing:
- `.claude/specs/profile-onboarding/tasks.md` — find task 8 for exact implementation details
- `.claude/specs/profile-onboarding/design.md` — local dev considerations section
- `infra/lambda/src/dev.ts` — existing dev server setup to modify

**Rules:**
- Implement ONLY task 8 — do not proceed to other tasks
- Follow exact file paths specified in the task
- After completing the task, check the checkbox in `.claude/specs/profile-onboarding/tasks.md` for task 8 (change `- [ ]` to `- [x]`)
- Run `pnpm typecheck` and `pnpm lint` to verify
- Report what was created/modified and confirm the task is complete
- Stop and wait for the user's next instruction
