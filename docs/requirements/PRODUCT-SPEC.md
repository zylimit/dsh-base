# deepseek-base — Product Specification

Version: 1.0
Status: Accepted
Owner: maintainers

## 1. Purpose

deepseek-base is a development scaffold for the DeepSeek Harness. It supplies a
project constitution, a skill library, a zero-dependency governance engine, document
templates, git hooks and CI so that a team using the harness produces evidence
instead of assertions, and so that architecture and requirement quality are checked
by commands rather than by memory.

## 2. Scope and non-goals

In scope: agent operating discipline, requirement quality, architecture governance,
quality-attribute enforcement, verification evidence, delegation protocol, and
operation at repositories above 1,000,000 lines.

Non-goals: replacing a build system, a test runner, a CI provider, a package
manager, or a static-analysis engine. deepseek-base wires those in; it does not
reimplement them. It also does not provide legal advice on privacy regulation.

## 3. Target users

| User | Job |
|---|---|
| An engineer adopting the harness on an existing codebase | keep an agent inside declared boundaries and prove the result |
| A tech lead | make architecture decisions enforceable instead of aspirational |
| An agent (the model itself) | know the loop, the gate, the evidence rule, and where to look |
| A reviewer | receive an evidence pack bound to the exact diff under review |

## 4. Functional requirements

### REQ-GOV-001 — Governance is opt-in and silent when absent

WHEN no `.dsh/base/catalog.json` exists in the project root, every targeted
subcommand SHALL exit 3 with a stated reason, and the git hooks SHALL exit 0
without blocking the developer.

Acceptance: running `catalog-lint` in a repository without a catalog exits 3 and
its JSON carries `degraded: true` and a non-empty `reason`.

### REQ-GOV-002 — Degraded is never reported as success

IF a capability cannot establish its facts, THEN the engine SHALL exit 3 and MUST
NOT exit 0.

Acceptance: with no git repository present, `impact` exits 3 and never 0.

### REQ-GOV-003 — Four check states with BLOCKED as a first-class outcome

WHEN a configured check has no command, or its executable is absent, THEN the
result SHALL be `BLOCKED` and MUST NOT be `PASS`.

Acceptance: a check whose command names a non-existent binary yields status
`BLOCKED` with reason prefix `command-missing:`.

### REQ-GOV-004 — An empty verification plan blocks

WHEN the affected module set resolves to zero checks, THEN the gate SHALL return
`BLOCKED`, because nothing ran and therefore nothing is proven.

Acceptance: aggregating an empty plan returns gate `BLOCKED`.

### REQ-ARC-001 — Every tracked path is classified

WHEN `catalog-lint` runs in a git repository, THEN every tracked path SHALL
classify as a module, a global path, or an ignored path, and any unmapped path
SHALL be reported as an error.

Acceptance: adding an unclassified tracked file makes `catalog-lint` exit 1 with
finding code `UNMAPPED`.

### REQ-ARC-002 — Catch-all module globs are rejected

IF a module declares a catch-all glob, THEN `catalog-lint` SHALL reject it,
because such a glob hides unmapped files behind a passing gate.

Acceptance: a module with path `**` produces finding code `CATCH_ALL`.

### REQ-ARC-003 — Impact is a reverse-dependency closure with conservative expansion

WHEN a changed path is unmapped or global, or the tracked list was truncated, THEN
the affected set SHALL expand to every module and SHALL be marked `degraded`.

Acceptance: an unmapped changed path yields `degraded: true` and an affected set
equal to every declared module id.

### REQ-ARC-004 — Real import edges are compared with the declared graph

WHEN `arch-check` runs, THEN it SHALL report forbidden edges, layer-direction
violations, undeclared edges and unused declarations extracted from source, and
SHALL report the count of specifiers it could not resolve.

Acceptance: a forbidden edge present in source appears in the `forbidden` list and
the command exits 1.

### REQ-ARC-005 — Architectural debt ratchets in one direction

WHEN `arch-trend --gate` runs after at least one recorded snapshot, THEN it SHALL
fail only if a drift metric exceeds the best value ever recorded.

Acceptance: with no recorded history the gate passes and reports `baseline: true`.

### REQ-ARC-006 — Every live decision names a real enforcement point

WHEN an ADR is not retired, THEN `adr-check` SHALL require an `Enforced-by:`
line resolving to a catalog check id, a fitness rule id, an engine capability, or
an explicit `manual:` marker, and MUST fail on a reference that resolves to
nothing.

Acceptance: an ADR whose `Enforced-by` names an unknown token produces finding
code `PHANTOM_ENFORCEMENT`.

### REQ-SPC-001 — Requirements must be decidable

WHEN `spec-lint` reads a requirement, THEN it SHALL reject a missing normative
keyword, a missing acceptance criterion, an ambiguous adjective, a placeholder
token, a duplicate identifier, and a quality requirement with no measurable target.

Acceptance: a requirement without acceptance criteria produces finding code
`NO_ACCEPTANCE` and `spec-lint` exits 1.

### REQ-SPC-002 — Every requirement is traced to a test

WHEN `trace` runs, THEN every declared identifier SHALL be referenced by at least
one file matching the configured test globs, and coverage below the declared
minimum SHALL exit 1.

