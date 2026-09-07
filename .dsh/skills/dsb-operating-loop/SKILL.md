---
name: dsb-operating-loop
description: Use when any non-trivial change starts or resumes; drives the nine-phase dsb loop, the evidence rule that bans unproven claims, and the three approval tiers.
whenToUse: Any change beyond a trivial one-line edit, and every session resume or handoff.
bridge: true
---

## Purpose
One control loop for non-trivial work in this repo: nine ordered phases, each with the gate that closes it, the artifact it leaves behind, and the dsb command that proves the gate held.
It produces a replayable trail (spec, catalog, plan, diff, ledger entry, receipt) instead of assertions, and it fixes when the agent may act alone and when it must stop for a human.

## When this fires
- The change touches more than one file, or any file in a module whose `riskTier` is `high` or `critical`.
- Work resumes in a new session, after compaction, or after a handoff from another agent.
- A human asks for status and the answer must be evidence-backed.
- A push, release, deploy, schema migration, dependency addition, secret handling, or destructive command is in view.

## Procedure

1. Enter at the earliest phase whose artifact is missing, stale, or unproven. Never skip forward; a later phase built on an unclosed earlier gate is rework, not progress.

| # | Phase | Gate that closes it | Artifact | Proof command |
|---|-------|---------------------|----------|---------------|
| 1 | Frame | Problem, risk tier and blast radius written | task envelope (6 fields) | `node .dsh/base/dsb.mjs doctor` |
| 2 | Specify | Every REQ/NFR decidable and acceptance-tested | `docs/requirements/PRODUCT-SPEC.md` + changelog | `node .dsh/base/dsb.mjs spec-lint` |
| 3 | Design | Design expressible as modules, layers, forbidden edges | `docs/architecture/ARCHITECTURE.md` + `.dsh/base/catalog.json` | `node .dsh/base/dsb.mjs catalog-lint` then `arch-check` |
| 4 | Plan | No placeholder task; every task inside the change budget | `docs/plan/DEV-PLAN.md` | `node .dsh/base/dsb.mjs budget` |
| 5 | Implement | Scope respected; tree compiles at every checkpoint | diff | `node .dsh/base/dsb.mjs impact` then `fitness` |
| 6 | Verify | Four-state gate resolves to PASS | ledger entry | `node .dsh/base/dsb.mjs gate` |
| 7 | Review | Verdict recorded as ACCEPT | review pack | `node .dsh/base/dsb.mjs review-pack` |
| 8 | Record | Decisions, evidence and memory persisted | `progress.md`, `docs/adr/*`, receipt | `receipt write`, `adr-check`, `ledger verify` |
| 9 | Release | Definition of done closed and human authorization obtained | tag/artifact + verified receipt | `node .dsh/base/dsb.mjs dod` then `receipt verify` |

2. Read every exit code literally: `0` clean, continue. `1` rule violation - fix the named rule, do not proceed. `2` blocking gate failure - stop the phase. `3` degraded or not configured - stop; a degraded result is never a green. `4` stale evidence - re-run the producing command before quoting it.
3. Frame: write the six-field task envelope (Goal / Scope / Out of scope / Existing pattern / Verification / Escalation) and classify the approval tier. Run `node .dsh/base/dsb.mjs doctor`; exit `3` means governance is not configured - say so instead of claiming a green baseline.
4. Specify: apply the `requirements-elicitation` skill. Close with `node .dsh/base/dsb.mjs spec-lint` at exit `0`; exit `1` names the offending requirement id.
5. Design: apply the `architecture-design` skill. Close with `catalog-lint` then `arch-check`, both exit `0`. A forbidden-edge violation exits `1` and stops the phase.
6. Plan: apply the `work-planning` skill. Close with `node .dsh/base/dsb.mjs budget`; exit `1` means split the task, never widen the budget.
7. Implement: apply the `scoped-implementation` skill, one plan task at a time. After each task run `node .dsh/base/dsb.mjs impact` to see the affected modules and `fitness` for the changed paths.
8. Verify: apply the `verification-gate` skill. `node .dsh/base/dsb.mjs gate` must end `PASS`; `FAIL`, `BLOCKED` and `BLOCKED_BY_ATTRIBUTES` all stop the loop.
9. Review: produce the review pack, obtain a verdict of `ACCEPT`, `FIX_REQUIRED`, or `NEEDS_MORE_EVIDENCE`. Anything but `ACCEPT` returns to phase 5.
10. Record: append to `progress.md` per the `progress-ledger` skill, write ADRs for decisions with rejected alternatives, then `node .dsh/base/dsb.mjs receipt write` and `ledger verify` (exit `0`).
11. Release: apply the `release-readiness` skill. This phase always requires HIGH-tier human authorization.

### Evidence five-step (mandatory before any factual claim)
1. Name the exact command that would prove the claim. If no such command exists, the claim is an opinion - label it as one.
2. Run it fresh and uncached in this session. A result from an earlier turn, before the current edits, is stale evidence.
3. Read the full output AND the exit code. Neither alone is sufficient.
4. Confirm the output actually supports the claim: an exit `0` from a run that executed zero checks proves nothing, and a passing suite that never touched the changed module proves nothing about it.
5. Only then state the claim, quoting the command and its exit code.

Banned phrases: "should work", "probably", "looks correct". Replace with either a command plus exit code, or the explicit sentence "not verified: <what is missing>".

