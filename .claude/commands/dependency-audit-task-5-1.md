# Dependency Audit Task 5.1

Execute task 5.1 from the dependency-audit spec using the spec-task-executor agent.

## Instructions

Use the `spec-task-executor` agent with the following brief:

**Spec:** dependency-audit
**Task ID:** 5.1

Read full context from these files before implementing:
- `.claude/specs/dependency-audit/tasks.md` — find task 5.1 for exact implementation details
- `.claude/specs/dependency-audit/design.md` — architecture, per-PR components, error-handling scenarios, smoke recipes
- `.claude/specs/dependency-audit/requirements.md` — acceptance criteria to satisfy
- `docs/dependency-audit.md` — source-of-truth audit data the spec implements
- `.claude/steering/tech.md` — tech stack decisions to follow
- `CLAUDE.md` — Package Management and Pre-Push Checks rules

**Rules:**
- Implement ONLY task 5.1 — do not proceed to other tasks
- Follow exact file paths specified in the task
- Respect the cross-PR pin guarantees (R6) and rollout isolation (R7) at all times
- After completing the task, check the checkbox in `.claude/specs/dependency-audit/tasks.md` for task 5.1 (change `- [ ]` to `- [x]`)
- Report what was created/modified and confirm the task is complete
- Stop and wait for the user's next instruction
