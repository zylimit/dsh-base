# progress.md — project memory

Contract: the `progress-ledger` skill. `Pinned` is immutable within a phase,
`Decisions` is append-only and every entry names the rejected alternative, every
`Done` entry carries an evidence pointer, TODO ids are monotone and never reused,
and hedged language is demoted to `Notes` as `Needs-Confirmation`.

## Pinned

- Goal: a DeepSeek Harness development scaffold in which every rule is either backed by a named command or explicitly marked prompt-only, installable unattended across many repositories.
- Constraints: zero runtime dependencies, Node >= 20; a missing tool is BLOCKED and exit 3 is never a pass; `security`/`safety`/`privacy` have no expressible bypass; the harness has no hooks, no project settings file and no markdown commands or subagents, so enforcement lives in git hooks, CI and the engine.
- Sources: docs/requirements/PRODUCT-SPEC.md | docs/requirements/PRODUCT-SPEC-CHANGELOG.md | .dsh/base/catalog.json | docs/OPERATING-MODEL.md

## Decisions

- 2026-08-31 | chose a zero-dependency Node engine over publishing it as an npm package | a registry, version resolution and a supply-chain review are exactly the friction that defers governance | ADR-0001
- 2026-08-31 | chose git hooks and CI over waiting for a harness hook API | the scaffold has to work with the harness that exists today | ADR-0002
- 2026-08-31 | chose the module catalog as the authoritative architecture over prose plus human review | a new import line looks like an ordinary line, so review is exactly the control that misses it | ADR-0003
- 2026-08-31 | chose BLOCKED for a missing tool over treating it as a skip | a skip makes uninstalling a scanner the cheapest way to pass | ADR-0004
- 2026-08-31 | chose an unexpressible bypass for the three protected attributes over signed time-boxed waivers | an expiry is only a control if something enforces it under the pressure that causes it to be extended | ADR-0005
- 2026-08-31 | chose nested AGENTS.md over a central module-capsule directory | the harness auto-loads it on first touch, so cost scales with attention rather than repository size; a central directory is read only by someone who already knows to look | ADR-0006
- 2026-08-31 | chose a monotone drift ratchet over failing on every existing violation | a gate a brownfield repository cannot adopt protects nothing | ADR-0007
- 2026-08-31 | chose skills as the carrier for roles and commands over a project-local agent-definition format | nothing the harness ships would read the invented format | ADR-0008
- 2026-08-31 | chose to commit .dsh/base/trend/ over git-ignoring it | a per-machine baseline lets each developer measure against a different best value, which disables the ratchet | ADR-0007
- 2026-09-01 | chose one Node installer over parallel sh and PowerShell implementations | two implementations of one policy drift, and the drift is silent until a batch install corrupts a repository | manual:maintainers, reviewed at each release
- 2026-09-01 | chose to exclude the scaffold's own requirements and ADRs from installation over shipping them as examples | an adopter inherited 27 foreign requirements and spec-lint vouched for a specification nobody in that project wrote | manual:maintainers, covered by tests/installer.test.mjs

## TODO

- #001 P1 Wire a real SAST tool and a real secret scanner as checks claiming `security`, replacing the lexical `scan-secrets.mjs` as the sole evidence for high-risk modules; candidates in `.dsh/base/adapters.json`.
- #002 P1 Measure the performance budgets in `docs/LARGE-REPO-GUIDE.md` against a repository above 1,000,000 lines and replace the labelled targets with measurements.
- #003 P2 Add a behaviour regression for the skill catalog: a trigger phrase per skill and the expected observable behaviour, so a skill that never fires is detectable. Raise to P1 when the catalog exceeds 30 skills.
- #004 P2 Extend `arch-check` specifier resolution for polyglot trees; unresolved specifiers are counted and sampled today, not attributed. Raise to P1 when a target repository is not predominantly JavaScript.
- #005 P2 Render the traceability matrix as a reviewable markdown table rather than JSON only.
- #006 P2 Teach the installer an `--upgrade` mode that shows a diff for each staged `.deepseek-base-new` file instead of leaving the reader to find them. Raise to P1 once more than ten repositories are on the scaffold.

## In progress

Nothing.

## Done

