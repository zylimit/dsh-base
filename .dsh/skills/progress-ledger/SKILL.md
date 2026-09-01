---
name: progress-ledger
description: Use when recording or recovering project state in progress.md; defines the section contract, evidence rule, confidence gate, archiving, and the recovery procedure.
whenToUse: At the end of every working turn, and at the start of any resumed or compacted session.
---

## Purpose
`progress.md` is the project's durable memory: what is pinned, what was decided and why, what remains, and what is proven.
It exists because the model's context is not memory - a compacted summary is a claim, and this file is where claims are replaced by evidence pointers.

## When this fires
- A task, decision, or verification round completes.
- A session resumes, forks, or is compacted, and state must be re-established.
- A human asks "where are we" or hands the work to another agent.
- A risk or assumption is discovered that would change someone else's plan.

## Procedure

1. Keep exactly these sections, in this order: `Pinned`, `Decisions`, `TODO`, `In progress`, `Done`, `Risks and assumptions`, `Notes`, `Context index`.
2. `Pinned` is immutable within a project phase: the goal, the non-negotiable constraints, the paths of the spec, plan, architecture and catalog. Changing a pinned line requires a human decision recorded in `Decisions`.
3. `Decisions` is append-only. Every entry names the rejected alternative and why it lost. An entry without a rejected alternative is a preference, not a decision - rewrite it or move it to `Notes`. Decisions that constrain future code also get an ADR in `docs/adr/` with an `Enforced-by:` line.
4. `TODO` uses monotone ids (`#001`, `#002`, ...) that are never reused, even after a task is cancelled, with a priority of `P0` (blocks the current phase), `P1` (needed this phase), or `P2` (deferred, with the condition that would raise it).
5. `In progress` holds at most what is actually being worked on right now, each line naming the TODO id, the owner (agent or human), and the current blocking question if any.
6. `Done` is newest first, and every entry carries an evidence pointer: a command plus exit code, a ledger entry, a receipt diff hash, or a test output path. An entry without evidence is not written - it belongs in `In progress` until it has one.
7. Apply the confidence gate. Hedged language ("maybe", "probably", "seems", "should be", "I think") may not appear in `Pinned`, `Decisions`, or `Done`. Demote it to `Notes` tagged `Needs-Confirmation` with the command that would settle it.
8. `Risks and assumptions` records each risk with impact, the trigger that would make it real, and the mitigation or the accepted-and-why. Assumptions carry the check that would falsify them.
9. `Context index` maps subjects to paths: spec, changelog, plan, architecture, catalog, key modules, key tests. It is what a fresh agent reads before touching anything.
10. Archive when `Done` passes 100 entries: `node .dsh/base/dsb.mjs archive --apply` moves the oldest into `progress.archive.md`, keeps the newest, and leaves one pointer line. The changelog is bounded the same way and separately: `node .dsh/base/dsb.mjs archive --changelog [--apply] [--keep N]` moves old versions into `PRODUCT-SPEC-CHANGELOG.archive.md`, append-only. Without `--apply` both report what they would move and change nothing (exit `0`, `"applied":false`). Never delete history; never rewrite an archived entry.
11. Recovery is a four-source read, not one file. A recap must read `progress.md` AND `docs/requirements/PRODUCT-SPEC.md` AND `docs/requirements/PRODUCT-SPEC-CHANGELOG.md` AND `node .dsh/base/dsb.mjs task status`. Reading `progress.md` alone is not recovery: it records intent, while `task status` and the ledger record what actually ran. Reconcile disagreements in favour of the engine output, then correct the file.
12. Then re-establish the rules, not just the position: `node .dsh/base/dsb.mjs invariants` derives the non-negotiable set plus the live state - open task, open fast-mode window, last gate, broken ledger - inside ~1200 characters. `recap` says where the work is; `invariants` says what may not be traded away. Run it after any compaction and at every phase boundary, because compaction does not correct instruction drift and nothing else reports that the rules have decayed.
13. Bound the specification read instead of archiving it. A `Done` entry from last year is history, but a requirement from three years ago is still in force, so `PRODUCT-SPEC.md` is the one memory file that has no archive. `node .dsh/base/dsb.mjs spec` renders only the requirements the current change touches, selected by the same impact route the gate uses (`--paths a,b` to scope it by hand, `--budget N` for the character budget, `--all` for the whole document). When the affected modules cite no requirement it reports `noLink` and says the change is untraceable - that is a finding to fix by putting the requirement id in the code or its tests, not an empty result to move past.
14. Verify claims that matter before reusing them: `node .dsh/base/dsb.mjs ledger verify` (exit `0`) and `receipt verify` (exit `4` means the recorded evidence no longer matches the tree).

