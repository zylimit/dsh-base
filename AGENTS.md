# deepseek-base — project constitution

This file is injected into every request. It holds only durable invariants.
Procedure lives in skills (`.dsh/skills/`); reference material lives in `docs/`.
When a rule here and a skill disagree, this file wins.

## 0. What this repository is

A development scaffold for the DeepSeek Harness. It ships a project constitution,
a skill library, a zero-dependency governance engine (`dsb`), document templates,
git hooks and CI. It governs itself with its own engine: every rule below is
either enforced by a named command, or explicitly marked prompt-only.

Engine entry point: `node .dsh/base/dsb.mjs <subcommand>`
Exit codes: `0` clean · `1` violation · `2` blocking gate · `3` degraded (never a false green) · `4` stale evidence.

## 1. Evidence law

A claim about the state of this repository is worth nothing without a fresh command output.

Before stating that anything works, passes, is fixed, or is done:
1. Name the command that would prove it.
2. Run it fresh. Never reuse an earlier run across an edit.
3. Read the full output **and** the exit code.
4. Confirm the output actually supports the specific claim.
5. Only then say it.

Banned phrasings: "should work", "probably fine", "looks correct", "I believe it passes".
Say instead: what ran, what it returned, and what remains unverified.

**A missing tool is BLOCKED, never PASS. An empty verification plan is BLOCKED.
Nothing ran, so nothing is proven.** Degraded (exit 3) is not success.

## 2. Approval tiers

| Tier | Examples | Behaviour |
|---|---|---|
| LOW | read, search, local build, local test, edit inside the declared scope | proceed, no announcement |
| MEDIUM | new file, refactor inside one module, changing a check's arguments, installing nothing | announce in one line, continue |
| HIGH | `git push`, tag, release, deploy, any destructive command, touching secrets or credentials, schema or data migration, adding or upgrading a dependency, changing a license, disabling or waiving a check, editing `.dsh/base/catalog.json` risk or attribute fields | **stop and obtain explicit human authorization first** |

When the tier is ambiguous, take the higher tier. Prompt-only.

## 3. Scope law — preventing runaway change

1. Work from a task envelope: **Goal · Scope · Out of scope · Existing pattern · Verification · Escalation**. A task without all six is not ready; ask, do not guess.
2. Change only files inside Scope. A necessary change outside Scope is a new task, not an extension of this one.
3. No drive-by refactors, no opportunistic renames, no reformatting files you did not otherwise change.
4. Reuse the pattern named in the envelope before inventing a new one.
5. Run `node .dsh/base/dsb.mjs budget`. Over budget means split the change or escalate — never widen the budget to make a boundary failure disappear.
6. Missing information is not permission.

## 4. Architecture law — preventing decay

1. `.dsh/base/catalog.json` is the authoritative architecture. A design that cannot be expressed as modules, layers and forbidden edges is not finished.
2. When a document and the catalog disagree, the measured graph from `arch-check` wins and the document is corrected. Never the reverse.
3. Every module at risk tier `high` or `critical` carries an `AGENTS.md` with the sections **Purpose · Boundaries · Invariants · Verification**. The harness loads it automatically when an agent touches that directory: it is the cheapest boundary contract available. Enforced by `agents-lint`.
4. Every architectural decision is an ADR under `docs/adr/` with a mandatory `Enforced-by:` line naming a real check id, fitness rule id, engine capability, or an explicit `manual:<who>`. A phantom reference fails `adr-check`: it reads as enforced while enforcing nothing.
5. New architectural debt is not permitted. Existing debt is. `arch-check --record` sets the baseline; `arch-trend --gate` fails only on a regression past the best ever recorded.

## 5. Quality-attribute law

Eight attributes: `security` `safety` `privacy` `resilience` `reliability` `availability` `performance` `maintainability`.
Six tiers: `critical` `high` `medium` `low` `minimal` `none`.

1. `critical` and `high` **block**: the gate does not pass unless a check that claims the attribute actually passed for the affected module.
2. Counter-evidence outranks confirming evidence. One claiming check that FAILs or is BLOCKED reopens the gap even if others passed.
3. `SKIPPED` covers nothing. Declared but unwired is a visible gap, not a pass.
4. `minimal` and `none` require a written `attributeReasons` entry. Opting out of governance is a recorded decision, never a free default.
5. **`security`, `safety` and `privacy` are protected**: never waivable, never fast-skippable, never downgraded by a waiver. There is no expressible waiver for them.

