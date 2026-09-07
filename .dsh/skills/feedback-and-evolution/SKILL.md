---
name: feedback-and-evolution
description: Use when the same correction, defect or workaround recurs, when proposing to graduate a lesson into a mechanism, or when auditing whether existing checks earn their cost.
whenToUse: After any repeated correction, and at every phase close for the gate-effectiveness audit.
bridge: true
---

## Purpose
Convert repeated corrections into mechanisms instead of into longer instructions. Produces lesson files under `.dsh/base/feedback/`, graduation proposals at defined thresholds, and a periodic audit that retires controls which never intervene.

## When this fires
- A human corrects the same behaviour a second time.
- A defect class reappears after being fixed once.
- A workaround is copied from one module to another.
- A phase closes (run the gate-effectiveness audit).
- A new skill is proposed because "the agent keeps getting X wrong".

## Procedure

### L1 - Record the lesson (every occurrence)
1. Write or update `.dsh/base/feedback/<slug>.md`. One slug per behaviour, not per incident.
```
---
title: <one line, the behaviour to change>
source: <human-correction | defect | review | incident | gate-failure>
occurrences: <integer>
first_seen: <YYYY-MM-DD>
last_seen: <YYYY-MM-DD>
graduated: <false | check:<check-id> | fitness:<rule-id> | skill:<name> | agents-md>
skipped: <false | YYYY-MM-DD reason>
---

## Observed
<What happened, with a path or command and an evidence pointer.>

## Expected
<The behaviour that should have occurred, stated decidably.>

## Candidate mechanism
<check id | fitness rule id | skill step | prose - and why that layer.>

## What changed (shown to the human)
- file: <before> -> <after>   (filled in when the lesson is applied; a
  correction the user cannot see is an apology with extra steps; enforced by
  skills-lint: LESSON_WHAT_CHANGED_MISSING once graduated is set)
```
2. Increment `occurrences` and update `last_seen`. Never fork a second file for the same behaviour; the count is the signal.

### L2 - Propose graduation (at 3 occurrences)
1. At `occurrences >= 3`, stop recording and propose. A lesson recorded five times without a proposal is a logbook, not a mechanism.
2. Choose the target by the preference order in section "Graduation targets".
3. Present the proposal to the human with: the lesson slug, occurrence count, proposed target, the exact catalog or file edit, and the cost (what it adds to every run).
4. Every graduation needs explicit human confirmation. On confirmation, apply the edit and set `graduated:`. On refusal, set `skipped: <date> <reason>` and never re-propose that lesson.
5. After applying, show the human the before/after of the exact edit - one line
   per changed file - and record it under the lesson's What changed section.
   The correction is not done until the user can see what their instruction
   changed. This is the visibility step: no "noted", no silent fix.
6. Run `node .dsh/base/dsb.mjs skills-lint` (exit 0 required). A graduated
   lesson whose What changed block is still the template fails with
   `LESSON_WHAT_CHANGED_MISSING` - the loop is not complete until the machine
   says so.

### L3 - Optimise the owning skill
1. When a covering skill exists but was not followed, the defect is in the skill, not in the agent: the trigger, an ambiguous step, or a missing stop condition.
2. Fix the smallest thing: sharpen the `description` trigger, make one step decidable, or add the missing stop condition. Then `node .dsh/base/dsb.mjs skills-lint` (exit 0 required).
3. Re-run that skill's behaviour test before closing the lesson.

### L4 - Propose a new skill (at 5 occurrences, no covering skill)
1. At `occurrences >= 5` with no skill owning the behaviour, propose one new skill via `skill-authoring`.
2. The proposal states the trigger phrase, the procedure outline, and which existing skill would otherwise have to grow. A new skill is justified only when no existing skill has the right trigger.
3. Human confirmation required, as in L2.

### Graduation targets (strongest first)
| Rank | Target | Cost | Use when |
|---|---|---|---|
| 1 | Executable check wired into `checks{}` + `riskChecks` | zero until it fires | The rule is mechanically decidable from the repo. |
| 2 | Fitness rule id (`no-secret-literal`, `no-pii-in-logs`, `no-silent-failure`, `no-unbounded-retry`, `no-unreferenced-deferral`, `no-insecure-transport`, `no-unsafe-dynamic-exec`, `no-weak-crypto`, `no-unbounded-resource`) | one scan pass | The rule is a code pattern rather than a build step. |
| 3 | A step in the owning skill | body bytes at load time | The rule needs judgement but has a clear trigger. |
| 4 | Prose in `AGENTS.md` | context on every request, forever | Nothing above fits, and the rule is a true invariant. |
Instruction prose is last because it is the only layer billed on every request whether or not it is relevant; a check costs nothing until it fires. Verify the prose budget with `node .dsh/base/dsb.mjs agents-lint` (exit 1 = over `agentsMd.maxBytes` or missing where required).

