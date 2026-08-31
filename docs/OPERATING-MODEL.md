# Operating model

How work actually flows in this repository: nine phases, four sign-off gates, three
approval tiers, one evidence rule, and an explicit list of the conditions under which an
agent stops and asks a human.

Legend: **M** = machine-enforced (command and exit code named). **P** = prompt-only (no
command can decide it; it is a rule people and agents follow, checked at review).

## 1. The nine-phase loop

Enter at the earliest phase whose artifact is missing, stale or unproven. A later phase
built on an unclosed earlier gate is rework, not progress.

| # | Phase | Entry condition | Artifact produced | Exit gate command | Signs off |
|---|---|---|---|---|---|
| 1 | Frame | A request exists that is more than a one-line edit | Task envelope in `.dsh/base/state/task.json` | `dsb task start` (exit 0) and `dsb doctor` (read `failing`, not the exit code) | Orchestrator |
| 2 | Specify | The problem is stated but not yet decidable | `docs/requirements/PRODUCT-SPEC.md` + `PRODUCT-SPEC-CHANGELOG.md` | `dsb spec-lint` → exit 0 | Human — spec gate |
| 3 | Design | Every `REQ`/`NFR` is decidable and acceptance-tested | `docs/architecture/ARCHITECTURE.md`, `.dsh/base/catalog.json`, module `AGENTS.md`, `docs/adr/*` | `dsb catalog-lint`, `dsb arch-check`, `dsb adr-check`, `dsb agents-lint` → all exit 0 | Human — design gate |
| 4 | Plan | Design signed off; modules, layers and forbidden edges exist | `docs/plan/DEV-PLAN.md` | `dsb budget` → exit 0 | Orchestrator; human if over budget |
| 5 | Implement | One plan task selected; its envelope has all six fields | The diff | `dsb impact` then `dsb fitness --paths <changed>` → exit 0 | Implementer (self-check) |
| 6 | Verify | Tree builds; scope respected | Gate record appended to the ledger | `dsb gate` → `PASS`, exit 0 | Engine; orchestrator reads the record |
| 7 | Review | A `PASS` gate record bound to the current `diffHash` | Review pack under `.dsh/base/state/review/` | `dsb review-pack` then a verdict of `ACCEPT` | Reviewer — a second agent or a human, never the author |
| 8 | Record | Verdict is `ACCEPT` | Receipt, ADRs, `progress.md` entries | `dsb receipt write`, `dsb adr-check`, `dsb ledger` → exit 0 | Orchestrator |
| 9 | Release | Definition of Done closed | Tag / artifact / deployment | `dsb dod` → exit 0, then `dsb receipt verify` → exit 0 | Human — release gate, HIGH tier |

Notes that matter when reading exit codes:

1. `doctor` always exits `0` (M). It is a report, not a gate. A red line in `checks` or a
   non-empty `failing` array is the signal.
2. `arch-check --record` always exits `0` (M) because recording a measurement is not a
   verdict. The verdict comes from `arch-trend --gate`.
3. `gate` exits `2` for `FAIL`, `BLOCKED` and `BLOCKED_BY_ATTRIBUTES` alike (M). All three
   stop the phase; only the reason differs.
4. Exit `3` (degraded) is never a pass. It means the engine refused to guess — no catalog,
   no git tree, no requirement documents. Report it as unverified and name what is missing.

## 2. The four sign-off gates

| Gate | Closes | Machine precondition | Human sign-off | Re-approval trigger |
|---|---|---|---|---|
| Spec gate | Phase 2 | `dsb spec-lint` exit 0 (M) | Product owner approves this version of the spec (P) | Any edit to `PRODUCT-SPEC.md`; the changelog entry is written in the same turn (P) |
| Design gate | Phase 3 | `catalog-lint`, `arch-check`, `adr-check`, `agents-lint` all exit 0 (M) | Architect approves this version of the module graph (P) | Any change to `modules`, `layers`, `forbiddenDependencies`, `riskTier` or `attributes`, or a new ADR |
| Phase gate | Phases 6–7, per plan task | `dsb gate` `PASS` exit 0, then `dsb receipt verify` exit 0 (M) | Reviewer verdict `ACCEPT` recorded by `receipt write` (M for the binding, P for the judgement) | One byte of the tracked diff — the receipt binds `diffHash` and stales to exit `4` (M) |
| Release gate | Phase 9 | `dsb dod` exit 0, `dsb receipt verify` exit 0, `dsb ledger` exit 0 (M) | Explicit human authorization, HIGH tier (P) | Any commit after the approved point |