## 6. Verification law

1. Verification is impact-scoped, never "run everything" and never "run what feels related". `impact` decides.
2. An unmapped path, a global path, a truncated file list or a non-git tree forces a conservative full fan-out marked `degraded`. Over-testing is cheap; a missed regression is not.
3. Review is bound to a diff. `receipt write` records the verdict against `diffHash`; one byte of change stales it and re-review is required (exit 4).
4. The ledger is hash-chained. A broken chain fails closed: every prior verification is treated as unproven until re-run.
5. Never re-run a check with different arguments to obtain a greener answer. Never delete evidence. Never edit a receipt or waiver by hand.

## 7. Security, privacy and safety floor

1. No credential, key, token or personal datum is ever written to source, logs, test fixtures, commit messages, or a context pack. Enforced by `fitness` (`no-secret-literal`, `no-pii-in-logs`) and the `context-pack` deny list.
2. Never read a secret file to "check" it, and never pipe one into another command. Read the `.example` instead.
3. Deny by default at every boundary. Every outbound call has a timeout. Every retry has a bound, a backoff and jitter. Every queue and cache has a limit.
4. Failures fail safe, not open. A component that cannot establish its invariants refuses to serve, loudly.
5. Errors are handled or propagated with context. Never swallowed (`no-silent-failure`).

## 8. Memory law

1. `progress.md` is project memory. A `Done` entry without an evidence pointer is not written. A `Decisions` entry without the rejected alternative is a status update and belongs under `Done`.
2. Hedged language is demoted to `Notes` tagged `Needs-Confirmation`.
3. Recovery after compaction or a new session reads `progress.md` **and** `docs/requirements/PRODUCT-SPEC.md` **and** its changelog **and** `dsb task status`. A compaction summary is a claim, not a fact; re-establish facts from artifacts.
4. Any edit to the product spec updates `docs/requirements/PRODUCT-SPEC-CHANGELOG.md` in the same turn.

## 9. Delegation law

1. Delegate evidence-gathering. Retain judgement. A delegate's claim is accepted only with an evidence pointer.
2. Every dispatch carries the six-field envelope plus a `context-pack` path. Every result carries the six-field result envelope with `Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`.
3. Start independent delegations in one message. Never sleep-poll a background job.
4. Serialize writers: at most one delegate writes to a given module at a time.
5. A `BLOCKED` result escalates in this order: supply the missing context → raise the model → split the task → report the limitation. Never retry unchanged.

## 10. Agent efficiency law

1. Code Mode: batch independent reads, searches and commands into one `run_code` program. One tool call per file is the main avoidable cost in this harness.
2. `grep`/`glob` before `read`. Do not read a large file in full when a targeted search answers the question. Never read generated output, lockfiles or vendored trees.
3. Write intermediate findings to a file and pass the path; do not paste large content into messages.
4. Keep this file small. Detail belongs in a skill, which is loaded only when it is needed.

## 11. Command reference

| Intent | Command |
|---|---|
| Is the toolchain healthy? | `node .dsh/base/dsb.mjs doctor` |
| Does the engine still work? | `node .dsh/base/dsb.mjs selftest` |
| Is the architecture map valid? | `node .dsh/base/dsb.mjs catalog-lint` |
| What does my change affect? | `node .dsh/base/dsb.mjs impact` |
| Prove the change | `node .dsh/base/dsb.mjs gate` |
| Has architecture drifted? | `node .dsh/base/dsb.mjs arch-check` / `arch-trend --gate` |
| Are decisions still enforced? | `node .dsh/base/dsb.mjs adr-check` |
| Are requirements decidable and traced? | `node .dsh/base/dsb.mjs spec-lint` / `trace` |
| Anti-pattern scan | `node .dsh/base/dsb.mjs fitness --all` |
| Pack context for a delegate | `node .dsh/base/dsb.mjs context-pack --focus "src/x/**"` |
| Evidence pack for review | `node .dsh/base/dsb.mjs review-pack` |
| Everything static, one command | `node .dsh/base/dsb.mjs dod` |

## 12. Skills

`dsb-operating-loop` is the entry point for any non-trivial change. Load it first.
The full catalog is in the session skill list; every skill is also invocable by the human as `/<skill-name>`.
Run `node .dsh/base/dsb.mjs skills-lint` after editing any skill: a malformed skill is silently dropped by the harness.
