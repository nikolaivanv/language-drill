# Profile Onboarding Task 4

Execute task 4 from the profile-onboarding spec using the spec-task-executor agent.

## Instructions

Use the `spec-task-executor` agent with the following brief:

**Spec:** profile-onboarding  
**Task ID:** 4 — Write API route tests  

Read full context from these files before implementing:
- `.claude/specs/profile-onboarding/tasks.md` — find task 4 for exact implementation details
- `.claude/specs/profile-onboarding/design.md` — testing strategy section
- `infra/lambda/src/routes/exercises.test.ts` — existing test patterns to follow
- `infra/lambda/src/routes/profiles.ts` — the route being tested

**Rules:**
- Implement ONLY task 4 — do not proceed to other tasks
- Follow exact file paths specified in the task
- After completing the task, check the checkbox in `.claude/specs/profile-onboarding/tasks.md` for task 4 (change `- [ ]` to `- [x]`)
- Run `pnpm test` to verify all tests pass
- Report test results: X passed, Y failed, and any failures with proposed fixes
- Stop and wait for the user's next instruction
