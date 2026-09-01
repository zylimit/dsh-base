---
name: verification-gate
description: Use when running or interpreting the dsb gate; explains the four check states, attribute blocking, waiver limits, diff-bound receipts, and the honest command sequences.
whenToUse: Every verification round, before every review, and before every release.
---

## Purpose
Read the gate the way the engine means it. Four states, one aggregation rule, and no path from a failure to a green answer except fixing the cause.
Produces a ledger entry bound to the current diff, and a receipt that stales the moment the tree changes.

## When this fires
- Implementation of a task is complete and its status must be established.
- A phase of `docs/plan/DEV-PLAN.md` closes.
- Before `review-pack`, before `dod`, and before any release step.
- A previous claim of "verified" must be re-established after any edit.

## Procedure

1. Compute the blast radius first: `node .dsh/base/dsb.mjs impact`. If it reports `degraded` (exit `3`) because a changed path maps to no module, fix the catalog `paths` before gating - an unmapped path silently escapes the plan.
2. Run `node .dsh/base/dsb.mjs gate` (alias `verify`). Read the four states literally:

| State | Meaning | Correct response |
|---|---|---|
| `PASS` | The check ran to completion and its assertion held | Quote it |
| `FAIL` | The check ran and its assertion did not hold | Fix the cause |
| `BLOCKED` | The check could not produce a verdict: missing binary, missing config, timeout, empty plan | Restore the ability to run it; a missing tool is never a `PASS` |
| `SKIPPED` | The check was not executed: fast-skip, dry-run, or a valid waiver | Not evidence; a gate whose checks are all `SKIPPED` is `BLOCKED` |

3. Apply the aggregation rule in this order: empty plan -> `BLOCKED` (`empty-plan`); any `FAIL` -> `FAIL`; any `BLOCKED` -> `BLOCKED`; all `SKIPPED` -> `BLOCKED` (`every-check-skipped`); otherwise `PASS`. An empty plan is `BLOCKED` because nothing ran, so nothing is proven - it is the most dangerous false green available.
4. Read the attribute verdict. For every affected module, each attribute declared at `critical` or `high` needs at least one executed, passing check that claims that attribute, and no claiming check may have failed. A gap turns a green run into `BLOCKED_BY_ATTRIBUTES`: the checks passed, but they prove nothing about the attribute at risk. Fix by adding a claiming check to the module `verification`, or by lowering the tier with a written `attributeReasons` entry - never by deleting the attribute.
5. Handle waivers narrowly. A waiver may only downgrade a `FAIL` or `BLOCKED` on a non-protected check, to `SKIPPED`. It may never touch a check classed protected or claiming `security`, `safety`, or `privacy`. Every waiver needs owner, reason, expiry, and compensating control; `node .dsh/base/dsb.mjs waiver create` writes it, `waiver check` validates it, and an edited waiver fails its content hash. Expiry is enforced by `node .dsh/base/dsb.mjs risk` - an expired waiver stops protecting anything.
6. Bind the result to the diff: `node .dsh/base/dsb.mjs receipt write` records the verdict against the current diff hash. Any byte change to the working tree stales it; `receipt verify` then exits `4` and the claim must be re-earned. Never quote a receipt written before the last edit.
7. Confirm the ledger is intact: `node .dsh/base/dsb.mjs ledger verify` (exit `0`). A broken hash chain fails closed - every prior verification is treated as unproven. Use `gate-audit` to inspect the recorded history rather than re-deriving it from memory.
8. A green gate does not close a task by itself. `node .dsh/base/dsb.mjs task complete` additionally demands a fresh `ACCEPT` from `node .dsh/base/dsb.mjs review verdict` bound to this same diff, and that accepting receipt must record lens coverage: a verdict reached without structured disagreement is consensus, and the blocker says so unless `catalog.review.requireStructured` is `false`. The verdict is computed, never asserted - `review verdict` refuses while Blue is silent or any required lens never reported (exit `1`), returns `FIX_REQUIRED` on any `error` finding and `NEEDS_MORE_EVIDENCE` on any lens that reported itself `unable` (both exit `2`), and writes the receipt only on `ACCEPT` (exit `0`). The procedure for running it is `structured-review`.

### Fast mode - a dated loan against evidence

`node .dsh/base/dsb.mjs fast on --minutes 90 --reason "<why>"` opens a relaxation window, `fast status` reports whether one is open and exactly what it would defer, `fast off` closes it. Four conditions are engine behaviour, not etiquette:

1. **It expires by itself.** A reason is mandatory - `fast on` without `--reason` is refused (exit `3`) - and `--minutes` is clamped to a maximum of 8 hours (480). A window with no end is not a window.
2. **The protected floor still runs.** Every check claiming `security`, `safety` or `privacy` executes regardless, and `catalog-lint` rejects a protected check that declares `allowFastSkip` (`PROTECTED_FAST_SKIP`).
3. **Only pre-marked checks are deferred.** Exactly those carrying `allowFastSkip` in `catalog.json`, decided in advance while there was time to think about which evidence is cheap to defer. Deciding it during the emergency is how everything becomes deferrable.
4. **It is a loan, not a discount.** Each deferred check is recorded `SKIPPED` with reason `fast-mode`, the gate record is stamped `fastMode`, and `risk` raises `FAST_MODE_DEBT`.

