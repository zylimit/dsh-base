# progress.md — project memory

Contract: see the `progress-ledger` skill. In short — `Pinned` is immutable,
`Decisions` is append-only and every entry names the rejected alternative, every
`Done` entry carries an evidence pointer, and hedged language is demoted to
`Notes` tagged `Needs-Confirmation`.

## Pinned

- The engine is the authority. When a document and a command disagree, the command
  wins and the document is corrected.
- Exit 3 (degraded) is not a pass. A missing tool is BLOCKED, never PASS.
- `security`, `safety` and `privacy` have no waiver, no fast-skip, no downgrade.
- The DeepSeek Harness has no hook system, no project settings file, and no
  markdown-defined commands or subagents. Enforcement lives in git hooks, CI and the
  engine. Procedure lives in skills. Never claim otherwise.

## Decisions

- **2025-01-01 — Zero-dependency Node engine** (ADR-0001). Rejected: publishing the
  engine as an npm package, because adoption would then require a registry, version
  resolution and a supply-chain review — exactly the friction that defers governance.
- **2025-01-01 — Enforcement in git hooks and CI** (ADR-0002). Rejected: waiting for
  a harness hook API, because the scaffold has to work with the harness that exists.
- **2025-01-01 — The catalog is the architecture** (ADR-0003). Rejected: prose plus
  human review, because a new import line looks like an ordinary line.
- **2025-01-01 — Missing evidence blocks** (ADR-0004). Rejected: treating a missing
  tool as a skip, because that makes uninstalling a scanner the cheapest way to pass.
- **2025-01-01 — Protected attributes have no bypass** (ADR-0005). Rejected: signed
  time-boxed security waivers, because an expiry is only a control if something
  enforces it under exactly the pressure that causes it to be extended.
- **2025-01-01 — Module contracts are nested AGENTS.md** (ADR-0006). Rejected: a
  central module-capsule directory, because it is not auto-loaded and is therefore
  read only by someone who already knows to look.
- **2025-01-01 — Debt ratchets one way** (ADR-0007). Rejected: failing on every
  existing violation, because a gate that cannot be adopted protects nothing.
- **2025-01-01 — Roles and commands are skills** (ADR-0008). Rejected: a project-local
  agent-definition format, because nothing the harness ships would read it.
- **2025-01-01 — The architecture-drift ledger is committed.** Rejected: ignoring
  `.dsh/base/trend/`, because a per-machine baseline lets every developer measure
  against a different best value and the ratchet stops meaning anything.

## TODO

- #1 (P1) Wire a real SAST tool and a real secret scanner as checks claiming
  `security`, replacing the lexical `scan-secrets.mjs` as the sole evidence for
  high-risk modules. Candidates listed in `.dsh/base/adapters.json`.
- #2 (P1) Measure the performance budgets in `docs/LARGE-REPO-GUIDE.md` against a
  real repository above 1,000,000 lines and replace the labelled targets with
  measurements.
- #3 (P2) Add a behaviour regression for the skill catalog: a trigger phrase per
  skill and the observable behaviour expected, so a skill that never fires is
  detectable.
- #4 (P2) Extend `arch-check` specifier resolution for polyglot trees; today
  unresolved specifiers are counted and sampled rather than attributed.
- #5 (P2) Add a `dsb` subcommand that renders the traceability matrix as a
  reviewable markdown table instead of JSON only.

## In progress

Nothing. Version 1.0.0 is complete.

## Done

- **Governance engine, 27 subcommands.** Evidence: `node .dsh/base/dsb.mjs help`
  lists them; `node .dsh/base/dsb.mjs selftest` reports 58/58 assertions passing.
- **Self-governing catalog: 13 modules, 5 layers, forbidden edges.** Evidence:
  `catalog-lint` exits 0 with 0 unmapped paths; `arch-check` exits 0 with 0
  forbidden, 0 layer violations and 0 undeclared edges over 23 real import edges.
- **23 skills covering the full loop.** Evidence: `skills-lint` exits 0 and reports
  23 discovered skills with 0 errors.
- **27 requirements at 100 % test traceability.** Evidence: `spec-lint` exits 0
  with 27 requirements and 0 errors; `trace` exits 0 with coverage 1.
- **8 ADRs, each naming a resolvable enforcement point.** Evidence: `adr-check`
  exits 0 with 8 live ADRs and 0 phantom references.
- **Two engine defects found by the engine's own tests and fixed.** (1) Fitness
  patterns using an inline `(?m)` flag threw at compile time, so every scan silently
  degraded to exit 3; the compiler now translates leading inline flags and rejects an
  unsupported one loudly. (2) A receipt's own `contentHash` collided with the ledger
  envelope field of the same name, breaking the chain on the first receipt; the
  receipt hash now travels as `receiptHash`. Evidence: `selftest` 58/58 and
  `node --test "tests/*.test.mjs"` with the ledger and fitness cases passing.
- **Nested module contracts auto-load.** Evidence: editing files under
  `.dsh/base/lib` during this build caused the harness to inject
  `.dsh/base/lib/AGENTS.md` without any explicit read.

## Risks and assumptions

- **Assumption:** `.dsh/skills` and the `AGENTS.md` chain are the harness's only
  repository-level extension points. Verified against the installed package READMEs
  for `dsh-skill-filesystem` and `dsh-agent-instructions` at version 0.1.1-rc.2. A
  later harness release may add more; re-verify before claiming a limitation.
- **Risk:** `scan-secrets.mjs` is a lexical scanner. It proves no known credential
  shape is present in tracked text; it does not prove no secret exists. TODO #1.
- **Risk:** the performance numbers in the large-repo guide are targets on synthetic
  input, not measurements on a real 1,000,000-line tree. TODO #2.
- **Risk:** `--no-verify` bypasses the local hooks. CI runs the same gate and is the
  authority for a merge; a local bypass is a HIGH-tier act that must be justified.

## Notes

- `node --test tests/` does not work on this platform; the working invocation is
  `node --test "tests/*.test.mjs"`, which is what `package.json`, CI and the module
  contracts record.
- `arch-check` reports 3 unresolved specifiers, all from fixture strings inside
  `selftest.mjs`. They are counted and sampled rather than dropped, which is the
  intended honest behaviour.

## Context index

| Question | Where |
|---|---|
| What are the rules? | `AGENTS.md` |
| How does work flow? | `docs/OPERATING-MODEL.md` |
| What are the machine contracts? | `docs/PROTOCOLS.md` |
| How are the eight attributes governed? | `docs/QUALITY-ATTRIBUTES.md` |
| How does this scale? | `docs/LARGE-REPO-GUIDE.md` |
| What was taken from which donor scaffold? | `docs/CAPABILITY-MATRIX.md` |
| What are the requirements? | `docs/requirements/PRODUCT-SPEC.md` |
| What was decided and why? | `docs/adr/` |
| What does the engine do? | `.dsh/base/AGENTS.md`, `.dsh/base/lib/AGENTS.md` |