### Gate-effectiveness audit (every phase close)
1. `node .dsh/base/dsb.mjs gate-audit` - lists checks and their intervention history, naming those that have never failed.
2. For each never-failed check ask the standing question: is this control genuinely stable, or does it never actually run? Distinguish with the check's own history: zero runs is a broken wiring; many runs and zero failures is either a solved class or a check with no teeth.
3. A control that has never intervened is cost plus false confidence. It must earn its place with data: show a run where it would have failed (a deliberate red test), or retire it.
4. Retirement is a catalog edit with human confirmation, recorded as a lesson with `graduated: check:<id>` reversed to a note. Protected attributes (`security`, `safety`, `privacy`) are never retired on cost grounds.
5. `node .dsh/base/dsb.mjs fitness --all` and `node .dsh/base/dsb.mjs dod` after any catalog edit; exit 1 means the edit broke a rule.

## Dialogue examples

One real exchange, compressed: the correction changes the mechanism, and the
human sees the exact change before the topic closes.

    User: Stop telling me "noted" - I want to see which line you changed.
    AI:   Understood. This correction lands in quality.mjs applyWaivers:
          before, an executed FAIL was rewritten into SKIPPED; after, the
          waiver resolves before the check runs and an executed result is
          immutable - plus one red test. Is this diff what you meant?
    User: Exactly.
    -> What happened: the correction became a visible before/after, not a
       feedback file entry. The user confirms the CHANGE, not the apology.

Counterexample - the fifth occurrence is recorded, nothing is proposed:

    AI:   (same correction, fifth time) Recording occurrence 5 under the
          same slug.
    User: 记了五次,然后呢?
    -> why it fails: a logbook is not a mechanism; at 3 occurrences L2 stops
       recording and proposes a graduation, so the fifth occurrence never
       happens.

## Facts vs inference

| Lesson element | Marker | Rule |
|---|---|---|
| source: human-correction | F | the user said it; quote or point at it, never paraphrase it away |
| source: review / gate-failure / defect | F | machine-observed with evidence pointers |
| Candidate mechanism and graduation target | I | a proposal until the human confirms; a refused proposal stays skipped with the date and reason |
| occurrences count | F | the signal that turns a logbook into a mechanism |

## Handoff

The next audit receives: the lesson files with What changed filled in, the
graduation decisions with human confirmations, and the gate-audit data - so a
future session can tell a mechanism that earned its cost from one that never
fired, without re-litigating the corrections that built them.

## Output contract
Lesson file: `.dsh/base/feedback/<slug>.md` with the frontmatter above.
Graduation proposal (in-message, one per lesson):
```
Lesson      : <slug> (occurrences <n>, first_seen <date>)
Evidence    : <path or command -> exit code>, <path>...
Target      : check:<id> | fitness:<rule-id> | skill:<name> step <n> | agents-md
Edit        : <exact file and change>
Cost        : <what runs, when, and on whose critical path>
Alternative : <the next-weakest target and why it was not chosen>
Decision    : <pending human confirmation>
```
Audit output (per phase close):
```
Checks total: <n>   Never failed: <ids>   Never run: <ids>
Action      : <keep with red-test evidence | retire | fix wiring> per id
```

## Stop conditions
Halt and ask the human when:
- A graduation would add a blocking check to a `critical`/`high` module owned by someone else.
- The candidate mechanism cannot be made decidable, so only prose remains: confirm the invariant is real before spending permanent context on it.
- `gate-audit` reports a never-run check on a protected attribute: this is a broken control, and disabling it is not the fix.
- A lesson recurs after graduation: the mechanism does not cover the case, and re-proposing the same target will not help.
- Occurrences are being counted across behaviours that are not actually the same.

## Anti-patterns
| Failure mode | Correction |
|---|---|
| Adding a paragraph to `AGENTS.md` after every correction. | Prose is the last resort; try check, fitness rule, then skill step first. |
| Recording lessons forever without proposing. | At 3 occurrences, propose; the count exists to trigger action. |
| Graduating silently because the fix seems obvious. | Every graduation needs explicit human confirmation. |
| Re-proposing a lesson the human already declined. | Set `skipped:` with the date and reason; never re-propose. |
| Writing a new skill when an existing one has the right trigger. | Fix the owning skill (L3); a duplicate trigger degrades routing for both. |
| Treating a never-failing check as proof of quality. | Ask whether it runs at all; demand a red test or retire it. |
| Retiring a `security`/`privacy` check because it is quiet. | Protected attributes are never retired on cost grounds; fix the wiring instead. |
| One lesson file per incident. | One slug per behaviour; the occurrence count is the signal. |