**A sign-off approves that version, not the idea.** For the phase gate this is machine
truth: the receipt stores the `diffHash` it judged, and `receipt verify` exits `4` the
moment the working tree differs. For the spec and design gates no hash binds the approval,
so the rule is prompt-only and is made auditable by recording the approval in
`progress.md` under Decisions with the commit it applied to. If the content changed,
re-approve — re-reading an approval that was granted for different content is the most
common way a governed process quietly stops governing.

## 3. The evidence five-step

Mandatory before any factual claim about this repository. See [../AGENTS.md](../AGENTS.md) section 1.

1. Name the exact command that would prove the claim. If no such command exists, the claim
   is an opinion — say so.
2. Run it fresh in this session. A result produced before the current edits is stale.
3. Read the full output **and** the exit code. Neither alone is sufficient.
4. Confirm the output supports *this* claim: exit `0` from a run that executed zero checks
   proves nothing, and a suite that never touched the changed module proves nothing about it.
5. Only then state the claim, quoting the command and its exit code.

Banned: "should work", "probably fine", "looks correct". Permitted substitute:
"not verified: <what is missing>".

## 4. Approval tiers

| Tier | Definition | Action |
|---|---|---|
| LOW | Reversible, local, inside the declared Scope: read, search, edit files named in the envelope, run read-only `dsb` commands | Proceed, no announcement |
| MEDIUM | Reversible but beyond the immediate step: a new file inside Scope, a refactor inside one module, a long verification run, writing a receipt | Announce in one line, continue |
| HIGH | `git push`, tag, release, deploy, destructive commands, secrets or credentials, schema or data migration, adding or upgrading a dependency, license change, waiving or disabling a check, editing `.dsh/base/lib/*` or the risk/attribute fields of `catalog.json` | Stop and obtain explicit human authorization first |

Ambiguous means take the higher tier (P). Delegated subagents run with approval policy
pinned to `never`: a subagent that meets a HIGH-tier need returns `BLOCKED` upward and
does not attempt the action.

## 5. Roles

Roles are skills. There are no markdown subagent definitions in dsh; a role is adopted by
loading its skill, and a delegate is given the same skill name plus a task envelope.

| Role | Skill | May | May not |
|---|---|---|---|
| Orchestrator | `dsb-operating-loop`, `delegation-protocol`, `context-economy`, `large-repo-navigation` | Choose the phase, write the envelope, dispatch delegates, accept or reject their results, run any read-only command | Claim a result it did not verify; delegate the acceptance decision; take a HIGH-tier action without authorization |
| Requirements analyst | `requirements-elicitation` | Write `PRODUCT-SPEC.md` and its changelog, allocate `REQ-`/`NFR-` ids | Reuse or renumber an id; leave a placeholder (`spec-lint` `PLACEHOLDER`, exit 1); write code |
| Architect | `architecture-design` | Write `ARCHITECTURE.md`, declare modules, layers, forbidden edges, owners | Change `riskTier` or `attributes` without HIGH approval; declare a module without `paths` and a verification route |
| Architecture guard | `architecture-guard` | Run `arch-check`, `arch-trend`, `adr-check`, `attributes`; record trend baselines | Launder debt — `arch-check --record` cannot lower the best-ever sample, so a worse measurement never relaxes the ratchet (M) |
| Planner | `work-planning` | Split work into tasks a zero-context delegate can run; set verification per task | Emit a task with a placeholder or without a verification command; widen the budget to fit a task |
| Implementer | `scoped-implementation` | Change files inside Scope, run the named verification, return the six-field result envelope | Touch files outside Scope; refactor opportunistically; add a dependency; report `DONE` without a command and exit code |
| Verifier | `verification-gate` | Run `gate`, interpret the four states, request a waiver for a non-protected check | Re-run with narrower arguments for a greener answer; waive `security`/`safety`/`privacy` (M — impossible to express); treat exit 3 as pass |
| Reviewer | `adversarial-review`, `verification-gate` | Return `ACCEPT` / `FIX_REQUIRED` / `NEEDS_MORE_EVIDENCE`, write the receipt, audit deletions | Review its own change; accept a claim with no evidence pointer; accept a stale receipt (exit 4) |
| Recorder | `progress-ledger` | Append Done / Decisions / Notes entries | Write a Done entry without an evidence pointer; record a hedged claim outside Notes `Needs-Confirmation` |
| Release manager | `release-readiness` | Assemble release evidence, run `dod` and `receipt verify` | Tag, push or deploy without explicit human authorization |
| Attribute specialist | `threat-modeling`, `safety-analysis`, `privacy-by-design`, `resilience-engineering`, `reliability-slo`, `test-strategy` | Produce the analysis and the claiming check for one attribute at a blocking tier | Declare an attribute covered without a check that claims it and passes ([QUALITY-ATTRIBUTES.md](QUALITY-ATTRIBUTES.md)) |
| Debugger | `root-cause-debugging` | Investigate a failure to its cause before any fix is proposed | Propose a retry, timeout increase or restart as a fix before the cause is named |
| Incident responder | `incident-response` | Stabilise, diagnose, recover, write the postmortem | Skip the postmortem; leave a mitigation undocumented |
| Steward | `feedback-and-evolution`, `skill-authoring` | Graduate a recurring lesson into a check or a skill; retire a control `gate-audit` shows has never intervened | Add a control without naming the incident it would have caught |

