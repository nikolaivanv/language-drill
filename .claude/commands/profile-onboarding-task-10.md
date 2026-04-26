# Profile Onboarding Task 10

Execute task 10 from the profile-onboarding spec using the spec-task-executor agent.

## Instructions

Use the `spec-task-executor` agent with the following brief:

**Spec:** profile-onboarding  
**Task ID:** 10 — Integrate profiles into the practice page  

Read full context from these files before implementing:
- `.claude/specs/profile-onboarding/tasks.md` — find task 10 for exact implementation details
- `.claude/specs/profile-onboarding/design.md` — practice page changes section
- `.claude/specs/profile-onboarding/requirements.md` — FR-4.1, FR-4.2, FR-4.3
- `apps/web/app/(dashboard)/practice/page.tsx` — the file to modify

**Rules:**
- Implement ONLY task 10 — do not proceed to other tasks
- Follow exact file paths specified in the task
- After completing the task, check the checkbox in `.claude/specs/profile-onboarding/tasks.md` for task 10 (change `- [ ]` to `- [x]`)
- Run `pnpm typecheck` and `pnpm lint` to verify
- Report what was created/modified and confirm the task is complete
- Stop and wait for the user's next instruction