### Interaction with dsh compaction
dsh may compact a long session into a summary. That summary is a claim about the past, not a fact: it can drop a constraint, merge two decisions, or keep a superseded one. It also does not repair instruction drift: measured across 23 models, a summary carries the drift forward rather than correcting it, so the constitution decays inside a long session while the summary still reads healthy. Rules: (1) after compaction, re-read the four recovery sources AND run `node .dsh/base/dsb.mjs invariants` before acting; (2) never promote a statement from a compacted summary into `Pinned` or `Decisions` without re-deriving it from a file or a command; (3) write to `progress.md` before the context gets long, not after - the ledger is the anti-compaction mechanism.

## Output contract
```
## Pinned
- Goal: <one sentence>
- Constraints: <decidable list>
- Sources: docs/requirements/PRODUCT-SPEC.md | docs/plan/DEV-PLAN.md | .dsh/base/catalog.json

## Decisions
- 2026-02-11 | chose <X> over <rejected Y> | because <reason> | ADR-0007

## TODO
- #014 P0 <task> (blocks phase 3)
- #015 P2 <task> (raise to P1 when <condition>)

## In progress
- #014 | agent | blocked on: <question>

## Done
- 2026-02-11 | #013 <what> | evidence: dsb gate PASS, receipt 9f2c1a, exit 0

## Risks and assumptions
- RISK <impact> | trigger: <observable> | mitigation: <action>
- ASSUMPTION <statement> | falsified by: <command>

## Notes
- Needs-Confirmation: <hedged statement> | settle with: <command>

## Context index
- spec: docs/requirements/PRODUCT-SPEC.md
- architecture: docs/architecture/ARCHITECTURE.md
```

## Stop conditions
- `task status` and `progress.md` disagree about what is complete: stop, re-verify with `gate`/`receipt verify`, and ask the human before overwriting either.
- A `Pinned` line must change: stop and get an explicit human decision; record it in `Decisions` with the rejected alternative.
- The ledger fails verification: stop recording new `Done` entries and report the broken chain.
- A `Done` entry cannot be given an evidence pointer: do not write it; leave it `In progress` and say what is missing.
- Two agents are editing `progress.md` concurrently: stop and serialise; a lost-update here erases project memory.

## Anti-patterns
| Failure mode | Correction |
|---|---|
| "Implemented auth" in `Done` with no evidence | Add command, exit code, and receipt hash, or leave it `In progress` |
| Decisions recorded without the rejected option | Name what lost and why; otherwise it is unreviewable and gets re-litigated |
| Renumbering or reusing TODO ids after cleanup | Ids are monotone and permanent; mark cancelled instead |
| Trusting a compacted summary as project state | Re-read the four recovery sources; a summary is a claim |
| Letting `Done` grow to 400 entries | Archive past 100 into `progress.archive.md` with a pointer line |
| Hedged text in `Pinned` or `Decisions` | Demote to `Notes` as `Needs-Confirmation` with the settling command |
| Recapping from `progress.md` alone | Add spec, changelog, and `dsb task status`; intent is not execution |
| Resuming after compaction without re-reading the rules | `dsb invariants` costs ~1200 chars; drift is invisible until it has already cost something |
| Reading all of `PRODUCT-SPEC.md` to find what this change touches | `dsb spec` renders only the requirements in impact scope, inside a budget |
| Letting the changelog grow unbounded because it is "history" | `dsb archive --changelog --apply` moves old versions out append-only; nothing is deleted |
| Editing an archived entry to make history consistent | History is append-only; add a correcting entry instead |
