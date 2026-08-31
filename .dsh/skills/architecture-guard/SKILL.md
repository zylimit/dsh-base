---
name: architecture-guard
description: Use when closing a phase, before a release, or whenever architecture may have drifted - undeclared edges, layer violations, unenforced decisions, or unwired quality attributes.
whenToUse: Every phase close and every release, plus any change to module boundaries or ADRs.
---

## Purpose
Detect and stop architectural decay with measurements instead of vigilance. Produces an architecture verdict per phase, a recorded metrics snapshot that ratchets debt downward, and ADRs whose enforcement is real rather than asserted.

## When this fires
- A phase closes, or a release is being cut.
- A module is added, split, renamed, or its `dependsOn`/`forbiddenDependencies` change.
- An ADR is written, amended, or superseded.
- A module declares `critical` or `high` on any of the eight quality attributes.
- Optionally as a periodic background job in a long session (run `arch-check`, read the job output; do not sleep-poll it).

## Procedure

### A. Four decay modes and their detectors
| Decay mode | Symptom | Detector | Blocking exit |
|---|---|---|---|
| Undeclared dependency edge | Code imports a module that `dependsOn` does not list | `node .dsh/base/dsb.mjs arch-check` | 1 |
| Forbidden or layer-violating edge | Inner layer imports outer, or a `forbiddenDependencies` entry is used | `node .dsh/base/dsb.mjs arch-check` | 1 |
| Decision documented but unenforced | ADR exists; no check, rule or named manual owner backs it | `node .dsh/base/dsb.mjs adr-check` | 1 |
| Declared but unwired attribute | `attributes{}` claims a tier with no verification behind it | `node .dsh/base/dsb.mjs attributes` | 1 |

Exit 3 from any detector means degraded or not configured: treat as blocking, never as a pass. Exit 2 stops the phase.

### B. Standing routine (phase close and pre-release)
1. `node .dsh/base/dsb.mjs catalog-lint` - the map must be valid before its measurements mean anything. Exit 1 stops.
2. `node .dsh/base/dsb.mjs arch-check` - measure the real graph against the declared graph.
3. `node .dsh/base/dsb.mjs adr-check` - every ADR resolves to a real enforcement target.
4. `node .dsh/base/dsb.mjs attributes` - every declared tier is wired; `minimal`/`none` carries an `attributeReasons` entry; `critical`/`high` blocks until its checks exist.
5. `node .dsh/base/dsb.mjs fitness --all` - rule-level decay (`no-secret-literal`, `no-pii-in-logs`, `no-silent-failure`, `no-unbounded-retry`, `no-unreferenced-deferral`, `no-insecure-transport`, `no-unsafe-dynamic-exec`, `no-weak-crypto`, `no-unbounded-resource`). A suppression requires a `dsb-fitness:ignore` comment with a reason on the same line.
6. `node .dsh/base/dsb.mjs arch-check --record` - write the metrics snapshot once the phase is otherwise clean.
7. `node .dsh/base/dsb.mjs arch-trend --gate` - the ratchet. It fails only when the newest measurement is worse than the best ever recorded.

### C. The ratchet
1. `--record` freezes the current numbers. Legacy debt below the recorded best is tolerated; anything worse than the best ever recorded fails.
2. Never record a snapshot to escape a failure. Recording after a regression converts a violation into the new baseline and disables the ratchet for that category.
3. Improvements are recorded, so improvement is irreversible: the next regression is measured against the improved number.
4. Violations of `security`, `safety` or `privacy` are protected: never waivable, never fast-skipped, never baselined. Fix or escalate.

### D. Conflict rule
When `docs/architecture/ARCHITECTURE.md` and `.dsh/base/catalog.json` disagree, the measured graph from `arch-check` wins. Correct the document, and correct the catalog only when the catalog misdescribes intent. Never edit the catalog to silence a measurement; that removes the detector rather than the defect.