- 2026-09-01 | #— Batch-ready installation | evidence: five scenario installs (empty, existing source, project-owned files, non-git, CRLF) each run twice; second pass `copied 0, unchanged 74, staged 0`; 429 CRLF endings forced into `core.mjs` still read as unchanged; `node --test "tests/*.test.mjs"` 53/53 including 10 installer policy tests; commit 0c32f81
- 2026-09-01 | #— Five batch-scale installer defects found and fixed | evidence: dual sh/PowerShell implementations collapsed into `scripts/install.mjs`; byte comparison replaced by LF-normalised identity; hook mode recorded via `git add --chmod=+x` (verified `100755` in a target index); `--verify` now stages before linting and `catalog-lint` warns `NO_TRACKED_PATHS`; per-target isolation with exit 1 on any failure; commit 0c32f81
- 2026-09-01 | #— Adoption defects found by installing into an empty repository | evidence: `catalog.example.json` left 64 UNMAPPED on first enablement, now 0; the installer shipped our own `docs/requirements/**` and `docs/adr/ADR-*.md` so `spec-lint` passed on a foreign specification, now excluded and covered by a test; `progress.md` seeded from the template; commits 0b3c159, 1c15a8a
- 2026-09-01 | #— Vacuous review receipts closed | evidence: the `progress-ledger` recovery read found `receipt verify` exit 0 on a clean tree; writing a receipt for an empty diff is now refused, verification binds `baseCommit`, a receipt carrying the empty-diff identity is reported vacuous, and a clean tree renders no verdict (exit 3); `selftest` 64/64; commit 67c2aed and follow-up
- 2026-08-31 | #— Governance engine, 27 subcommands | evidence: `node .dsh/base/dsb.mjs help` lists them; `selftest` exit 0 with 64/64 assertions
- 2026-08-31 | #— Self-governing catalog: 13 modules, 5 layers, 22 forbidden edges | evidence: `catalog-lint` exit 0 with 0 unmapped; `arch-check` exit 0 with 0 forbidden, 0 layer violations, 0 undeclared over 23 real import edges
- 2026-08-31 | #— 23 skills, 12 templates, 3 workflow scripts, 22 tool adapters | evidence: `skills-lint` exit 0, 23 discovered, 0 errors; `check-syntax` exit 0 over every tracked JavaScript file
- 2026-08-31 | #— 27 requirements at 100 % test traceability | evidence: `spec-lint` exit 0 with 27 requirements; `trace` exit 0, coverage 1, 0 dangling from code or tests
- 2026-08-31 | #— 8 ADRs, each naming a resolvable enforcement point | evidence: `adr-check` exit 0, 8 live, 0 phantom references
- 2026-08-31 | #— Four engine defects found by the engine's own tests | evidence: inline `(?m)` flag made every fitness scan degrade silently; a receipt `contentHash` collided with the ledger envelope field and broke the chain on the first receipt; `aggregate()` conflated "no affected module" with "zero resolved checks" so a clean tree blocked the gate; `canonicalDiff()` saw only unstaged content so a staged change hashed as empty. All four fixed with assertions; `selftest` 64/64, `node --test` 53/53
- 2026-08-31 | #— Enforcement seam proved by attacking it | evidence: probe commits refused for an unmapped path (`catalog-lint UNMAPPED`), a credential literal (`scan-secrets` and `fitness no-secret-literal`, independently), and an unexplained subject; in the installed target `git rev-list --count HEAD` = 1 and `leak.mjs` appears in 0 commits

## Risks and assumptions

- RISK `scan-secrets.mjs` is a lexical scanner: it proves no known credential shape is present in tracked text, not that no secret exists | trigger: a secret in an unrecognised format reaches a high-risk module | mitigation: TODO #001, wire `gitleaks` or `trufflehog` as an additional check claiming `security`
- RISK the large-repository performance figures are targets on synthetic input, not measurements | trigger: adoption on a real 1,000,000-line tree | mitigation: TODO #002; the document labels them as targets
- RISK `--no-verify` bypasses the local hooks | trigger: deadline pressure | mitigation: CI runs the same gate and is the authority for a merge; a local bypass is a HIGH-tier act
- RISK a batch install leaves `.deepseek-base-new` files unreviewed across many repositories | trigger: more than a few repositories customise a managed file | mitigation: TODO #006; the JSON result lists `staged` per target
- ASSUMPTION the `AGENTS.md` chain and `.dsh/skills` are the harness's only repository-level extension points | falsified by: re-reading `dsh-agent-instructions` and `dsh-skill-filesystem` READMEs after a harness upgrade (verified at 0.1.1-rc.2)
- ASSUMPTION the seeded `.gitattributes` keeps managed files LF in every target | falsified by: `node scripts/install.mjs <target>` reporting a non-empty `staged` list immediately after a fresh install

## Notes

- `node --test tests/` does not work on this platform; the working invocation is `node --test "tests/*.test.mjs"`, recorded in `package.json`, CI and the module contracts.
- `arch-check` reports 3 unresolved specifiers, all from fixture strings inside `selftest.mjs`. They are counted and sampled rather than dropped, which is the intended honest behaviour.
- The ADR files carry `Date: 2025-01-01` while this ledger uses the host clock (2026). Needs-Confirmation: which date the project considers authoritative | settle with: `git log --format=%aI -1 -- docs/adr` and a maintainer decision recorded here.

## Context index

- constitution: AGENTS.md
- spec: docs/requirements/PRODUCT-SPEC.md
- spec changelog: docs/requirements/PRODUCT-SPEC-CHANGELOG.md
- operating model: docs/OPERATING-MODEL.md
- machine contracts: docs/PROTOCOLS.md
- quality attributes: docs/QUALITY-ATTRIBUTES.md
- scale: docs/LARGE-REPO-GUIDE.md
- adoption and batch install: docs/ADOPTION.md
- donor absorb/reject ledger: docs/CAPABILITY-MATRIX.md
- architecture: .dsh/base/catalog.json (authoritative), docs/adr/
- engine: .dsh/base/AGENTS.md, .dsh/base/lib/AGENTS.md
- installer: scripts/install.mjs, tests/installer.test.mjs
- tests: tests/AGENTS.md
