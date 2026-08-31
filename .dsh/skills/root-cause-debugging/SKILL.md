---
name: root-cause-debugging
description: Use when something fails, behaves unexpectedly or fails intermittently, and before proposing any fix, workaround, retry, timeout increase or restart.
whenToUse: At the start of any investigation into a failure, and before any fix is written.
---

## Purpose

Find the first bad state and prove it, instead of muting the first visible symptom. Produces a written cause chain, a discriminating experiment, and a `Root cause:` line recorded in the review receipt so the same defect cannot be closed twice without evidence.

## When this fires

- A test, check or build fails; a service errors; output is wrong; behaviour is intermittent.
- `node .dsh/base/dsb.mjs risk` reports `FAIL_STREAK` (a check failed three times in a row).
- Someone proposes a retry, a timeout increase, a cache clear, a restart or a budget increase as the fix.
- A defect returns after being closed.
- The user invokes `/root-cause-debugging`.

## Procedure

Answer the five questions in order. Do not skip forward; an answer that is "unknown" is the next task, not a reason to guess.

1. **What exactly was expected, and what exactly happened?** Quote the command, the full error, the exit code, and the observed value against the expected value. "It does not work" is not an observation. Capture the artifact (log path, evidence file under `.dsh/base/evidence/`, screenshot) before anything is retried, because a rerun may destroy the state.
2. **What is the minimal reproduction?** Reduce until removing one more element makes the failure disappear: fewest inputs, smallest data, one process, no orchestration. Record the reproduction as a command someone else can run. If it reproduces only sometimes, record the observed rate (for example 3 of 20 runs) - that number is evidence about the mechanism (race, ordering, resource exhaustion, clock, DNS).
3. **Did this ever work, and what changed?** Find the last known-good state and bisect between it and now: commits, config, dependency versions, data, environment, traffic pattern. `git bisect` with the minimal reproduction as the test is faster than reading code. If it never worked, say so explicitly - that removes "a regression" from the hypothesis set.
4. **What are at least two competing hypotheses, and which experiment discriminates?** Write H1 and H2 so that one experiment produces different outcomes under each. A single hypothesis is a belief; two plus a discriminating experiment is debugging. Record the prediction before running the experiment, then the result. Counter-evidence outranks confirming evidence: one observation that contradicts H1 kills it, ten that agree do not prove it.
5. **Does the proposed change address the cause or the symptom?** State the cause chain in one line: trigger -> first bad state -> propagation -> visible symptom. Point at which link the fix cuts. If the fix cuts the last link, it is a mask.

Then:

6. Locate the **first bad state**, not the first visible symptom. Walk backwards from the symptom, asserting invariants at each stage until you find the earliest point where a value, an ordering or a resource is already wrong. Add an assertion there; the assertion is often the permanent fix, because it converts a silent corruption into a loud failure.
7. Apply the **three-strike breaker**. If the same root cause fails three times - the same check, the same test, the same incident - stop editing. Write down: what is actually known, what is assumed but unverified, what evidence would settle it, and what was tried with the result of each attempt. Then escalate to the human. `node .dsh/base/dsb.mjs risk` surfaces the same threshold as `FAIL_STREAK` and its advice is identical: stop patching and investigate.
8. Reject non-fixes. These are legitimate mitigations during an incident, and never a resolution:

   | Non-fix | Why it is not a fix | What to do instead |
   | --- | --- | --- |
   | Restart the process/service | Discards the evidence and resets the clock on the same failure | Capture state, then find the leak, deadlock or corrupted cache entry |
   | Clear the cache | Hides a stale-write or invalidation defect | Find who wrote the stale value and why invalidation missed |
   | Increase the timeout | Converts a fast failure into a slow one and consumes callers' deadlines | Measure where the time goes; fix the slow path or shed the load |
   | Add a retry | Duplicates work, amplifies load, can double-apply a non-idempotent write | Determine whether the error is retryable, bound it, add jitter and an idempotency key |
   | Catch and ignore the exception | Deletes the only signal you had (`no-silent-failure`) | Handle it, or propagate it with context |
   | Raise the memory/disk/quota budget | Postpones an unbounded-growth defect | Find the unbounded structure; bound it (`no-unbounded-resource`) |
   | Mark the test skipped | Removes coverage, keeps the defect | Quarantine with an owner and an expiry, and open the defect |

   If you apply one as an incident mitigation, record it as a mitigation with the follow-up id in the same commit message.
9. Verify the fix by re-running the exact minimal reproduction from step 2 and the failing test from red to green, then `node .dsh/base/dsb.mjs gate` (exit 2 = blocking failure) and `node .dsh/base/dsb.mjs fitness --all` (exit 1). If the reproduction is intermittent, run it enough times to make the previous failure rate implausible (for a 3-in-20 rate, 60 clean runs) and record the count.
10. Record the cause. Write `Root cause: <one sentence naming the first bad state and its trigger>` into the review receipt notes: `node .dsh/base/dsb.mjs receipt write` (fields `taskId`, `reviewer`, `verdict`, `scope`, `notes`). A receipt binds to the current diff hash; write it after the last edit, or `receipt verify` exits 4.
11. Close the loop: add the assertion or check that would have caught this class earlier, and name it in the receipt. A defect that leaves no new detector will return.

## Output contract

Investigation record (in the result envelope and the receipt notes):

```
Symptom:        <exact observed output + exit code>
Expected:       <exact expected output>
Reproduction:   <command> | rate: <n of m runs>
Last good:      <commit/version> | first bad: <commit/version> | method: <bisect|config diff>
Hypotheses:     H1 <statement> | H2 <statement>
Experiment:     <what was run> | prediction H1 <x> / H2 <y> | observed <z> | H<n> eliminated
Cause chain:    <trigger> -> <first bad state> -> <propagation> -> <symptom>
Fix cuts at:    <link in the chain>
Root cause:     <one sentence>
Verification:   <test id red -> green> | <clean runs: n> | gate exit <n>
New detector:   <assertion/check/test added, or "none" with reason>
```

## Stop conditions

Halt and ask the human when:

- Three attempts against the same root cause have failed (three-strike breaker), or `risk` reports `FAIL_STREAK` for the same check.
- The failure cannot be reproduced at all and the only remaining option is a speculative change.
- The bisect points at a commit that is not yours and changing it exceeds the task scope.
- The cause is in a third-party dependency or the platform: report the version, the reproduction and the upstream issue rather than patching around it silently.
- The fix would require disabling a check that claims `security`, `safety` or `privacy` - these are never waivable.
- Diagnosis needs production data or credentials you do not hold.

## Anti-patterns

| Failure mode | Correction |
| --- | --- |
| Fix attempted before the reproduction exists | No reproduction means no way to know the fix worked; build it first. |
| One hypothesis, immediately implemented | Write two and the experiment that discriminates; a single hypothesis is confirmation bias with a keyboard. |
| Rerunning until it passes | Record the failure rate; intermittency is data about the mechanism. |
| Fixing the last link (the visible symptom) | Cut the chain at the first bad state; symptom fixes migrate the failure elsewhere. |
| "Fixed by adding a retry" | State why the error was retryable, bound it, add jitter, and prove idempotency (`no-unbounded-retry`). |
| Evidence destroyed by a restart before capture | Capture logs, state and the evidence file first; restarts are irreversible for diagnosis. |
| Receipt without a `Root cause:` line | The receipt is the durable record; without the cause the same defect is closed twice. |
| Fix merged with no new detector | Add the assertion, test or check that catches the class next time, and name it. |
