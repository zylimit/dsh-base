# deepseek-base

A development scaffold for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

It gives a repository four things the harness itself does not ship: a project
constitution the model reads on every request, a library of loadable procedures, a
zero-dependency governance engine that turns rules into commands with exit codes,
and the git and CI wiring that makes those commands unavoidable.

It governs itself with its own engine. Every rule in `AGENTS.md` is either backed
by a named command or explicitly marked prompt-only.

## Why it exists

An agent in a large repository fails in four predictable ways: it works from an
unclear requirement, it drifts outside the boundary it was given, it claims success
it did not verify, and it leaves architecture slightly worse each time. Prompting
harder does not fix any of them. Each needs a mechanism.

| Failure | Mechanism | Command |
|---|---|---|
| Vague requirement | EARS form, acceptance criteria, measurable NFRs | `spec-lint` |
| Untraceable requirement | every id referenced by a test | `trace` |
| Scope creep | task envelope + blast-radius budget | `budget` |
| Boundary erosion | real import edges vs the declared graph | `arch-check` |
| Slow decay | debt ratchet: old debt tolerated, new debt refused | `arch-trend --gate` |
| Decisions that stop being true | every ADR names a real enforcement point | `adr-check` |
| Unproven "done" | four-state gate, missing tool is BLOCKED | `gate` |
| Green checks that prove nothing | quality-attribute coverage | `attributes` |
| Stale review | receipts bound to the exact diff | `receipt verify` |
| Rewritten history | hash-chained ledger, fails closed | `ledger` |
| Secrets in context or commits | deny list + independent audit | `scan-secrets.mjs` |
| Controls nobody uses | audit of checks that never fired | `gate-audit` |

## Install

```sh
git clone --depth 1 <this-repo> /tmp/deepseek-base

# one repository, wired and verified in a single step
sh /tmp/deepseek-base/setup.sh /path/to/repo --hooks --enable --verify
# Windows: pwsh -File C:\deepseek-base\setup.ps1 -Target C:\repo -Hooks -Enable -Verify
```

Batch adoption across many repositories:

```sh
node /tmp/deepseek-base/scripts/install.mjs repo-a repo-b repo-c --hooks --enable --verify
node /tmp/deepseek-base/scripts/install.mjs --targets-from repos.txt --hooks --enable --verify --json
```

| Flag | Effect |
|---|---|
| *(none)* | copy the managed surface, seed project-owned files once |
| `--dry-run` | report what would happen, write nothing |
| `--enable` | seed `.dsh/base/catalog.json` from the example, switching governance on |
| `--hooks` | set `core.hooksPath` and record the executable bit for the hooks |
| `--stage` | `git add` the installation |
| `--verify` | stage, then run doctor / selftest / skills-lint / catalog-lint in the installed copy |
| `--targets-from FILE` | one target path per line |
| `--json` | machine-readable output only |

The run is idempotent: installing twice copies nothing. A managed file the project
has edited is never overwritten — it is written beside the original as
`<file>.deepseek-base-new` so the change is reviewed. Project-owned files
(`AGENTS.md`, `progress.md`, `.editorconfig`, `.gitattributes`,
`cordis.patch.yml`) are seeded once and then kept. Exit `0` means every target
is clean, `1` that a target needs attention, `2` a usage error.

Requires Node 20 or later and git. Nothing else. There is no install step and no
package to add.

Governance is off until `.dsh/base/catalog.json` exists. Until then every
targeted subcommand exits 3 with a reason and the hooks stay silent.

## Layout

```
AGENTS.md                  project constitution, injected on every request
.dsh/skills/               loadable procedures; a human invokes one as /<skill-name>
.dsh/base/dsb.mjs          the engine entry point
.dsh/base/lib/             engine internals
.dsh/base/catalog.json     module map, checks, attributes, budgets - the on/off switch
.dsh/base/githooks/        pre-commit, commit-msg, pre-push
.dsh/templates/            document skeletons with their authoring rules embedded
.dsh/workflows/            reference fan-out scripts for the workflow tool
docs/                      operating model, protocols, quality attributes, NFR catalogs
scripts/                   audits that deliberately do not import the engine
tests/                     behavioural tests over the engine surface
progress.md                project memory
```

## The loop

`Frame - Specify - Design - Plan - Implement - Verify - Review - Record - Release`

Each phase produces an artifact and is closed by a command, not by an opinion.
`docs/OPERATING-MODEL.md` has the table. Load the `dsb-operating-loop` skill
before starting non-trivial work.

## Commands

```sh
node .dsh/base/dsb.mjs doctor        # is this environment able to govern anything?
node .dsh/base/dsb.mjs selftest      # does the engine still work?
node .dsh/base/dsb.mjs impact        # what does my change actually affect?
node .dsh/base/dsb.mjs gate          # prove it, impact-scoped
node .dsh/base/dsb.mjs dod           # every static governance check in one run
node .dsh/base/dsb.mjs review-pack   # evidence pack for a reviewer, with deletion audit
node .dsh/base/dsb.mjs help          # the full list
```

Exit codes: `0` clean, `1` rule violation, `2` blocking gate failure,
`3` degraded or not configured, `4` stale evidence. **Exit 3 is not a pass.**

## Documentation

| Document | Question it answers |
|---|---|
| [AGENTS.md](AGENTS.md) | what are the non-negotiable rules? |
| [docs/OPERATING-MODEL.md](docs/OPERATING-MODEL.md) | how does work flow from idea to release? |
| [docs/QUALITY-ATTRIBUTES.md](docs/QUALITY-ATTRIBUTES.md) | how are the eight attributes governed? |
| [docs/PROTOCOLS.md](docs/PROTOCOLS.md) | what are the exact machine contracts? |
| [docs/LARGE-REPO-GUIDE.md](docs/LARGE-REPO-GUIDE.md) | how does this work at 1,000,000+ lines? |
| [docs/ADOPTION.md](docs/ADOPTION.md) | how do I turn this on in an existing repository? |
| [docs/CAPABILITY-MATRIX.md](docs/CAPABILITY-MATRIX.md) | what was absorbed from prior scaffolds, and what was rejected? |
| [docs/nfr/](docs/nfr/) | resilience, security, safety, privacy, reliability tactics |

## What this is not

It is not a build system, a test runner, a CI provider, or a static-analysis engine.
It wires those in and refuses to pretend they ran when they did not. It also does not
provide legal advice; `docs/nfr/PRIVACY.md` states engineering obligations only.

## License

MIT. See [LICENSE](LICENSE).
