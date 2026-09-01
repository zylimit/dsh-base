---
name: structured-review
description: Use when a change must be reviewed before merge or before closing a task, and the verdict has to be computed by dsb review from independent lens reports rather than asserted.
whenToUse: Orchestrating the review of a diff - open the session, dispatch one background agent per lens, record their findings, read the computed verdict and act on it.
---

## Purpose

Run `dsb review` as the orchestrator. One session bound to the current diff, one
independent agent per lens, every finding recorded as data with a location, and a
verdict the engine computes from what was actually recorded.

You do not decide the verdict. You decide who looks, at what, with which prompt,
and you keep them from converging. Three agents in structured disagreement measure
better than five in consensus, so the budget goes into separation, not agreement.

## When this fires

- A change is ready for merge, or an implementer subagent reported `DONE` / `DONE_WITH_CONCERNS`.
- `node .dsh/base/dsb.mjs task complete` names the blocker "no fresh ACCEPT review receipt bound to the current diff" or "the accepting receipt records no lens coverage".
- `node .dsh/base/dsb.mjs review status` shows a session marked `[STALE: the tree changed]`.
- The human invokes `/structured-review`.

## Procedure

1. **Clear the static floor first.** Run `node .dsh/base/dsb.mjs gate` (exit 2 blocks) and `node .dsh/base/dsb.mjs fitness --all` (exit 1). A `FAIL` or a `BLOCKED` check ends the review at `FIX_REQUIRED`: lenses reading code that does not pass its own checks spend context proving what a command already proved.
2. **Open the session.** `node .dsh/base/dsb.mjs review start [--scope "<what is under review>"]`. It binds the current `diffHash` and prints the required lens set (default: security, privacy, resilience, reliability, correctness; overridden by `catalog.review.lenses`). Exit 3 means no catalog or an empty diff - there is nothing to review, say that instead of reviewing.
3. **Build the evidence pack.** `node .dsh/base/dsb.mjs review-pack` writes a pack under `.dsh/base/state/review/` and reports `packPath`, `diffLines` and `deletedFiles`. Every lens reads that path. Never let a lens assemble its own view of the change.
4. **Freeze the tree.** From here until the verdict, nothing edits a tracked file and nothing writes an untracked file into the working tree: untracked content enters the diff fingerprint, so a scratch file at the repository root stales the session (exit 4). Keep payloads under `.dsh/base/state/review/` (git-ignored, and excluded from the fingerprint) or in the OS temporary directory.
5. **Record Blue.** Blue is the author-side statement of what was verified and with what evidence. A claim with no evidence is refused and the whole payload is rejected (exit 1).

   ```json
   {"claims":[
     {"claim":"gate PASS over engine-quality and engine-scan","evidence":"node .dsh/base/dsb.mjs gate -> exit 0, ledger entry 4f1c2a"},
     {"claim":"the new refusal path is covered","evidence":"tests/review.test.mjs:41 fails without the change"}
   ]}
   ```

   `node .dsh/base/dsb.mjs review blue < blue.json` (PowerShell: `Get-Content blue.json | node .dsh/base/dsb.mjs review blue`).
6. **Dispatch one background subagent per lens, in a single message.** Each gets its own prompt naming only its lens, the pack path, the diff hash and the output shape. Do not give a lens another lens's findings, do not summarise the pack for it, and do not tell it what the others concluded - shared framing is how five reviewers become one. Each lens returns JSON only; the orchestrator records it.

   Per-lens prompt skeleton:

   ```
   You are the <lens> lens for a review of <packPath> (diff <hash>).
   Read the pack. Attack the change from <lens> alone; ignore every other axis.
   Include the deletion audit: account for every removed test, guard, validation
   and log line. Return ONLY: {"unable":bool,"unableReason":str,"findings":[...]}.
   Every finding carries severity error|warning|info, a summary, and EITHER
   "location":"file:line" OR "reproduction":"<steps another agent can run>".
   A finding you cannot locate is not a finding. If the pack does not let you
   reach a conclusion, set unable:true and name the exact evidence you need.
   ```
