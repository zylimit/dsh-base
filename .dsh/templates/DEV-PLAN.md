# Development plan - <system or phase name>

<!-- rule: copy to docs/plan/DEV-PLAN.md. Written only after `spec-lint` and `catalog-lint`
     both exit 0: a plan against an undecidable spec plans the wrong thing precisely. -->
<!-- rule: a phase is one DAG level - 2 to 5 tasks with no dependency on each other, safe to
     run in parallel. Fewer than 2 means the level is a step of the previous phase; more
     than 5 means a decomposition is missing. A task may depend only on a task in a
     strictly earlier phase, never on a sibling. -->
<!-- rule: the executor is a fresh subagent with zero conversation history. Every task must
     stand alone: it cannot resolve "as discussed", cannot see this file's other tasks, and
     will invent something plausible when a field is vague. -->
<!-- rule: NO-PLACEHOLDER. Reject and rewrite any task containing: "TBD", "TODO", "FIXME",
     "???", "similar to task N", "same as above", "add appropriate error handling",
     "implement related logic", "write tests", "refactor as needed", "handle edge cases".
     Each of these delegates a decision to someone who has no basis to make it. -->

Plan version: <n> | Date: <YYYY-MM-DD> | Spec version: <n.n> | Owner: <name>

## Summary

<!-- rule: three sentences: what ships at the end of this plan, what does not, and the one
     assumption whose failure invalidates the plan. -->

## Assumptions

| # | Assumption | Falsified by | Impact if false |
|---|---|---|---|
| A1 | EXAMPLE the provider sandbox accepts idempotency keys | contract test `refund-contract` | phase 2 tasks are re-planned against a local stub |

## Phases

<!-- rule: task ids are monotone and never reused; a cancelled task keeps its id and gains
     "Status: cancelled". Every task carries all six lines below. -->

### Phase 1 - <name> (tasks run in parallel)

#### T-01 - Refund idempotency store (EXAMPLE)
Goal: satisfy REQ-REFD-001 by persisting one accepted refund per idempotency key.
Scope: services/refund/core/idempotency.ts (new), services/refund/core/index.ts; module refund-core
Dependencies: none
Existing pattern: services/billing/core/dedupe-store.ts (same repository shape and error type)
Verification: node .dsh/base/dsb.mjs impact && npm test -- services/refund/core && node .dsh/base/dsb.mjs gate
Expected: gate exits 0 with PASS; 4 new tests pass; a second write with the same key returns the first record and increments no provider counter.

#### T-02 - <name> (copy the block above)
Goal: <one outcome, naming the REQ or NFR id it satisfies>
Scope: <concrete file paths, existing or to be created; module id from catalog.json>
Dependencies: <task ids from earlier phases, or "none">
Existing pattern: <path:line of the file that already does this kind of thing>
Verification: <literal runnable command line, copy-pasteable>
Expected: <decidable outcome: exit code, observable behaviour with values, file state>

### Phase 2 - <name> (starts only after every Phase 1 task is complete)

#### T-03 - <name>
<!-- rule: same six lines. If a task cannot be given a literal Verification command, it is
     not planned yet - stop and get the acceptance definition. "Manual inspection" is not a
     verification; mark such work review-only and say who reviews it. -->

## Coverage

<!-- rule: every REQ and NFR id in docs/requirements/PRODUCT-SPEC.md appears in exactly one
     row, mapped to a phase or explicitly deferred. An unmapped requirement is a missed
     requirement, never an implicit deferral. -->

| Requirement id | Phase | Task ids | Verification command | Status |
|---|---|---|---|---|
| EXAMPLE REQ-REFD-001 | 1 | T-01 | npm test -- services/refund/core | planned |
| EXAMPLE NFR-PERF-001 | 3 | T-08 | k6 run perf/refund-submit.js | planned |

## Deferred items

<!-- rule: a deferral carries an owner, a reason and the condition that would pull it back
     in. A deferral without a condition is a silent drop. -->

| Requirement id | Deferred because | Owner | Revisit when |
|---|---|---|---|
| EXAMPLE REQ-REFD-006 | needs the tax rules finance has not signed off | @payments | finance sign-off lands |

## Risks

| Risk | Trigger | Impact | Mitigation |
|---|---|---|---|
| EXAMPLE provider sandbox rate limit | more than 20 rps in CI | phase 2 tests flake | pin the contract test to 5 rps and record the ceiling |

## Budget

<!-- rule: size every task against `node .dsh/base/dsb.mjs budget`, whose limits live in the
     `budget` block of .dsh/base/catalog.json. Exit 1 means split the task. Never widen the
     budget to make a task fit: the limit exists to surface the boundary failure. -->
<!-- rule: check blast radius with `node .dsh/base/dsb.mjs impact` per task scope. A task
     touching more modules than `maxModulesTouched` is a cross-cutting change: split it by
     module, or write the ADR that justifies it. -->

## Verification

```sh
node .dsh/base/dsb.mjs spec-lint     # the spec this plan implements is still decidable
node .dsh/base/dsb.mjs catalog-lint  # every check id named in a task exists
node .dsh/base/dsb.mjs budget        # the current task's diff is inside the limits
node .dsh/base/dsb.mjs task status   # what is actually in flight after a session break
```
