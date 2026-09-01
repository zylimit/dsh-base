---
name: adversarial-review
description: Use when reviewing a change before merge, when acting as reviewer for a subagent's work, or when a receipt must be written to close a task.
whenToUse: Every time a change is proposed for merge or a task is being closed with a review verdict.
---

## Purpose

Review by trying to break the change, not by confirming it looks fine. Three gates in fixed order (static, spec compliance, quality), then a Blue/Red/Judge protocol run through `node .dsh/base/dsb.mjs review` so the verdict - `ACCEPT | FIX_REQUIRED | NEEDS_MORE_EVIDENCE` - is computed from recorded evidence rather than argued, and on ACCEPT a diff-bound receipt is written for you.
The orchestration of the lenses (one background agent each, prompts that keep them apart) is in `structured-review`; this skill is the reviewer's own procedure.

## When this fires

- A change is proposed for merge, or a subagent reports `DONE` / `DONE_WITH_CONCERNS`.
- `node .dsh/base/dsb.mjs task complete` reports the blocker "no fresh ACCEPT review receipt bound to the current diff".
- `node .dsh/base/dsb.mjs receipt verify` exits 4 (stale evidence: the tree moved after the last receipt), or `review status` prints `[STALE: the tree changed]`.
- The user invokes `/adversarial-review`.

## Procedure

Each stage is a hard gate. A failure at any stage stops the review, returns the verdict, and the loop restarts at Stage 0 after the fix - not at the stage that failed.

1. Open the session and build the evidence pack: `node .dsh/base/dsb.mjs review start` binds the review to the current `diffHash` and prints the required lens set (exit 3 when there is no catalog or no change to review), then `node .dsh/base/dsb.mjs review-pack`. Review that pack. Do not assemble your own diff view: a self-selected diff is where reviewers skip files. Exit 3 means governance is not configured; report that instead of pretending to review.
2. Stage 0 - static. Run `node .dsh/base/dsb.mjs gate` (exit 2 = blocking failure) and `node .dsh/base/dsb.mjs fitness --all` (exit 1). Read the four states literally: `PASS`, `FAIL`, `BLOCKED` (tool missing or plan empty - never a pass), `SKIPPED` (fast-mode or waiver; protected attributes are never skippable). Any `FAIL` or `BLOCKED` ends the review with `FIX_REQUIRED`; do not proceed to read the code for quality.
3. Stage 1 - spec compliance. From the task envelope and the requirement docs, list the `REQ-`/`NFR-`/`HAZ-`/`THR-` ids in scope. For each, point to the code that satisfies it and the test that proves it. Then check the converse: anything in the diff that satisfies no id in scope is unrequested scope - name it. Run `node .dsh/base/dsb.mjs trace` (exit 1 = an id with no test, or a dangling id). Missing coverage ends the review with `FIX_REQUIRED`.
4. Stage 2 - quality. Work through this order and record a finding or an explicit "checked, clean" per line:

   | Axis | What to attack |
   | --- | --- |
   | Design | Does it fit the module's stated boundary, or does it leak across a layer edge? `node .dsh/base/dsb.mjs arch-check` (exit 1) |
   | Boundaries | Input validation at the trust boundary, output encoding at the sink, error types crossing the edge |
   | Failure modes | Timeout, retry bound, partial write, restart mid-operation, dependency down, concurrent callers |
   | Security | Authn/authz on every new path, secrets, injection sinks, insecure transport |
   | Privacy | New personal data in logs, exports, third-party calls; retention and deletion path |
   | Tests | Do they fail without the change? Are they asserting behaviour or implementation? Any sleeps, any shared state? |
   | Deletion audit | What did the diff remove: a test, a guard, a validation, an interlock, a log line? |

5. Deletion audit, explicitly. Extract removals from the pack and account for each: a deleted test needs a replacement or a written reason; a deleted guard needs the hazard or threat to be retired in writing; a deleted log line needs its diagnostic covered elsewhere. Silent removals are the most common way a green build hides a regression.
6. Run the Blue/Red/Judge protocol through the engine, which records each role and computes the verdict. Blue and Red remain separate passes with separate outputs; Judge no longer votes, it counts.

   | Role | Command | Recorded output |
   | --- | --- | --- |
   | Blue | `review blue < claims.json` | `{"claims":[{"claim":"...","evidence":"..."}]}` - what was verified and how, with command output plus exit code or `path:line` per claim. A claim carrying no evidence is refused and the whole payload is rejected (exit 1). |
   | Red | `review lens <name> < findings.json` | `{"findings":[{"severity":"error","location":"file:line","summary":"..."}]}` with severity `error`, `warning` or `info`, or `"reproduction":"<steps>"` in place of `"location"`. Red is not one pass: it is one report per required lens - security, privacy, resilience, reliability, correctness - each from its own agent. A finding with neither a location nor a reproduction is refused whole (exit 1). A lens that cannot conclude sends `{"unable":true,"unableReason":"...","findings":[]}`. |
   | Judge | `review verdict --reviewer "<who>" --notes "<root cause>"` | Refuses while Blue is silent or any required lens never reported (exit 1, blockers listed). Then: any `error` finding -> `FIX_REQUIRED`; any `unable` lens -> `NEEDS_MORE_EVIDENCE`; otherwise `ACCEPT`. `ACCEPT` exits 0, the other two exit 2. |

   Verdicts: `ACCEPT` (every required lens reported and none found an error), `FIX_REQUIRED` (a located error; four clean lenses do not outvote it), `NEEDS_MORE_EVIDENCE` (a lens could not conclude; name the exact evidence needed and supply it rather than accepting around it).