### Approval tiers
| Tier | Definition | Action |
|------|------------|--------|
| LOW | Reversible, local, inside the declared Scope: reading, searching, editing files named in the envelope, running read-only dsb commands | Proceed silently |
| MEDIUM | Reversible but outside the immediate scope: creating a new file inside Scope, refactoring a named helper, running a long verification, writing a receipt | Announce in one line, then continue |
| HIGH | `git push`, tag, release, deploy, destructive commands (`rm -r`, `git reset --hard`, force-push, DB writes), secrets or credentials, schema migration, dependency addition or upgrade, license change, editing `.dsh/base/lib/*` | Stop and obtain explicit human authorization via `ask_user_question` before acting |

When the tier is ambiguous, take the higher tier. Delegated subagents run with approval policy pinned to `never`: a subagent that hits a HIGH-tier need must report `BLOCKED` upward, not attempt the action.

0. Pick the interaction depth before entering the loop. The depth adapts to
   business understanding, problem complexity, and user willingness - and it
   changes by signal, not by mood.

| Depth | Trigger | Behaviour |
|---|---|---|
| 1 Advance | scope is clear, verification decidable, the user said go | proceed phase by phase, report at each gate, never re-ask an answered or authorized question |
| 2 Explore | the problem matters and the understanding is not confirmed | co-explore: restate understanding in concrete context, ask 1-2 questions, each naming the decision it unblocks, iterate until F/I/U is sorted |
| 3 Learn | the user is teaching business context | listen first: record user facts (F) into the ledger immediately, do not interrupt with solutions or "let me explain" |

   Transitions: an authorization received at any depth is recorded in Pinned
   with scope and expiry, so the next session inherits it. A correction from
   the user changes the depth or the artifact - never just an apology.

## Dialogue examples

Two real exchanges, compressed: the first shows the depth switching on a user
signal; the second shows learning mode listening before proposing.

Exchange 1 - the user authorizes autonomy; the loop switches depth and records it:

    User: 三轮直接往下,除非阻塞了,不然不要找我。
    AI:   明白:三轮自主,只在阻塞时升级。这条记进 Pinned(范围:本次目标,
          有效期:三轮),后面两轮我只在每个闸门报告。
    -> What happened: the authorization became a recorded mandate, so "already
       answered" questions are not re-asked - by this session or the next.

Exchange 2 - the user is teaching; learning mode records facts first:

    User: 我们这行,标书错了比慢更致命。
    AI:   记下了:F - 正确性优先于速度,这是你们行业的既定事实。我先不动
          方案,继续听:还有什么是我按通用工程直觉就会搞错的?
    -> What happened: the user's business knowledge became an F in the ledger
       before any solution talk - the loop learns before it moves.

## Facts vs inference

| Loop element | Marker | Rule |
|---|---|---|
| artifacts closed by a gate (spec, catalog, ledger entry, receipt) | F | machine-verified; a phase built on an unclosed gate is I no matter how confident it reads |
| envelope fields, approval-tier judgement | F from the user, I from the agent | an I is restated concretely and confirmed before it becomes scope |
| the mandate in Pinned | F | authorizations only; never inference |

## Handoff

The next session receives: the phase to re-enter (earliest artifact missing,
stale, or unproven), the replayable trail, the Pinned mandate with scope and
expiry, and the depth that was in force - so it resumes the conversation the
user was actually having, not the one the artifacts suggest.

## Output contract
Every turn that advances the loop ends with this block:

```
Phase: <one of the nine>
Gate: <command> -> exit <code> -> <PASS|FAIL|BLOCKED|SKIPPED|n/a>
Artifact: <path(s) written or updated>
Tier: <LOW|MEDIUM|HIGH> (<why, if MEDIUM or HIGH>)
Next: <the single next action, or the question that blocks it>
```

Phase 5 and later additionally report the six-field result envelope: Status (`DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`) / Changed / Verified / Not verified / Needs review by / Evidence.

## Stop conditions
- Any dsb command exits `2`, `3`, or `4` and the fix is not inside the declared Scope.
- The approval tier is HIGH, or ambiguous between MEDIUM and HIGH.
- The task envelope is missing a field, or Scope does not name concrete paths: return `NEEDS_CONTEXT`, do not guess.
- A gate can only be made green by widening a budget, editing a check definition, waiving a protected attribute (`security`, `safety`, `privacy`), or re-running with narrower arguments.
- The spec and the code disagree: stop and ask which one is wrong; do not silently change either.
- Two consecutive verification rounds fail for the same reason: stop and report the blocker instead of a third attempt.

## Anti-patterns
| Failure mode | Correction |
|---|---|
| Reporting success after editing files but before running the gate | No claim without the five-step; run `gate` and quote the exit code |
| Treating exit `3` (degraded) as a pass because nothing failed | Degraded means nothing was proven; report it as unverified and name the missing configuration |
| Jumping from Frame straight to Implement because "the change is obvious" | Obvious changes still need Scope and a Verification command; write the envelope, it costs one minute |
| Re-running a failed check with different flags or a narrower path until it passes | The first honest result stands; fix the cause or report `FAIL` |
| Pushing, tagging, or adding a dependency because it "unblocks" the task | HIGH tier - stop and ask; a blocked task is a valid outcome |
| Batching nine phases into one silent mega-turn | Report the phase block after each phase; a reviewer must be able to stop you at any boundary |
| Quoting a green result from before the last edit | Evidence is diff-bound; any byte change stales the receipt, re-run |
| Writing "verified" when only the happy path was executed | State exactly what ran in Verified and list everything else under Not verified |