7. **Record each lens as it returns.** `node .dsh/base/dsb.mjs review lens <name> < findings.json`. The lens name must be in the required set. A payload where any finding has neither a `file:line` `location` nor a `reproduction` is rejected whole (exit 1) - send it back to that lens, do not invent a location for it.

   ```json
   {"findings":[
     {"severity":"error","location":".dsh/base/lib/quality.mjs:118","summary":"retry loop has no attempt cap"},
     {"severity":"warning","reproduction":"open two sessions, complete both, compare the ledger tail","summary":"lost update on concurrent completion"},
     {"severity":"info","location":"AGENTS.md:96","summary":"rule now duplicated in 5b"}
   ]}
   ```

   A lens that cannot conclude reports that instead of guessing:

   ```json
   {"unable":true,"unableReason":"the pack carries no schema for the migration","findings":[]}
   ```
8. **Read the computed verdict.** `node .dsh/base/dsb.mjs review verdict --reviewer "<who>" --notes "<root cause for a defect fix>"`. It refuses while blue is silent or any required lens never reported (exit 1, blockers listed). Otherwise: any `error` finding gives `FIX_REQUIRED`; any `unable` lens gives `NEEDS_MORE_EVIDENCE`; otherwise `ACCEPT`. `ACCEPT` exits 0 and writes a receipt recording the lens coverage; the other two exit 2.
9. **Act on the verdict.** `FIX_REQUIRED`: return the located errors to the implementer, and after the fix start a new session - the old one is stale by construction. `NEEDS_MORE_EVIDENCE`: supply exactly what the unable lens named and re-run that lens; never accept around it. `ACCEPT`: close with `node .dsh/base/dsb.mjs task complete`, which refuses a receipt that records no lens coverage unless `catalog.review.requireStructured` is `false`.

## Output contract

```
Verdict: ACCEPT | FIX_REQUIRED | NEEDS_MORE_EVIDENCE   (review verdict exit <n>)
Diff: <hash>            Pack: .dsh/base/state/review/review-pack-<ts>.md
Floor: gate <state> (exit <n>), fitness exit <n>
Lenses: security <k> finding(s) | privacy <k> | resilience <k> | reliability <k> | correctness <k>
Unable: <lens - what it needed>, or none
Blue: <n> claim(s), each with evidence
Errors
| lens | severity | file:line or reproduction | summary |
| security | error | .dsh/base/lib/quality.mjs:118 | retry loop has no cap |
Deletion audit: <removed item -> justification or finding>
Receipt: written, lenses [<list>] | not written, reason
```

## Stop conditions

- `review start` exits 3 with `no-change`: there is nothing under review. Report it; do not review the last commit and call it this change.
- A lens returns findings with no location and no reproduction twice: report the lens as unreliable for this change and escalate rather than laundering impressions into the session.
- The tree changes mid-review: every subsequent command exits 4. Re-open the session and re-run every lens; a partially re-used session is not evidence.
- Two rounds of `FIX_REQUIRED` on the same finding without agreement: escalate to the human with both positions in one paragraph each.
- `ledger verify` reports a broken chain, or `gate` is `BLOCKED`: no verdict can rest on unproven evidence.
- No independent agent is available and you would be reviewing your own change: state the conflict in `--notes` and get a human reviewer.

## Anti-patterns

| Failure mode | Correction |
|---|---|
| One agent produces all five lens reports | It converges by construction; dispatch one background subagent per lens with its own prompt |
| Telling lens B what lens A found | Independence is the mechanism; share only the pack, the hash and its own remit |
| Asserting the verdict, then recording findings to match | The verdict is computed from what was recorded; record first, read second |
| Downgrading an `error` to `warning` so the verdict turns ACCEPT | That is evidence editing; fix the cause or return FIX_REQUIRED |
| Accepting a finding written as "error handling could be better" | Refused by the engine (exit 1) and rightly: no location, no reproduction, no finding |
| Treating four clean lenses as outvoting one error | Counter-evidence outranks confirming evidence; one located error blocks |
| Writing scratch JSON into the repository root | Untracked files enter the diff fingerprint and stale the session (exit 4) |
| Reusing a verdict after "one small fix" | Any byte stales the session and the receipt; re-open and re-run |
