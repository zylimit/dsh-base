# dsh-base documentation

Reference material for the dsh-base scaffold. Durable law lives in
[../AGENTS.md](../../AGENTS.md) (auto-injected into every request). Procedure lives in the
skills under `.dsh/skills/`. Enforcement lives in `node .dsh/base/dsb.mjs <subcommand>`.

Every rule in this set is marked either **machine-enforced** — with the exact command,
check id and exit code — or **prompt-only**. Nothing else is implied. Exit codes:
`0` clean · `1` rule violation · `2` blocking gate failure · `3` degraded (never a false
green) · `4` stale evidence.

## The document set

| Document | Question it answers | Who reads it, when |
|---|---|---|
| [../AGENTS.md](../../AGENTS.md) | What rules hold in this repository regardless of task? | Every agent on every request (auto-injected); every engineer on day one |
| [OPERATING-MODEL.md](OPERATING-MODEL.md) | How does work move from request to release, which gate closes each phase, and who signs off? | Orchestrator at the start of any non-trivial change; engineer before their first task |
| [QUALITY-ATTRIBUTES.md](QUALITY-ATTRIBUTES.md) | What do the eight attributes mean, what does a tier oblige, and why did a green run still block? | Architect when declaring attributes; anyone who reads `BLOCKED_BY_ATTRIBUTES` |
| [PROTOCOLS.md](PROTOCOLS.md) | What is the exact JSON the engine accepts and writes, and what does each exit code mean? | Anyone writing a task envelope, receipt or waiver; anyone wiring CI |
| [ADOPTION.md](ADOPTION.md) | How is this scaffold installed into a new, greenfield or 1M-line brownfield repository? | Whoever introduces dsh-base into a repository, once |
| [CAPABILITY-MATRIX.md](CAPABILITY-MATRIX.md) | Which donor-scaffold capability was absorbed, adapted or rejected, and why? | Anyone proposing a new mechanism, before proposing it |
| [../progress.md](../progress.md) | What was done, what was decided, what is open? | Every agent on cold start; every engineer resuming work. Written by phase 8; absent in a fresh clone |
| [requirements/PRODUCT-SPEC.md](requirements/PRODUCT-SPEC.md) + `PRODUCT-SPEC-CHANGELOG.md` | What must the system do, in decidable `REQ-`/`NFR-` form? | Specify and Verify phases. Created by the loop; linted by `spec-lint` |
| [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) | What is the intended structure, and which decisions bound it? | Design phase. The measured graph from `arch-check` wins over this document |
| [adr/](adr/) | Why was this decision taken, and what enforces it now? | Before changing anything an ADR constrains. Each live ADR needs an `Enforced-by:` line (`adr-check`) |
| [plan/DEV-PLAN.md](plan/DEV-PLAN.md) | What are the executable tasks, in order, with verification? | Plan and Implement phases. Created by the loop |
| [LARGE-REPO-GUIDE.md](LARGE-REPO-GUIDE.md) | How is a 1M-line repository navigated, scoped and verified without reading it? | Cold start in an unfamiliar or very large tree; when a search result is truncated |
| [nfr/](nfr/) — `SECURITY`, `SAFETY`, `PRIVACY`, `RESILIENCE`, `RELIABILITY` | What does this attribute demand of a design, and what evidence closes it? | Whoever declares or must satisfy that attribute at `high` or `critical` |

A new document is added to this table in the same change that creates it (prompt-only).

## Reading order for a new engineer

1. [../AGENTS.md](../../AGENTS.md) — the invariants. Nothing below overrides it.
2. [OPERATING-MODEL.md](OPERATING-MODEL.md) — the nine phases, the gates, the approval tiers, the stop conditions.
3. [PROTOCOLS.md](PROTOCOLS.md) — the envelopes, the receipt, the waiver, the ledger, the exit codes.
4. [QUALITY-ATTRIBUTES.md](QUALITY-ATTRIBUTES.md) — why declaring an attribute creates an obligation to wire a check.
5. [ADOPTION.md](ADOPTION.md) — only if you are installing the scaffold somewhere else.
6. [CAPABILITY-MATRIX.md](CAPABILITY-MATRIX.md) — before you propose adding a mechanism; the rejection column is the shortest path to "no, and here is why".
7. Run `node .dsh/base/dsb.mjs doctor`, then `node .dsh/base/dsb.mjs selftest`, and read the JSON on stdout.

## Reading order for an agent on cold start

1. [../AGENTS.md](../../AGENTS.md) — already injected; treat it as read and binding.
2. `node .dsh/base/dsb.mjs doctor` — establishes whether governance is configured at all. Exit is always `0`; read the `enabled` flag and the `failing` array, not the exit code.
3. [../progress.md](../progress.md) — project memory: Done entries carry evidence pointers, Decisions carry rejected alternatives.
4. `node .dsh/base/dsb.mjs task status` — the active task envelope and the current `diffHash`.
5. [requirements/PRODUCT-SPEC.md](requirements/PRODUCT-SPEC.md) and its changelog — the current contract. A compaction summary is a claim, not a fact.
6. The `dsb-operating-loop` skill — then enter at the earliest phase whose artifact is missing, stale or unproven.
7. Only then read code, `grep`/`glob` first, targeted `read` second.