Acceptance: `trace` reports `coverage` as a ratio and lists every unverified
identifier by name.

### REQ-DEL-001 — Delegation carries a complete envelope

WHEN a task is started through `task start`, THEN the envelope SHALL contain
identifier, goal, scope, out-of-scope, verification and escalation, and an
incomplete envelope SHALL be refused.

Acceptance: an envelope missing `escalation` is rejected and no task file is
written.

### REQ-DEL-002 — Context handed to a delegate excludes secrets

WHEN `context-pack` assembles a bundle, THEN it SHALL exclude every path on the
deny list, SHALL report what it omitted and why, and SHALL keep the total within
the declared character budget.

Acceptance: a pack request that includes `.env` records that path under
`omitted` with reason `deny-list` and never embeds its contents.

### REQ-SCL-001 — Verification is scoped to impact, not to the repository

WHEN a change touches one module in a repository of many, THEN the verification
plan SHALL contain only the checks bound to the affected modules.

Acceptance: a change confined to one leaf module produces a plan whose module list
is that module alone.

### REQ-OPS-001 — Evidence binds to the exact diff it judged

WHEN any tracked byte changes after a review receipt is written, THEN
`receipt verify` SHALL report the receipt as stale and exit 4.

Acceptance: writing a receipt and then modifying a tracked file makes
`receipt verify` exit 4.

### REQ-OPS-002 — The verification ledger is tamper-evident

WHEN a ledger entry is altered or removed, THEN `ledger` SHALL report a chain
break and every prior verification SHALL be treated as unproven.

Acceptance: editing one recorded field makes the chain verification report at
least one break and exit 1.

## 5. Non-functional requirements

The five key attributes are each addressed below: resilience (NFR-RES-001),
security (NFR-SEC-001, NFR-SEC-002), safety (NFR-SAFE-001), privacy
(NFR-PRIV-001) and reliability (NFR-REL-001). Availability, performance and
maintainability follow.

### NFR-MAINT-001 — Zero runtime dependencies

The engine MUST run with the Node standard library alone on Node 20 or later, with
0 installed packages required.

Acceptance: `node .dsh/base/dsb.mjs selftest` exits 0 in a checkout with no
`node_modules` directory present.

### NFR-PERF-001 — Path classification at scale

Classifying 30000 paths across 150 modules MUST complete within 3000 ms on a
developer machine.

Acceptance: the engine self-test asserts this bound and fails when it is exceeded.

### NFR-PERF-002 — Bounded scanning

A single anti-pattern scan MUST bound itself to 5000 files, 1 MB per file and 500
findings, and MUST report truncation rather than under-reporting silently.

Acceptance: a scan that reaches a bound sets `truncated: true` in its result.

### NFR-SEC-001 — No secret material in tracked content

The repository MUST contain 0 committed credential files and 0 credential-shaped
literals outside explicitly marked example files.

Acceptance: `node scripts/scan-secrets.mjs` exits 0 over the whole tracked set.

### NFR-SEC-002 — Protected attributes cannot be bypassed

Security, safety and privacy MUST have 0 available bypasses: no waiver, no
fast-skip, and no downgrade path.

Acceptance: a waiver naming any protected concern fails validation, and a check
claiming a protected attribute is rejected when it sets a fast-skip flag.

### NFR-PRIV-001 — No personal data in engine output

Engine output MUST contain 0 raw personal identifiers; findings carry a file path,
a line number and a rule identifier only.

Acceptance: the anti-pattern scan reports a location and a rule id, and its excerpt
is capped at 200 characters.

### NFR-SAFE-001 — Irreversible actions require explicit authorization

The scaffold MUST perform 0 irreversible actions without human authorization:
publishing, deploying, force-pushing and deleting are HIGH-tier acts.

Acceptance: no engine subcommand writes outside its own runtime directories, and
the pre-push hook refuses a push when the gate has not passed.

### NFR-REL-001 — Reliability: the engine proves itself before judging

The self-test MUST cover the classification, impact, aggregation, attribute,
waiver, ledger and deny-list paths, with 0 failing assertions required to pass.

Acceptance: `selftest` exits 0 and reports `failed: 0`.

### NFR-RES-001 — Resilience: degradation is announced, never silent

Under a missing tool, a missing catalog, a non-git tree or a truncated file list,
the engine MUST continue to produce a result within 1 s and MUST mark it degraded.

Acceptance: each degraded path returns exit 3 or sets `degraded: true`, and no
degraded path returns exit 0.

### NFR-AVAIL-001 — Hooks never trap a developer

A git hook MUST add at most 60 s to a commit and MUST exit 0 when the toolchain is
absent, so that an incomplete environment cannot block all local work.

Acceptance: with node absent from PATH the pre-commit hook exits 0 and prints that
checks were skipped and that skipping is not a pass.

## 6. Success criteria

1. `node .dsh/base/dsb.mjs dod` exits 0 on this repository.
2. `node .dsh/base/dsb.mjs trace` reports coverage 100 % with 0 dangling
   references from code or tests.
3. A new adopter can enable governance on a brownfield repository without changing
   any product source file.

## 7. Open questions

None recorded for version 1.0. New questions are added here with an owner and a
decision date, and are removed only by an entry in the changelog.
