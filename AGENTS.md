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

## 5a. Fast mode — shipping under pressure without lying

Time pressure is real, and a gate that ignores it gets bypassed with `--no-verify`,
which teaches the team that the gate is optional. So the pressure is served, under
four conditions that stop it becoming permanent.

1. **It expires by itself.** `dsb fast on --minutes 90 --reason "<why>"`. A reason is required and a window with no end is not a window. Maximum 8 hours.
2. **It cannot touch the protected floor.** Every check claiming `security`, `safety` or `privacy` runs regardless. Those are not slow; they are why the software is allowed to exist.
3. **It skips only what was marked `allowFastSkip` in advance**, while there was time to think about which evidence is cheap to defer. Deciding that during the emergency is how everything becomes skippable.
4. **It is a loan, not a discount.** Each skipped check is recorded `SKIPPED` with reason `fast-mode`, the gate record is stamped `fastMode`, and **that record cannot close a task or a release**. `risk` reports `FAST_MODE_DEBT` until a full gate repays it. Run `dsb fast off` then `dsb gate`.

Fast mode does not make the code correct faster. It defers evidence, dates the
debt, and refuses to let you forget it.

## 5b. Review law

An agentic review loop is the strongest measured lever in this field: it moved one
model from 27.5 % to 56.9 % on SWE-bench Verified at 6.5x the token efficiency of
resampling, and three agents in structured disagreement beat five in consensus.
Consensus is the failure mode, so review here is an engine gate, not a habit.

1. **Structured disagreement, not consensus.** Every required lens reports on its own, from its own prompt, through `node .dsh/base/dsb.mjs review lens <name>` reading `{"findings":[...]}` on stdin (exit 1 when the report is refused). Default lenses: security, privacy, resilience, reliability, correctness; the set is `catalog.review.lenses`. Lenses that agree cheaply have not reviewed anything.
2. **A finding needs a `file:line` or a reproduction.** `review lens` rejects the whole report otherwise (exit 1): an impression nobody can locate cannot be acted on. Blue is held to the same bar — `review blue` rejects a claim carrying no evidence (exit 1).
3. **The verdict is computed, never asserted.** `review verdict` refuses while blue is silent or a required lens never reported (exit 1). One `error` finding gives `FIX_REQUIRED`; one lens reporting itself `unable` gives `NEEDS_MORE_EVIDENCE`; otherwise `ACCEPT` (exit 0, any other verdict exit 2) and only then is a `receipt` written, recording which lenses covered the diff. A receipt with no lens coverage cannot close a task unless `catalog.review.requireStructured` is `false`.
4. **One lens finding an error is not outvoted.** Rule 5.2 applies here unchanged: counter-evidence outranks confirming evidence, so four clean lenses never cancel one located error.
5. **A review binds the diff it judged.** `review start` opens the session against the current `diffHash`, and the session goes stale the instant the tree changes (exit 4). Re-open and re-run the lenses; never carry a verdict across an edit. Assemble the evidence with `node .dsh/base/dsb.mjs review-pack` first — a self-selected diff view is where files go unread.
6. **The reviewer is never the author.** Delegate each lens to a separate agent that did not write the change; when no independent reviewer exists, say so in `review verdict --notes`. Prompt-only: the engine counts lenses, it cannot tell who wrote the code.

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

