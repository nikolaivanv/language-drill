# Profile Onboarding Task 6

Execute task 6 from the profile-onboarding spec using the spec-task-executor agent.

## Instructions

Use the `spec-task-executor` agent with the following brief:

**Spec:** profile-onboarding  
**Task ID:** 6 — Write client hook tests  

Read full context from these files before implementing:
- `.claude/specs/profile-onboarding/tasks.md` — find task 6 for exact implementation details
- `.claude/specs/profile-onboarding/design.md` — testing strategy section
- `packages/api-client/src/hooks/useExercise.test.ts` — existing test patterns to follow
- `packages/api-client/src/hooks/useLanguageProfiles.ts` — the hooks being tested

**Rules:**
- Implement ONLY task 6 — do not proceed to other tasks
- Follow exact file paths specified in the task
- After completing the task, check the checkbox in `.claude/specs/profile-onboarding/tasks.md` for task 6 (change `- [ ]` to `- [x]`)
- Run `pnpm test` to verify all tests pass
- Report test results: X passed, Y failed, and any failures with proposed fixes
- Stop and wait for the user's next instruction
