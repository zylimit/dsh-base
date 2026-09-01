# Capability matrix

The absorb/reject ledger for the six donor scaffolds — codex-base, cc-base, pi-base,
cursor-base, kimi-base, opencode-base — re-founded on dsh-native mechanisms.

Verdicts: **Absorbed** — kept with its semantics intact. **Adapted** — kept in intent,
re-expressed because the dsh mechanism differs. **Rejected** — deliberately not carried
over; the rationale column says why, and no equivalent is implied.

dsh facts that decide several rejections: dsh has **no hook system**, **no markdown slash
commands**, **no markdown subagent definitions**, **no project settings file** and **no
output styles**. Roles are skills; commands are user-invocable skills; enforcement lives in
git hooks, CI and the engine.

| # | Capability | Donor scaffold(s) | Verdict | How it is realised in dsh-base | Rationale |
|---|---|---|---|---|---|
| 1 | Module catalog | codex-base, cursor-base | Adapted | `.dsh/base/catalog.json` (`modules`, `layers`, `checks`, `riskChecks`, `budget`), linted by `catalog-lint` | One machine-readable architecture instead of prose plus a rules file; it is also the on/off switch for governance |
| 2 | Path classification precedence | codex-base | Absorbed | `classifyPath`: module > ignored > global > unmapped, most specific glob wins | Deterministic ownership; ambiguity is an error, not a coin flip |
| 3 | Catch-all rejection | codex-base | Absorbed | `catalog-lint` `CATCH_ALL` (exit 1) for `*`, `**`, `**/*`, `./**` | A catch-all reports green while every file escapes targeted verification |
| 4 | Conservative fan-out | codex-base | Absorbed | `computeImpact` sets `degraded: true` and fans out to all modules on an unmapped path, a global path, a truncated file list or a non-git tree | Over-testing is cheap; a missed regression is not |
| 5 | Reverse-dependency impact | codex-base, pi-base | Absorbed | `dsb impact` — transitive closure over `dependsOn` | Verification scope is derived, never guessed |
| 6 | Four-state gate | codex-base | Absorbed | `dsb gate` — `PASS`/`FAIL`/`BLOCKED`/`SKIPPED`, aggregated FAIL > BLOCKED > PASS | A two-state gate must call "did not run" either pass or fail; both are lies |
| 7 | Empty-plan-is-blocked | codex-base | Absorbed | `aggregate` returns `BLOCKED` with `empty-plan` (exit 2) | Zero checks prove zero things |
| 8 | Missing-binary-is-blocked | codex-base | Absorbed | `runCheck` probes the executable; `BLOCKED` with `command-missing:<exe>` | A tool that was never installed cannot have passed |
| 9 | Quality-attribute tiering | pi-base | Absorbed | `attributes` map per module, six tiers; `critical`/`high` block | Makes "how much does this matter" a declared, checkable field |
| 10 | Attribute wiring audit | pi-base | Absorbed | `dsb attributes` (exit 1) and `risk` `UNWIRED_ATTRIBUTE` | Static proof that a declaration has a claiming check before any test time is spent |
| 11 | Counter-evidence rule | pi-base | Absorbed | `assessAttributes`: coverage requires >= 1 `PASS` **and** zero `FAIL`/`BLOCKED` among claiming checks | One contradiction outranks three confirmations |
| 12 | Protected attributes | pi-base | Absorbed | `PROTECTED_ATTRIBUTES` = `security`, `safety`, `privacy`; never waived, never fast-skipped; `PROTECTED_FAST_SKIP` is a catalog error | Some risks may not be traded away under schedule pressure |
| 13 | Structured waivers with expiry | codex-base, pi-base | Absorbed | `dsb waiver create` — `owner`, `reason`, `scope`, `expiry`, `compensation`, hashed | An exception with an owner and an end date is a decision; a commented-out check is decay |
| 14 | Waiver forbidden words | pi-base | Absorbed | `validateWaiver` regex over `reason` + `scope` (`security`, `safety`, `privacy`, `pii`, `secret`, `credential`, `destructive`, `deploy`, `production`, `push`) | Blocks the rename-it-and-waive-it path around protected attributes |
| 15 | Hash-chained ledger | codex-base | Absorbed | `.dsh/base/state/ledger.jsonl`, `chain = sha256(prev + NUL + contentHash)`, verified by `dsb ledger` | Evidence that can be silently rewritten is not evidence |
| 16 | Diff-bound review receipts | cc-base | Absorbed | `receipt write` stores `diffHash`; `receipt verify` exits `4` when the tree moved | An approval is for a specific content, not for an intention |
| 17 | Evidence re-hashing | cc-base | Adapted | `gate` stores `evidence` path + `evidenceSha256` per check; `retention` never deletes ledger-referenced evidence | The hash is recorded at capture; re-hashing a log file is a manual comparison, so the claim stops at what the engine actually does |
| 18 | Arch import-edge extraction | cursor-base | Absorbed | `arch-check` — real `import`/`require`/`use`/`#include` edges across 30+ extensions in 11 language families, size+mtime cached | The measured graph beats the drawn diagram; when they disagree, the diagram is wrong |
| 19 | Forbidden dependencies | cursor-base | Absorbed | `modules[].forbiddenDependencies` + `arch-check` `FORBIDDEN` (exit 1) | A prohibition that nothing measures is a preference |
| 20 | Layer direction | cursor-base | Absorbed | `catalog.layers` order + `arch-check` `LAYER` violations | Layering is a direction rule, checkable per edge |
| 21 | Drift ratchet / baseline | cursor-base | Absorbed | `arch-check --record` + `arch-trend --gate`: fails only above the best-ever sample | Lets a brownfield repository adopt the check on day one without a rewrite |
| 22 | ADR `Enforced-by` audit | codex-base, cursor-base | Absorbed | `adr-check`: every live ADR resolves to a check id, fitness rule id, engine capability or `manual:<who>`; `PHANTOM_ENFORCEMENT` is an error | A decision nothing enforces drifts by default; a phantom reference reads as enforced while enforcing nothing |
| 23 | Fitness rules | pi-base, cursor-base | Adapted | `dsb fitness` — nine zero-dependency rules, extensible via `.dsh/base/fitness-rules.json`, suppression comment `dsb-fitness:ignore` | Kept the idea, dropped the dependency: rules that run everywhere, including on a machine with no scanner installed |
| 24 | Secret-exfiltration guard | cc-base, codex-base | Adapted | `fitness` `no-secret-literal` + `context-pack` deny list (`.env`, `*.pem`, `*.key`, `.ssh`, `.aws`, `*secret*`) with `.env.example` allowed back | dsh has no hook to intercept a read at runtime, so the guard is static scanning plus deny-listed packing — stated as what it is |
| 25 | Context pack with deny list | kimi-base | Absorbed | `dsb context-pack --focus --budget` → budgeted, deny-filtered bundle written to runtime state; caller sees a manifest | The scarce resource in a 1M-line repository is attention, so packing is a first-class, reproducible operation |
| 26 | Change budget | codex-base | Absorbed | `dsb budget` — `maxChangedFiles`, `maxChangedLines`, `maxModulesTouched`, `maxNewFiles` | A blast-radius signal to split or escalate, deliberately not a prohibition |
| 27 | Task envelope | codex-base, cc-base | Absorbed | Six fields; `task start` requires `id` + five of them and writes `.dsh/base/state/task.json` | A task without Scope and Verification cannot be delegated or judged |
| 28 | Result envelope | cc-base | Adapted | Six fields including `Not verified`; `Status` enum `DONE`/`DONE_WITH_CONCERNS`/`NEEDS_CONTEXT`/`BLOCKED` | Prompt-only: no engine command parses it. Only its Evidence pointer is machine-checkable |
| 29 | Red/blue adversarial review | cc-base | Adapted | `adversarial-review` skill + `workflow` fan-out (`agent`/`pipeline`) + verdict enum recorded by `receipt write` | dsh has no markdown subagent definitions, so the two roles are a skill plus a dispatch pattern, not files |
| 30 | Review evidence pack with deletion audit | cc-base | Absorbed | `dsb review-pack --base` — commits, diffstat, explicit deleted-file section, untracked list, diff (spilled to a file above 800 lines) | Reviewers systematically miss what was removed; the pack makes deletions a named section |
| 31 | `progress.md` contract | cc-base, kimi-base | Adapted | `progress-ledger` skill: Done needs an evidence pointer, Decisions need the rejected alternative, hedged claims go to Notes `Needs-Confirmation` | Prompt-only — no check parses `progress.md`; recovery after compaction depends on it, so the rule is stated where the agent reads it |
| 32 | Feedback graduation ladder | pi-base | Adapted | `feedback-and-evolution` skill (correction → repeated correction → rule in `AGENTS.md` or a skill → check id in `catalog.json`) | A lesson only becomes durable when it ends as a command with an exit code |
| 33 | Gate-effectiveness audit | pi-base | Absorbed | `dsb gate-audit` — lists checks that have never failed across the ledger | A control that has never intervened is cost plus false confidence; it must justify itself |
| 34 | Framework manifest | cursor-base | Rejected | — (dependency facts stay in the ecosystem manifest and lockfile; architecture facts stay in `catalog.json`) | A hand-maintained inventory of frameworks and versions is a second source of truth with no parity gate: it goes stale silently and nothing can prove it current |
| 35 | Dev-service supervisor | opencode-base | Rejected | Session-scoped background jobs (`pwsh run_in_background`, `job_output`, `job_kill`) | dsh has no daemon and no hook to reap processes; a checked-in supervisor would own long-lived processes that no gate can observe or verify |
| 36 | Three-file sync gate | cursor-base | Rejected | Replaced by three decidable checks: `arch-check` (catalog vs code), `adr-check` (decision vs check id), `trace` (requirement vs test) | "These three documents must agree" is not decidable by a machine; each replacement compares two artifacts with a defined equality |
| 37 | Stop-gate with strike breaker | cc-base | Rejected | Nearest honest equivalent: `risk` `FAIL_STREAK` (3 consecutive failures) plus the stop conditions in [OPERATING-MODEL.md](OPERATING-MODEL.md) | dsh has no hook system, so nothing can intercept a tool call and halt the agent; an advisory signal must not be described as a gate |
| 38 | Depth-1 delegation | opencode-base | Absorbed | `delegation-protocol` skill: dispatch children, never grandchildren; only depth-1 children accept `send_message` | Deeper trees lose the evidence pointer and the write partition; the orchestrator must stay able to serialise writers per module |
| 39 | No-direct-code guard | opencode-base | Rejected | Scope law in [../AGENTS.md](../../AGENTS.md) section 3, checked after the fact by `impact`, `budget` and review | Blocking the write tool needs a hook; dsh has none. An after-the-fact bound that actually exists beats a pre-emptive one that does not |
| 40 | Requirement six-dimension interrogation | pi-base | Absorbed | `requirements-elicitation` skill (actor, trigger, behaviour, boundary, failure mode, measure) | Prompt-only, but it is what makes `spec-lint` passable on the first attempt |
| 41 | EARS requirements | pi-base | Absorbed | `spec-lint`: `NOT_NORMATIVE` error (SHALL/MUST), `NO_TRIGGER` warning (WHEN/WHILE/IF/WHERE), `NO_METRIC` error for `NFR-`, `NO_ACCEPTANCE` error | A requirement that obliges nothing and triggers on nothing cannot be tested |
| 42 | Task five elements | codex-base | Adapted | Extended to six by adding `Existing pattern`; `task start` validates `id` plus five fields | Naming the pattern to imitate removes the most common source of invented structure |
| 43 | No-placeholder plan lint | pi-base | Adapted | `spec-lint` `PLACEHOLDER` (TBD/TODO/FIXME) covers requirement documents; `DEV-PLAN.md` placeholders remain a `work-planning` rule | Honest scope: the engine lints the directories it is pointed at, and the plan directory is not one of them |
| 44 | DFX six-element scenarios | pi-base | Adapted | Attribute scenarios become `NFR-<ATTR>-<NNN>` ids with metrics, plus `attributes` tiers per module | One vocabulary instead of two: the scenario is enforced through `spec-lint` and the attribute gate rather than a parallel document |
| 45 | Skill description lint | cc-base | Absorbed | `skills-lint`: `NAME_NOT_KEBAB`, `NAME_MISMATCH`, `NO_DESCRIPTION`, `DESCRIPTION_TOO_LONG` (500), `CAMEL_CASE_KEY`, `NON_BOOLEAN_INVOCATION`, `DUPLICATE_SKILL` | A malformed frontmatter key drops the whole skill silently; the catalog description is the only routing signal the model sees |
| 46 | Skill behaviour regression | cc-base | Rejected | `skills-lint` (structure) plus human review of the skill body | Running a model against fixtures on every commit is nondeterministic, unbounded in cost, and has no fixed oracle; a check that cannot decide must not be a gate |
| 47 | Checked-in compiled runtime artifact | cc-base, opencode-base | Rejected | `dsb` runs from source: `.dsh/base/dsb.mjs` + `lib/*.mjs`, zero dependencies, Node >= 20 | A compiled artifact checked in beside its source needs its own parity gate and doubles the surface to review, sign and keep in sync |
| 48 | Markdown slash commands | cc-base | Adapted | User-invocable skills: typing `/skill-name` injects the skill body | dsh has no separate slash-command mechanism; one artifact type (skills) instead of two |
| 49 | Markdown subagent definitions | cc-base | Adapted | Roles are skills; delegation goes through `subagent`/`subagent_fork`/`workflow` with a task envelope | dsh has no subagent definition files; a role is what you load, not a file the runtime instantiates |
| 50 | Hooks (pre/post tool events) | cc-base | Rejected | Enforcement moved to git hooks (`core.hooksPath=.dsh/base/githooks`), CI, and the engine's own exit codes | dsh has no hook system. Anything described as intercepting a tool call would be fiction |
| 51 | Project settings file | cc-base, opencode-base | Adapted | `catalog.json` is the single project switch; runtime configuration lives in `$DSH_HOME/profiles/<name>`, with an optional repository `.dsh/base/cordis.patch.yml` applied via `dsh --patch` and inspected with `dsh --dump-config` | dsh has no project settings file; splitting project policy (committed) from runtime configuration (per operator) keeps both honest |
| 52 | Output styles | cc-base | Rejected | Tone and format rules live in [../AGENTS.md](../../AGENTS.md) and in each skill's output contract | dsh has no output-style mechanism; a style file that nothing reads is worse than a rule in the constitution that is always injected |

## Rules for future proposals

1. Name the mechanism that would enforce it: a `dsb` subcommand and exit code, a fitness
   rule id, a git hook, or a CI job. "The agent should remember to" is prompt-only and must
   be labelled as such.
2. Name the incident it would have caught. `gate-audit` will eventually ask whether it ever
   fired.
3. Prefer extending an existing check over adding a new artifact type. Every new artifact
   needs its own lint, its own staleness rule and its own review.
4. If it requires a dsh capability that does not exist — a hook, a settings file, a
   persistent daemon — the answer is Rejected, and this table records why.
