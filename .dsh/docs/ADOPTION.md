# Adoption

How to install dsh-base into a repository. Three starting points: a brand-new project,
an existing greenfield project, and a 1M-line brownfield monolith. The engine is the same in
all three; only the order of enablement differs.

## 0. Preconditions and the on/off switch

| Requirement | Check |
|---|---|
| Node >= 20, git worktree, engine intact | `node .dsh/base/dsb.mjs doctor` then `selftest` (exit 0) |
| Project constitution present | `AGENTS.md` at the repository root — `agents-lint` errors without it |
| Governance enabled | `.dsh/base/catalog.json` exists and parses |

**The catalog is the switch.** With no `catalog.json`, every catalog-dependent subcommand
exits `3` (degraded) and says so; nothing silently passes. That is a valid steady state for
a small repository: skills, `AGENTS.md`, `skills-lint`, `selftest` and `doctor` still work.
Copy the engine's referenced starting point, `.dsh/base/catalog.example.json`, to
`.dsh/base/catalog.json` when you are ready to turn governance on.

Runtime state is already ignored: the installer ships `.dsh/base/.gitignore` covering
`state/`, `evidence/`, `receipts/` and `waivers/`. **`.dsh/base/trend/` is deliberately
not ignored** — the architecture-debt ledger is a shared team fact, and a per-machine
baseline would let every developer measure against a different best value, which
disables the ratchet ([ADR-0007](../../docs/adr/ADR-0007-debt-ratchets-one-way.md),
[PROTOCOLS.md](PROTOCOLS.md) section 8).

## A0. Batch adoption across many repositories

One installer, one policy, run unattended:

```sh
node /path/to/dsh-base/.dsh/base/install.mjs --targets-from repos.txt --hooks --enable --verify --json
```

| Property | Behaviour | Why it matters in batch |
|---|---|---|
| Idempotent | a repeat run copies 0 files | re-running over 200 repositories is safe |
| Never overwrites a project edit | writes `<file>.dsh-base-new` beside it | one team's customisation is not silently reverted |
| Line-ending blind | content identity is LF-normalised | a CRLF checkout does not stage all 74 managed files |
| Excludes instance data | no `docs/requirements/**`, no `docs/adr/ADR-*.md` | a repository never inherits another project's specification |
| Seeds memory from the template | `progress.md` from `.dsh/templates/PROGRESS.md` | no repository starts with someone else's Done list |
| Records the hook mode | `git add --chmod=+x` | hooks stay executable when the repository is cloned on Linux |
| Verifies after staging | `--verify` stages first, then lints | a classification over 0 tracked paths is reported as proving nothing |
| Per-target isolation | one bad target does not stop the batch; exit 1 | a failed repository is visible in the JSON, not hidden |

Read the JSON result rather than the console: each entry carries `copied`,
`unchanged`, `staged`, `kept`, `warnings`, `errors` and a `verify` block with
`trackedPaths` and `unmapped`. A target with a non-empty `staged` list has a local
customisation waiting for review; a target with `errors` did not install.

## A. Brand-new project

1. Run the installer (above) against the empty repository; commit before writing any
   product code.
2. `git config core.hooksPath .dsh/base/githooks` — `doctor` check `git-hooks-installed`
   verifies exactly this value.
3. Write `docs/requirements/PRODUCT-SPEC.md` first. `spec-lint` requires normative
   (`SHALL`/`MUST`) requirements, an EARS trigger, a metric for every `NFR-`, and acceptance
   criteria. It also errors when `security`, `safety`, `privacy`, `resilience` or
   `reliability` is not addressed anywhere in the spec.
4. Write `catalog.json` with the modules you intend to build, their `layers`, their
   `forbiddenDependencies`, and one check per `riskChecks` tier. Modules may precede code.
5. Declare attributes on day one — it is far cheaper than retrofitting them
   ([QUALITY-ATTRIBUTES.md](QUALITY-ATTRIBUTES.md)).
6. Run `dsb dod`. In a new repository it should reach exit 0 within an afternoon; keep it
   there.

## B. Existing greenfield project (under ~50k lines, structure known)

1. Install as in A, steps 1–2, without touching product code.
2. `node .dsh/base/dsb.mjs catalog-lint` — expect `UNMAPPED` (exit 1). Classify every
   tracked path into `modules`, `global` or `ignored`. Do not use a catch-all glob: `*`,
   `**` and `**/*` are rejected as `CATCH_ALL` errors precisely because they hide unmapped
   files behind a green gate.
3. Wire the checks you already have (unit tests, lint, typecheck, existing scanners) into
   `checks`, each with the `attributes` it genuinely claims, and reference them from
   `modules[].verification` or `riskChecks`.
4. `node .dsh/base/dsb.mjs arch-check` — read the drift list, fix what is cheap, declare
   what is real, then `arch-check --record` to set the baseline.
5. Backfill ADRs for decisions already made; each needs an `Enforced-by:` line resolving to a
   real check id, fitness rule id, engine capability or explicit `manual:<who>`.
6. Turn on CI: `dod` plus `gate` on pull requests, `arch-trend --gate` on merge.