7. Bound the loop: maximum two Blue/Red/Judge rounds. A third round means the disagreement is not resolvable by review - escalate to the human with both positions stated in one paragraph each.
8. On `ACCEPT`, `review verdict` writes the receipt itself, recording which lenses covered the diff; `--reviewer` and `--notes` (the Root cause line for a defect fix) go into it. Write one by hand with `node .dsh/base/dsb.mjs receipt write` only where `catalog.review.requireStructured` is `false`. Either way the receipt binds the current diff hash: any byte changed afterwards stales it (`receipt verify` exits 4) and the review is redone against the new diff.
9. Close the task: `node .dsh/base/dsb.mjs task complete`. It refuses while there is no passing gate bound to this diff, no fresh ACCEPT receipt, an accepting receipt that records no lens coverage, a gate that ran in fast mode, a broken ledger, or an empty verification plan. Do not work around a refusal; fix what it names.

## Output contract

Review report, in this shape:

```
Verdict: ACCEPT | FIX_REQUIRED | NEEDS_MORE_EVIDENCE   (review verdict exit <n>)
Pack: <path from review-pack>            Diff hash: <hash>
Lens coverage: security | privacy | resilience | reliability | correctness   (unable: <lens or none>)
Stage 0: PASS | FAIL   (gate exit <n>, fitness exit <n>, BLOCKED checks: <ids>)
Stage 1: PASS | FAIL   (ids in scope: <list>; unrequested scope: <list or none>)
Stage 2: PASS | FAIL

Findings
| # | severity | file:line | finding | reproduction | required fix |
| 1 | major    | src/a.ts:88 | retry loop has no cap | send 3 x 500 from dep | bound attempts + jitter |

Blue verified: <claim -> evidence> ...
Red unresolved: <finding ids> ...
Deletion audit: <removed item -> justification or finding>
Receipt: <written | not written, reason>
```

Severity scale: `critical` (data loss, security or safety breach), `major` (requirement unmet, failure mode unhandled), `minor` (maintainability), `nit` (style; never blocks).

## Stop conditions

Halt and ask the human when:

- Two full Blue/Red/Judge rounds end without agreement.
- `review-pack`, `review start` or `gate` exits 3 (degraded, not configured, or nothing changed): you cannot review evidence that was never produced.
- Any `review` subcommand exits 4: the tree moved, the session is stale. Re-open it and re-run every lens; a partly reused session is not evidence.
- The change requires a waiver on a check claiming `security`, `safety` or `privacy` - the engine refuses these outright.
- The diff exceeds the declared budget (`node .dsh/base/dsb.mjs budget`, exit 1): ask for a split rather than reviewing a change too large to hold.
- You are asked to review code you wrote in this same session and no independent reviewer is available - state the conflict in the report.
- `ledger verify` reports a broken chain: prior evidence is untrusted, so no verdict can rest on it.

## Anti-patterns

| Failure mode | Correction |
| --- | --- |
| Reviewer edits the code to fix what it found | A reviewer never edits the code it reviews; return `FIX_REQUIRED` with the required change. |
| Finding written as "error handling could be better" | Refused by `review lens` (exit 1): a finding needs `path:line` or a reproduction path, an impact and a required fix. |
| Judge asserting a verdict it decided in advance | The verdict is computed from what Blue and the lenses recorded; record first, then read `review verdict`. |
| One agent writing all the lens reports | Consensus reached cheaply is not review; dispatch one agent per lens as `structured-review` describes. |
| Reviewing a diff the reviewer assembled | Review the `review-pack` output; self-assembled views silently omit files. |
| Proceeding to Stage 2 while Stage 0 has a `BLOCKED` check | BLOCKED means nothing ran; fix the tooling first, then restart at Stage 0. |
| ACCEPT with "tests pass" as the only evidence | Name which requirement each test proves; passing tests that assert nothing in scope prove nothing. |
| Only added lines reviewed | Run the deletion audit; removed guards and tests are the cheapest way to fake a green build. |
| Receipt written before the last edit | Any byte change stales the receipt (exit 4); write it last, then stop touching the tree. |
| Endless review rounds | Two rounds maximum, then escalate with both positions stated. |