### E. ADR authoring
1. One decision per ADR. Id format `ADR-<NNNN>`, append-only, never reused; supersede rather than rewrite.
2. Required sections: Status, Context, Decision, Consequences, Alternatives rejected.
3. Mandatory `Enforced-by:` naming one real target: a check id from `checks{}`, a fitness rule id, an engine capability (`arch-check`, `attributes`, `trace`, `budget`), or an explicit `manual:<who,cadence>`. A phantom reference is worse than none: it reads as enforced and is not. `adr-check` exit 1 means the reference does not resolve.
4. An ADR that cannot name an enforcement target is a preference, not a decision. Either build the check or record it as `manual:` with a named owner and cadence.

Full template (`docs/adr/ADR-<NNNN>-<slug>.md`, or the directory named by catalog `adr{dir}`):
```markdown
# ADR-<NNNN>: <short imperative title>

Status: Proposed | Accepted | Superseded by ADR-<NNNN> | Deprecated
Date: <YYYY-MM-DD>
Deciders: <names or roles>
Applies-to: <module ids from catalog.json modules[].id>
Attributes: <subset of security, safety, privacy, resilience, reliability, availability, performance, maintainability>
Requirements: <REQ-<AREA>-<NNN> / NFR-<ATTR>-<NNN> ids, or none>
Enforced-by: <check id | fitness rule id | engine capability | manual:<who,cadence>>

## Context
<Forces, constraints and the problem. Facts only; no options here.>

## Decision
<The decision, in the present imperative. One paragraph.>

## Consequences
### Positive
- <effect>
### Negative
- <cost accepted>
### Neutral
- <effect that is neither>

## Alternatives rejected
| Alternative | Why rejected |
|---|---|
| <option> | <decidable reason> |

## Verification
Command: node .dsh/base/dsb.mjs adr-check
Expected: exit 0 with Enforced-by resolving to <target>
```

## Output contract
Emit one architecture verdict per phase close:
```
Phase        : <name>
catalog-lint : PASS | FAIL | BLOCKED | SKIPPED (exit <n>)
arch-check   : <violations by category> (exit <n>)
adr-check    : <unenforced ADR ids or none> (exit <n>)
attributes   : <unwired declarations or none> (exit <n>)
fitness      : <rule id: count, ...> (exit <n>)
arch-trend   : <newest vs best-ever per category> (exit <n>)
Snapshot     : recorded <yes/no> - <snapshot id or reason>
Debt delta   : <improved | unchanged | REGRESSION - blocked>
Follow-ups   : <ADR id | check id to build | owner>
```

## Stop conditions
Halt and ask the human when:
- `arch-trend --gate` reports a regression that cannot be fixed inside the current change: this is an owner decision, never a re-record.
- A required edge is genuinely needed but forbidden by `forbiddenDependencies`: the boundary change needs an ADR and the module owner.
- An ADR has no honest `Enforced-by:` target and no owner will accept `manual:`.
- `attributes` demands checks for a `critical`/`high` declaration that the team has not built.
- `ARCHITECTURE.md` and the measured graph disagree in a way that implies the intended design changed without a decision record.
- A protected-attribute violation is found in code that is already released.

## Anti-patterns
| Failure mode | Correction |
|---|---|
| Running `arch-check --record` to make a red gate green. | Record only from a clean phase; a regression is fixed or escalated. |
| Writing an ADR with `Enforced-by: code review`. | Name a check id, a fitness rule id, an engine capability, or `manual:<who,cadence>`. |
| Editing `ARCHITECTURE.md` to match the drifted code and calling it aligned. | The measured graph wins; correct the document and fix the edge or record the decision. |
| Deleting a `forbiddenDependencies` entry to unblock a merge. | Removing the detector is not fixing the defect; get owner approval via an ADR. |
| Declaring `security: high` with no wired check. | `attributes` blocks; wire the check or lower the claim with an `attributeReasons` entry. |
| Suppressing a fitness rule with a bare `dsb-fitness:ignore`. | Include the reason on the same line; protected attributes cannot be suppressed at all. |
| Treating exit 3 as "not applicable". | Exit 3 is degraded: the check did not run. Configure it or stop. |
| Doing the architecture pass only before release. | Run it at every phase close; drift found six phases later costs more than the phase that caused it. |