## C. 1M-line brownfield monolith

The order matters. Each step is only startable when the previous one holds.

1. **Install without enabling.** Copy `.dsh/` and `AGENTS.md`; do not create
   `catalog.json` yet. Verify with `doctor` (`enabled: false`) and `selftest` (exit 0).
2. **Write a minimal catalog: 30–150 modules named after business domains,** not
   directories — `billing`, `pricing`, `fulfilment` — each with `paths`, `riskTier`,
   `owners`, and nothing else yet. Fewer than 30 modules cannot localise impact; more than
   150 cannot be maintained by hand at first.
3. **`catalog-lint` until every tracked path is classified.** Iterate: `modules` for code,
   `ignored` for vendored, generated and binary trees, `global` only for genuinely
   cross-cutting build and CI files. Stop when `counts.unmapped` is `0` and the command
   exits `0`.
4. **Freeze existing debt.** `node .dsh/base/dsb.mjs arch-check --record`. This measures
   real import edges across 30+ file extensions and writes the first trend sample. Expect a
   large `undeclared` count; that is the point — it is now a number, not a feeling.
5. **Enable the ratchet.** Add `arch-trend --gate` to CI. It fails only when a metric
   exceeds the best value ever recorded, so legacy debt is tolerated and new debt is not.
6. **Declare attributes on the highest-risk modules first** — the ones handling money,
   personal data, authentication, or physical/irreversible effects. Leave everything else
   undeclared for now; an undeclared attribute blocks nothing, and a false `critical` you
   cannot wire yet only teaches people to ignore the gate.
7. **Wire one claiming check per blocking attribute.** For every `critical`/`high`
   declaration, add a check whose `attributes` include it and put its id in the module's
   `verification` list. Prove the wiring with `node .dsh/base/dsb.mjs attributes` (exit 0)
   before running a full `gate`.
8. **Add nested `AGENTS.md` to high-risk modules** with the sections Purpose, Boundaries,
   Invariants, Verification. dsh loads a module's `AGENTS.md` automatically the first time an
   agent reads or writes in that directory, so it is the cheapest boundary contract
   available. `agents-lint` errors when a `high`/`critical` module has none.
9. **Turn on the git hooks and CI.** `git config core.hooksPath .dsh/base/githooks`; in CI
   run `dod`, then `gate`, then `arch-trend --gate`. CI writes its own receipt — receipts
   are machine-local and do not travel with the branch.
10. **Only then start using the loop for changes** ([OPERATING-MODEL.md](OPERATING-MODEL.md)).

## Day one / week one / month one

| Horizon | Done | Machine proof |
|---|---|---|
| Day one | Engine installed, `AGENTS.md` present, hooks configured, no catalog yet | `doctor` (`failing` empty except `catalog-present`), `selftest` exit 0, `skills-lint` exit 0 |
| Week one | Catalog with 30–150 modules; zero unmapped paths; architecture baseline recorded; ratchet in CI | `catalog-lint` exit 0, `arch-check --record` run, `arch-trend --gate` exit 0 |
| Month one | Attributes declared and wired on high-risk modules; ADRs carry `Enforced-by`; requirements linted and traced; gate green on every merge | `attributes` exit 0, `adr-check` exit 0, `spec-lint` and `trace` exit 0, `dod` exit 0 |

Horizons are targets for planning, not measurements.

## What to do when `catalog-lint` reports 40,000 unmapped paths

That is the expected first result in a monolith. It is one error finding
(`UNMAPPED`, exit `1`) with a count, not 40,000 problems.

1. **Do not add a catch-all glob.** `CATCH_ALL` is a hard error. A catch-all would report
   green while every path escaped targeted verification — the exact failure this design
   exists to prevent.
2. **Measure before mapping.** Group the tracked list by top-level directory and sort by
   file count. In most monoliths 20 directories cover 80% of the paths.
3. **Sort into three buckets, in this order.** `ignored`: vendored, generated, fixtures,
   binaries — no impact effect, no gate cost. `modules`: real code, mapped to business
   domains. `global`: only truly cross-cutting files (root build config, CI definitions).
   Keep `global` tiny — any change to a global path forces a conservative full fan-out
   marked `degraded`, which makes every gate maximal.
4. **Iterate top-down**, re-running `catalog-lint` after each batch and watching
   `counts.unmapped` fall. Most of the count disappears in the first two passes.
5. **Expect exit `1` during adoption and do not suppress it.** Until unmapped reaches zero,
   `impact` fans out to every module and flags `degraded`: verification is expensive but
   never falsely green.
6. **Watch for `TRUNCATED`.** Above `maxTrackedPaths` (default 200000) the file list is cut
   and coverage is incomplete; raise the limit rather than accept a partial measurement.
7. **Resolve `OVERLAP` errors** by making one glob more specific: two modules claiming a
   path at equal specificity means neither owns it.

This document installs the machinery; [OPERATING-MODEL.md](OPERATING-MODEL.md) runs it;
[CAPABILITY-MATRIX.md](CAPABILITY-MATRIX.md) records what was deliberately left out;
[PROTOCOLS.md](PROTOCOLS.md) fixes the file formats it all depends on.
