# .dsh/base — the governance engine and its configuration

## Purpose

Everything that turns the rules in the root `AGENTS.md` into commands that exit
non-zero. `dsb.mjs` is the only entry point; `catalog.json` is the single switch
that enables governance for a repository.

| Path | Committed | Role |
|---|---|---|
| `dsb.mjs` | yes | CLI router, argument parsing, exit-code contract, the `dod` composite |
| `lib/` | yes | engine internals (see `lib/AGENTS.md`) |
| `catalog.json` | yes | module map, checks, attributes, budgets. Deleting it disables governance |
| `catalog.example.json` | yes | adoption starting point |
| `adapters.json` | yes | external tools that can be wired in as checks |
| `fitness-rules.json` | optional | project-specific anti-pattern rules merged with the built-ins |
| `githooks/` | yes | the enforcement seam: dsh has no hook system, git does |
| `skills/` | n/a | not here — skills live at `.dsh/skills/`, where the harness discovers them |
| `state/ evidence/ receipts/ waivers/` | **no** | runtime facts, git-ignored, never committed |
| `trend/` | yes | the architecture-debt ledger; shared on purpose so the ratchet is a team fact |

## Boundaries

1. `dsb.mjs` contains routing, flag parsing and output shaping only. Logic belongs
   in `lib/`. A new subcommand that implements its behaviour inline is a review
   rejection.
2. The engine never mutates source files. It reads the tree, runs configured
   commands, and writes only into its own runtime directories.
3. The engine never asks a question and never blocks on input. It reports and exits.
4. `catalog.json` is data, not code. It carries no executable expressions.
5. Editing the `riskTier` or `attributes` fields of `catalog.json` is a HIGH-tier
   act: it changes what the gate is allowed to let through.

## Invariants

1. Governance is opt-in and silent when off. No `catalog.json` means every targeted
   subcommand exits 3 with a reason, and the git hooks return 0 without noise.
2. Adding a subcommand requires: an entry in `COMMANDS`, an exit-code row in
   `docs/PROTOCOLS.md`, and at least one assertion in `lib/selftest.mjs`.
3. Every check id referenced anywhere in `catalog.json` must exist in
   `catalog.checks`. Enforced by `catalog-lint` (`DANGLING_CHECK`).
4. Every tracked path must classify as module, global or ignored. An unmapped path
   escapes every targeted gate, so `catalog-lint` treats it as an error.
5. Runtime directories are never committed and never enter a context pack.

## Verification

```sh
node .dsh/base/dsb.mjs doctor         # enablement and environment, always exit 0
node .dsh/base/dsb.mjs selftest       # engine regression assertions
node .dsh/base/dsb.mjs catalog-lint   # the catalog itself is valid and total
node .dsh/base/dsb.mjs dod            # every static governance check in one run
```

## Common tasks

| Intent | Command |
|---|---|
| Turn governance on in a new repo | copy `catalog.example.json` to `catalog.json`, then `catalog-lint` until it exits 0 |
| Adopt a repo that already has debt | `arch-check --record` once, then gate with `arch-trend --gate` |
| Install the enforcement seam | `git config core.hooksPath .dsh/base/githooks` |
| Wire an external scanner | pick it from `adapters.json`, add it to `catalog.checks`, then list it in the module's `verification` |
