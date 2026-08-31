---
name: scoped-implementation
description: Use when executing one planned task as the implementer; enforces the task envelope, scope discipline, self-verification, and the six-field result envelope.
whenToUse: Every implementation turn, and every delegated coding subagent run.
---

## Purpose
The implementer contract: accept a complete task envelope, change only what it authorises, prove the change with the module's own checks, and report in a fixed six-field envelope.
Produces a diff confined to Scope plus a verified result the caller can act on without re-reading the work.

## When this fires
- A task from `docs/plan/DEV-PLAN.md` is handed over for execution.
- A subagent is dispatched to write or modify code.
- A bug fix is authorised with named files and a reproduction.
- Any turn that will edit source files rather than documents.

## Procedure

1. Validate the envelope before touching anything. All six fields must be present and concrete: Goal / Scope / Out of scope / Existing pattern / Verification / Escalation. Scope must name file paths, not areas. If any field is missing or vague, stop and return `NEEDS_CONTEXT` naming the exact missing field and the question that resolves it. Do not infer the missing field.
2. Establish the baseline before editing: run `node .dsh/base/dsb.mjs impact` and the task's Verification command once. A pre-existing failure that you did not cause must be recorded in the result, not silently fixed and not silently inherited.
3. Read before writing. Read the file named as Existing pattern and the files in Scope. Reuse that pattern - its error handling, its naming, its layering. Introducing a second pattern for the same problem is an architectural decision and needs an ADR, not an implementation turn.
4. Change only files inside Scope. A file outside Scope that must change is a scope change: stop, report what and why, and let the caller extend the envelope. No drive-by refactors, no formatting sweeps, no renaming unrelated symbols, no "while I was here" fixes.
5. Add no dependency, package, lockfile entry, or vendored library without HIGH-tier human approval. A delegated subagent cannot obtain it (approval policy is pinned to `never`) and must report `BLOCKED` upward.
6. Keep the working tree compiling at every checkpoint. Land each logical step complete: no half-migrated call sites, no functions referenced but not defined, no commented-out blocks left as breadcrumbs.
7. Handle failures explicitly. No empty `catch`, no swallowed error, no unbounded retry, no secret literal, no PII in logs - `fitness` enforces `no-silent-failure`, `no-unbounded-retry`, `no-secret-literal`, `no-pii-in-logs`, `no-insecure-transport`, `no-unsafe-dynamic-exec`, `no-weak-crypto`, `no-unbounded-resource`, `no-unreferenced-deferral`. Suppress a finding only with `dsb-fitness:ignore` plus a same-line or preceding-line reason, and never on a `security`, `safety`, or `privacy` rule.
8. Self-check before reporting, in this order, and stop at the first non-zero exit you caused:
   - the module's own verification, resolved by `node .dsh/base/dsb.mjs impact` and run via `node .dsh/base/dsb.mjs gate` (exit `2` = blocking failure);
   - `node .dsh/base/dsb.mjs fitness` (exit `1` = rule violation);
   - `node .dsh/base/dsb.mjs budget` (exit `1` = diff exceeds the declared budget - split the work, do not raise the budget).
9. Report with the six-field result envelope. Distinguish what you ran from what you assume: anything not executed in this session belongs under Not verified.

### Code Mode discipline
- Batch independent reads and searches into one `run_code` program: gather the file list with `glob`/`grep`, then `Promise.all` the `read` calls. One tool call per file wastes turns and context.
- Print only what you need from a program - matched lines, counts, a diff summary - never a whole file dump into the transcript.
- Sequence dependent work with `await`; run mutating calls (`write`, `edit`) one at a time in the order you intend.
- Wrap calls that may legitimately fail in `try/catch` on `ToolCallError` and continue, so one missing path does not abort the batch.
- Use `edit` for targeted changes and `write` only for new files or full replacement; read the file first.

## Output contract
```
Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
Changed: <path list, one line each, with a phrase describing the change>
Verified: <command -> exit code -> what it proves>
Not verified: <what was not exercised, and why>
Needs review by: <owner from catalog.json, or "none">
Evidence: <ledger entry / receipt id / test output path / diff hash>
```

Status rules: `DONE` requires every self-check at exit `0`. `DONE_WITH_CONCERNS` means the goal is met but something unresolved is named (pre-existing failure, skipped check, degraded impact). `NEEDS_CONTEXT` means the envelope was incomplete - no code was written. `BLOCKED` means work stopped on an external condition: name it and the decision required.

## Stop conditions
- An envelope field is missing, or Scope names areas instead of paths - return `NEEDS_CONTEXT`.
- The correct fix lies outside Scope, or requires changing a module you do not own per `catalog.json` `owners`.
- A new dependency, a schema migration, a secret, or a destructive command is required - HIGH tier.
- `gate` returns `BLOCKED_BY_ATTRIBUTES`: a critical/high attribute is unproven; do not report `DONE`.
- The existing pattern named in the envelope does not exist or does not fit - ask which pattern to follow rather than inventing one.
- Two consecutive fix attempts fail on the same check - report `BLOCKED` with the full output rather than a third guess.
- The task requires editing `.dsh/base/lib/*` - forbidden; report the limitation.

## Anti-patterns
| Failure mode | Correction |
|---|---|
| Starting work from a one-line request without an envelope | Return `NEEDS_CONTEXT` listing the missing fields |
| Fixing an unrelated bug noticed in passing | Record it in the result under Not verified or as a new TODO; leave the diff clean |
| Introducing a second HTTP client, logger, or error type | Reuse the pattern named in the envelope; a new one needs an ADR |
| Reporting `DONE` with `fitness` or `budget` unrun | All three self-checks run and quoted, or the status is not `DONE` |
| Silencing a fitness finding with `dsb-fitness:ignore` and no reason | Give the reason inline; never suppress a security, safety, or privacy rule |
| Reading twenty files with twenty tool calls | One `run_code` program with batched `Promise.all` reads |
| Leaving the tree non-compiling between checkpoints | Land each step complete; a broken intermediate state blocks every parallel task |
| Claiming a pre-existing failure was caused elsewhere without evidence | Capture the baseline run before editing and quote it |