1. `progress.md` is project memory and is **committed**. It is project state, so another machine resumes from it; the tool under `.dsh/` may be private, the memory never is.
2. **Three-file synchronisation.** Governed code and the ledger move in the same commit, and a specification edit carries its changelog entry in the same commit. Enforced by `node .dsh/base/dsb.mjs sync-check --staged` in the pre-commit hook: exit 1 on `MEMORY_BEHIND_CODE` or `SPEC_WITHOUT_CHANGELOG`.
3. A `Done` entry without an evidence pointer is not written. A `Decisions` entry without the rejected alternative is a status update and belongs under `Done`. Hedged language is demoted to `Notes` tagged `Needs-Confirmation`.
4. **Recovery is one bounded command**: `node .dsh/base/dsb.mjs recap`. It derives the live state — position, pinned, in progress, P0/P1, recent decisions and Done, risks, decay signals — inside a character budget, so resuming costs the same whether the project is a week or two years old. A compaction summary is a claim, not a fact; recap reads artifacts.
5. **Memory is archived, never deleted.** When the ledger exceeds its budget, `node .dsh/base/dsb.mjs archive --apply` moves the oldest `Done` and `Notes` entries into `progress.archive.md` and leaves a pointer. An archived entry is never rewritten; a correction is a new entry in the live ledger.
6. **Re-read the invariants after any compaction and at every phase boundary.** Compaction does not correct instruction drift — measured across 23 models, the summary carries the drift forward instead of repairing it — so this constitution decays inside a long session and nothing reports it. `node .dsh/base/dsb.mjs invariants` re-derives the non-negotiable set plus the live state (open task, open fast-mode window, last gate, broken ledger) inside ~1200 characters: `recap` says where the work is, `invariants` says what may not be traded away.

## 8a. Fleet law — when the system is many repositories

1. One repository per service, each small enough that one agent holds its whole model, is the right answer to context. It moves complexity from file dependencies to **contracts between repositories**, and nothing inside a repository can see that surface.
2. `fleet.json` at the group root declares every repository and every contract it `provides` and `consumes`. Enforced by `fleet lint`.
3. **Never change a published contract version in place.** Publish the new version beside the old, declare a `sunset` date, migrate every consumer, then retire. A deprecation with no sunset date is an error, not a label.
4. Before a breaking contract change, run `fleet impact <contract>`. Its `coordinationCost` is the number of repositories that must be released together; that number is the decision, not an afterthought.
5. A contract cycle between repositories means they cannot be released independently. That is the distributed-monolith signature: report it, do not normalise it.
6. **Boundaries are judged by co-change, not by line count.** `cochange` measures which modules actually move together. High coupling with no declared edge means the boundary is wrong; accepting it requires a written reason in `catalog.cochange.accepted`, exactly like opting an attribute out of governance.

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
| Is a fast-mode window open, and what would it defer? | `node .dsh/base/dsb.mjs fast status` |
| Has architecture drifted? | `node .dsh/base/dsb.mjs arch-check` / `arch-trend --gate` |
| Are decisions still enforced? | `node .dsh/base/dsb.mjs adr-check` |
| Are requirements decidable and traced? | `node .dsh/base/dsb.mjs spec-lint` / `trace` |
| Which requirements does this change touch? | `node .dsh/base/dsb.mjs spec` (`--all`, `--paths a,b`, `--budget N`) |
| Anti-pattern scan | `node .dsh/base/dsb.mjs fitness --all` |
| Pack context for a delegate | `node .dsh/base/dsb.mjs context-pack --focus "src/x/**"` |
| Evidence pack for review | `node .dsh/base/dsb.mjs review-pack` |
| Review as structured disagreement | `node .dsh/base/dsb.mjs review start` → `review blue` → `review lens <name>` → `review verdict` |
| Where are we, in one budget | `node .dsh/base/dsb.mjs recap` |
| What may never be forgotten, plus live state | `node .dsh/base/dsb.mjs invariants` |
| Is memory in step with the code? | `node .dsh/base/dsb.mjs sync-check` |
| Are the boundaries drawn where the code changes? | `node .dsh/base/dsb.mjs cochange` |
| What does a contract change cost? | `node .dsh/base/dsb.mjs fleet impact <contract>` |
| Is the whole project group healthy? | `node .dsh/base/dsb.mjs fleet status --deep` |
| How many rules name a real enforcement point? | `node .dsh/base/dsb.mjs rules-audit` |
| Everything static, one command | `node .dsh/base/dsb.mjs dod` |

## 12. Skills

`dsb-operating-loop` is the entry point for any non-trivial change. Load it first.
The full catalog is in the session skill list; every skill is also invocable by the human as `/<skill-name>`.
Run `node .dsh/base/dsb.mjs skills-lint` after editing any skill: a malformed skill is silently dropped by the harness.
