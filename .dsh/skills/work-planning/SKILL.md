---
name: work-planning
description: Use when an approved spec and architecture must become an executable DEV-PLAN.md whose tasks a zero-context subagent can run without asking questions.
whenToUse: After spec-lint and catalog-lint pass, before any implementation begins.
---

## Purpose
Convert an approved specification and module graph into `docs/plan/DEV-PLAN.md`: phases that are DAG levels of 2-5 tasks, each task self-contained enough for a fresh subagent with no conversation history.
Produces the plan, a REQ-to-phase coverage table, and a budget verdict per task.

## When this fires
- `spec-lint` and `catalog-lint` both exit `0` and implementation is about to start.
- Work is being split across subagents, a workflow fan-out, or multiple sessions.
- A task in flight turns out to be larger than its Scope: replan rather than widen it.
- `node .dsh/base/dsb.mjs budget` exits `1` on a task's projected diff.

## Procedure

1. Derive the DAG. A phase is one DAG level: 2-5 tasks with no dependency on each other, so they may run in parallel. Fewer than 2 means the level is really a step in the previous phase; more than 5 means the level hides a missing decomposition.
2. Order phases so that every task's dependencies are closed by an earlier phase. A task may depend only on a task in a strictly earlier phase - never on a sibling in the same phase.
3. Write every task with exactly five elements:

| Element | Requirement |
|---|---|
| Goal | One sentence, one outcome, naming the REQ/NFR id it satisfies |
| Scope | Concrete file paths (existing paths, or the exact path to be created) and the module id from `catalog.json` |
| Dependencies | Task ids from earlier phases, or `none` |
| Verification | A literal runnable command, copy-pasteable, including the dsb command that proves the module's checks |
| Expected | A decidable outcome: exit code, file content, observable behaviour with values |

4. Apply the no-placeholder rule. Reject the task and rewrite it if it contains any of: `TBD`, `TODO`, `FIXME`, `???`, `similar to task N`, `same as above`, `add appropriate error handling`, `implement related logic`, `write tests`, `refactor as needed`, `handle edge cases`. Rationale: the executor is a fresh zero-context subagent that cannot resolve "similar to" and will invent something.
5. Name the existing pattern for each task: the file that already does the same kind of thing. A task without a named pattern invites a new one, which becomes an unplanned architectural decision.
6. Build the REQ-to-phase coverage table. Every REQ and NFR in `docs/requirements/PRODUCT-SPEC.md` appears in at least one phase. An unmapped requirement is a missed requirement, not an implicit deferral; either map it or record it as explicitly deferred with a reason in the plan.
7. Size every task against the change budget. Run `node .dsh/base/dsb.mjs budget` (defaults: `maxChangedFiles 40`, `maxChangedLines 1500`, `maxModulesTouched 3`, `maxNewFiles 25`) and split any task whose projected diff exceeds it. Exit `1` means split; never raise the budget to make a task fit.
8. Check blast radius per task with `node .dsh/base/dsb.mjs impact` against its Scope paths. A task touching more than `maxModulesTouched` modules is a cross-cutting change and must be split by module or given an explicit ADR.
9. Confirm each task's Verification command resolves to real checks: the module's `verification[]` ids must exist in `catalog.json` `checks` (proved by `catalog-lint` exit `0`). A task whose verification is "manual inspection" is not planned; give it a command or mark it review-only.
10. Register execution with `node .dsh/base/dsb.mjs task start` when a task begins and `task complete` when its verification passes; `task status` is the recovery source after a session break.

## Output contract
`docs/plan/DEV-PLAN.md` sections: Summary / Assumptions / Phase list / Coverage table / Deferred items / Risks.

Task template:

```
### T-03 - Persist session tokens
Goal: satisfy REQ-AUTH-002 by storing issued tokens with their expiry.
Scope: src/auth/session-store.ts (new), src/auth/index.ts, module auth-core
Dependencies: T-01
Existing pattern: src/billing/invoice-store.ts (same repository shape)
Verification: node .dsh/base/dsb.mjs impact && npm test -- src/auth && node .dsh/base/dsb.mjs fitness
Expected: npm test exits 0 with 4 new passing cases; a token read 901 s after issue returns null; dsb fitness exits 0
```

Coverage table columns: `Requirement id | Phase | Task ids | Verification command | Status`. Deferred rows must carry a reason and an owner.

## Stop conditions
- A requirement cannot be mapped to any module in `catalog.json`: stop; the architecture is incomplete, return to `architecture-design`.
- A task cannot be given a literal verification command: stop and ask for the acceptance definition.
- Splitting a task to fit the budget would break atomicity (the intermediate state does not compile or ships a half-migration): stop and request an explicit budget decision from the human as a HIGH-tier approval.
- Dependencies form a cycle between tasks: stop; a cyclic plan means the module boundaries are wrong.
- The spec changed after planning started: stop, re-run `spec-lint`, and re-derive the coverage table before executing.

## Anti-patterns
| Failure mode | Correction |
|---|---|
| "Implement the backend" as one task | Split by module and by REQ; 2-5 tasks per phase, each with its own verification |
| Verification written as "tests pass" | Give the literal command line and the expected exit code |
| Scope written as "the auth area" | List concrete file paths and the catalog module id |
| A task depending on a sibling in the same phase | Move it to the next phase; a phase level must be parallel-safe |
| Widening `budget` so a large task fits | Split the task; a widened budget hides the boundary failure it was meant to reveal |
| Leaving a REQ out of the coverage table because it is "obvious" | Every id appears, or is explicitly deferred with reason and owner |
| Reusing a task id after a task is dropped | Ids are monotone and never reused; mark the dropped task cancelled |
| Assuming the executor has read this conversation | Subagents start with zero context; every task must stand alone |
