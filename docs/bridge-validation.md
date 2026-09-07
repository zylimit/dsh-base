# Bridge validation — real scenarios, observable before/after

How the bridge is validated, and what "validated" is allowed to mean here.
Method honesty first: a scripted conversation proves the test author's
expectations, never the skill's behaviour, so validation is two-layer:
(1) content pins — every scenario class from the real session history must be
covered by the owning skill, asserted by `tests/bridge-scenarios.test.mjs`;
(2) mechanism pins — the correction-visibility loop is machine-enforced by
`skills-lint` (`LESSON_WHAT_CHANGED_MISSING`), asserted red-first by
`tests/feedback-lesson.test.mjs`. Anything a script cannot prove is named as
prompt-only instead of being simulated into a false green.

## Scenario matrix — the real exchanges the skills must cover

| Id | Real event | Bridge requirement | Owning skill | Pinned by |
|---|---|---|---|---|
| S1 | "make me a calculator" | dig for WHY, never solution-jump | requirements-elicitation | bridge-scenarios S1 |
| S2 | "This spec is too detailed" | the correction becomes named edits, not an apology | requirements-elicitation | bridge-scenarios S2 |
| S3 | "算个屁 - the size argument is wrong" | the memory changes, not the apology | progress-ledger | bridge-scenarios S3 |
| S4 | "三轮直接往下,除非阻塞了,不然不要找我" | the mandate is recorded in Pinned so it is never re-asked | progress-ledger | bridge-scenarios S4 |
| S5 | "先同步" after the tradeoff was explained | the human chooses; the consequence and upgrade-trigger are named | architecture-design | bridge-scenarios S5 |
| S6 | corrections must visibly change something | before/after shown to the human, machine-enforced | feedback-and-evolution | bridge-scenarios S6 + feedback-lesson tests |
| S7 | handoff must converge, not dissolve | the next role receives named artifacts | all 7 bridge skills | bridge-scenarios S7 + skills-lint Handoff |
| S8 | the waiver task contradicted the evidence law | business-meaning contradiction fixed upstream in the same change | scoped-implementation | bridge-scenarios S8 |
| S9 | a Decision without the rejected alternative | memory of rationale, or it is a status update | progress-ledger | bridge-scenarios S9 |
| S10 | the user teaches, the user says go, the user wants depth | Advance / Explore / Learn with triggers | dsb-operating-loop | bridge-scenarios S10 |

## Gaps found by validation, and what changed (before -> after)

| Gap | Before (evidence) | After (evidence) |
|---|---|---|
| Counterexamples: the brief demands them, no skill had one | `grep Counterexample` over the 7 bridge skills: 0 matches; bridge-scenarios red: "a bridge skill without a counterexample teaches the right move without naming the wrong one" | 7 skills each carry a compressed counterexample (the default failure + why it fails + which step corrects it); bridge-scenarios green; contract recorded in .dsh/skills/AGENTS.md invariant 5 |
| Correction visibility was prompt-only: the feedback skill demanded a What changed block but nothing checked it | a graduated lesson could keep the unfilled template forever; feedback-lesson test red: lint returned ok on the unfilled template | skills-lint gained the lesson pass: a lesson with `graduated:` set fails with `LESSON_WHAT_CHANGED_MISSING` until the before/after line is real (angle-bracket template excluded); red -> green |

Both gaps were found by writing the validation tests first and reading the
failures — the red phase named exactly these two, nothing else.

## The brief -> mechanism inventory

| Brief item | Where | Enforcement |
|---|---|---|
| questioning strategies (dig WHY, 1-2 questions, offer options when stuck) | requirements-elicitation procedure + Exchange 1 | skill steps, pinned by S1 |
| F/I/U distinction, I restated in context, U parked with owner | every bridge skill's Facts vs inference + spec Source markers | skills-lint bridge sections |
| correction visibility (before -> after) | feedback L2.5 + What changed block | skills-lint LESSON_WHAT_CHANGED_MISSING |
| adaptive interaction depth | dsb-operating-loop step 0 | pinned by S10 |
| business-meaning checks (contradiction = upstream finding) | scoped-implementation + catalog/law checks | pinned by S8 |
| memory of rationale / applicability / corrections | progress-ledger confidence gate + feedback lesson files | sync-check, ledger, lesson lint |
| expert responsibility (propose, judge, explain) | architecture-design tradeoff dialogue, requirements-elicitation option offering | pinned by S5 |
| handoff with owner and deadline | Handoff blocks | skills-lint |

## Tradeoffs stated

1. **Regex pins are content-level.** A marker renamed without the test update
   goes red — that is the intended signal, not brittleness: the test owns the
   convention.
2. **No LLM-behaviour simulation.** A scripted conversation would pin the test
   author's expectations, not the skill; the behavioural remainder stays
   prompt-only and is declared as such (see constitution laws 3, 7.2-7.4, 9, 10).
3. **Size stays bounded.** All 24 skills lint under budget; the largest bridge
   skill is 12,279 bytes, inside the 3-12 KB working envelope with the lint's
   warning threshold far above.
4. **The lesson pass fails closed.** An unreadable lesson frontmatter is an
   error, not a silent skip — same rule as everywhere else in the engine.

## What remains unproven

Real-session performance of the dial itself (how often Explore correctly
switches to Advance under pressure) is behavioural and prompt-only; it is
observed per round in progress.md, not simulated here.