**Why the orchestrator delegates evidence-gathering and keeps judgement.** Evidence
survives transfer: a command, its exit code and an evidence path can be re-run and
re-checked by the receiver, and the engine binds them to a `diffHash` so a stale claim is
detectable. Judgement does not survive transfer: a delegate's context is a strict subset
of the orchestrator's by construction, so its risk assessment is systematically
under-informed, and no command can re-derive "this trade-off is acceptable" from a summary.
So: delegate audits, inventories, mechanical migrations and scoped implementations;
retain acceptance, risk classification, architecture decisions and every HIGH-tier call.

## 6. Stop conditions

Halt and ask a human when any of these holds:

1. A `dsb` command exits `2`, `3` or `4` and the fix is outside the declared Scope.
2. The approval tier is HIGH, or is ambiguous between MEDIUM and HIGH.
3. The task envelope is missing a field, or Scope does not name concrete paths — return
   `NEEDS_CONTEXT`, do not guess.
4. The gate can only be made green by widening a budget, editing a check definition,
   narrowing the run, or waiving a protected attribute.
5. The spec and the code disagree: ask which is wrong; change neither silently.
6. Two consecutive verification rounds fail for the same reason. Report the blocker
   instead of attempting a third variation.
7. Two independent delegates return contradictory evidence for the same claim.
8. `risk` reports `LEDGER_BROKEN` or `EXPIRED_WAIVER` (exit 1): prior evidence is
   untrusted; do not build on it.
9. An irreversible or contested decision is required — schema change, dependency
   addition, public contract change, data deletion.
10. A delegate returns `BLOCKED` after all four escalation steps (supply context → raise
    the model → split the task → report the limitation).

## 7. Turn output contract (P)

Every turn that advances the loop ends with:

```
Phase: <one of the nine>
Gate: <command> -> exit <code> -> <PASS|FAIL|BLOCKED|SKIPPED|n/a>
Artifact: <path(s) written or updated>
Tier: <LOW|MEDIUM|HIGH> (<why, if MEDIUM or HIGH>)
Next: <the single next action, or the question that blocks it>
```

From phase 5 onward, add the six-field result envelope defined in
[PROTOCOLS.md](PROTOCOLS.md): Status · Changed · Verified · Not verified · Needs review by ·
Evidence.

See also: [QUALITY-ATTRIBUTES.md](QUALITY-ATTRIBUTES.md) for why a green gate can still
block, [ADOPTION.md](ADOPTION.md) for installing the loop in an existing repository, and
[CAPABILITY-MATRIX.md](CAPABILITY-MATRIX.md) for what this model deliberately does not do.