A gate record stamped `fastMode` cannot close a task or a release: `task complete` names the blocker and lists what was deferred. Repay it with `node .dsh/base/dsb.mjs fast off` followed by a full `node .dsh/base/dsb.mjs gate`; only that unstamped record closes the task. Read `fast status` before quoting any gate result, because a `PASS` earned inside an open window is a narrower claim than it looks.

### Normal verification round
```
node .dsh/base/dsb.mjs impact
node .dsh/base/dsb.mjs fitness
node .dsh/base/dsb.mjs budget
node .dsh/base/dsb.mjs gate
node .dsh/base/dsb.mjs receipt write
```

### Release round
```
node .dsh/base/dsb.mjs gate
node .dsh/base/dsb.mjs attributes
node .dsh/base/dsb.mjs trace
node .dsh/base/dsb.mjs adr-check
node .dsh/base/dsb.mjs arch-check
node .dsh/base/dsb.mjs arch-trend --gate
node .dsh/base/dsb.mjs risk
node .dsh/base/dsb.mjs ledger verify
node .dsh/base/dsb.mjs receipt verify
node .dsh/base/dsb.mjs dod
```

## Output contract
Report a verification round as:

```
Gate: PASS | FAIL | BLOCKED | BLOCKED_BY_ATTRIBUTES  (reason: <engine reason string>)
Plan: <n> checks over modules <ids>
States: PASS <n> / FAIL <n> / BLOCKED <n> / SKIPPED <n>  (skipped because: fast-skip | dry-run | waiver:<id>)
Attribute gaps: <module:attribute:tier - why>, or none
Waivers applied: <check id -> waiver path, expiry>, or none
Fast mode: closed | OPEN until <iso> (reason: <why>) - deferred: <check ids>
Review: ACCEPT | FIX_REQUIRED | NEEDS_MORE_EVIDENCE | none, lenses <list>
Receipt: <diff hash> written | stale
Exit codes: impact <n>, fitness <n>, budget <n>, gate <n>, review verdict <n>
```

## Stop conditions
- Gate is `FAIL`, `BLOCKED`, or `BLOCKED_BY_ATTRIBUTES` and the fix is outside the current Scope.
- A check is `BLOCKED` because a tool or credential is missing on this machine: report the missing dependency; do not substitute a different command that happens to pass.
- `ledger verify` or `receipt verify` exits non-zero: stop all release activity and report tampering or staleness.
- A waiver would be needed on a protected attribute: refuse and escalate; this is not waivable at any tier.
- `risk` reports an expired waiver covering the current change: stop until it is renewed with a fresh owner decision or the underlying failure is fixed.
- The only remaining path to green is editing `catalog.json` checks, budgets, or attribute tiers as part of this change: HIGH tier, human decision.
- The newest gate is stamped `fastMode` and the task or release must close now: it cannot. Close the window and run the full gate, or escalate the deadline to a human with `risk` output showing `FAST_MODE_DEBT`.
- Marking a check `allowFastSkip` mid-incident so it can be deferred: that is a HIGH-tier `catalog.json` edit and defeats condition 3.

## Anti-patterns
| Failure mode | Correction |
|---|---|
| Re-running a failing check on a narrower path or with different flags until it passes | The first honest result stands; fix the cause or report the failure |
| Reading `SKIPPED` as "fine" | `SKIPPED` is absence of evidence; all-skipped aggregates to `BLOCKED` |
| Treating a missing binary as a pass because "the check is not applicable here" | `BLOCKED`; install the tool or record it as an unproven attribute |
| Widening `budget` limits so the gate stops complaining | The budget exists to reveal a boundary failure; split the change |
| Waiving a `security`/`safety`/`privacy` check under deadline pressure | Never waivable; escalate to a human decision with the failure output |
| Quoting yesterday's green receipt after new edits | Any byte change stales the receipt; re-run and re-record |
| Declaring victory on `PASS` while attribute gaps are listed | `BLOCKED_BY_ATTRIBUTES` is not a pass; wire a claiming check |
| Deleting or renaming a failing check id from `catalog.json` | That is evidence destruction; fix the code, or record an ADR with the rejected alternative |
| Quoting a `fastMode` gate record as if the task were provable | It is a dated loan; `fast off` then a full `gate` repays it, and only the repaid record closes anything |
| Opening a fast window with a vague reason to make it pass | The reason is recorded and read later; an unreadable reason is how a temporary window becomes permanent |
| Closing a task on a green gate alone | `task complete` also needs an `ACCEPT` verdict with lens coverage bound to the same diff |
