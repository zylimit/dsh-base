# dsh-base cross-pollination ledger

A record of what dsh-base absorbed from its sibling scaffolds, what it rejected,
and why. Absorption and rejection both leave a trace, so nothing is re-evaluated
from memory and nothing is absorbed without evidence of where it landed.

Maintenance rule: when a sibling repository gets new commits, read the diff,
record each candidate mechanism here with one verdict - **absorbed** (name where
it landed), **adapted** (name the dsh shape), **rejected** (name the reason), or
**watching** (not decided). A rejected item stays rejected until new evidence
appears; an absorbed item stays absorbed unless a regression proves it wrong.

Observed siblings: cc-base (Claude Code scaffold), codex-base (Codex scaffold),
and earlier cursor-base / pi-base / opencode-base / agy-base studies absorbed
into the scaffold's founding design (see CHANGELOG 1.0.0).

---

## Position

dsh-base is the DeepSeek Harness scaffold. The harness has no hook system, no
project settings file and no markdown subagents, so enforcement lives in the
engine, git hooks and CI - the siblings' in-session hook machinery is a host
surface dsh does not have and will not fake. What the siblings measure with
hooks, dsh measures with the engine; where they are ahead, this ledger is how
we stay behind them never.

Measured margins (2026-09-03): 95 self-test assertions, 159 behavioural tests,
a 58-row golden-baseline ruler with a 13/13 mutation kill rate, all green in
CI across ubuntu/windows/macos x node 22/24. The ruler scenario set now
includes a real gate run, a fast-mode loan window, the full structured-review
loop (start/blue/lenses/verdict/receipt), and corrupt receipt/trend fixtures,
so the newest integrity code dies twice: once by its behavioural test, once
by the ruler.

---

## cc-base (Claude Code scaffold)

Studied line-by-line 2026-09-02/03 (HEAD 248219a, then 26f5af5). It is a
deliberate dsh fork: their stated theory of win is turning dsh's prompt-only
rules into Claude Code hooks rather than matching our subcommand count.

| Mechanism | Verdict | Where it landed / why |
|---|---|---|
| Window-bound instruction exemptions (marker carries sha256 of line +- 1) | absorbed | scan-instructions.mjs --hash; editing the exempted content or either neighbour voids the exemption (suppression-stale) |
| Rules-audit M/P/phantom/U taxonomy | absorbed | rules-audit RULE_PHANTOM; enforcement-shaped tokens that resolve to nothing read as enforced while enforcing nothing |
| Per-edge drift ratchet + forbidden zero-tolerance | absorbed | arch-trend: trend snapshots store edge identities, regression = edge absent from a prior snapshot; forbidden edges are never baselineable |
| Review pack deletions/renames sections | absorbed | review-pack: budgeted removed-lines section + renames section ("review what left, not only what arrived") |
| Golden-baseline mutation ruler | absorbed | tests/golden-baseline.mjs --record/--check/--mutate; field-name-keyed masking only, digests verbatim; 10/10 kill |
| PostCompact invariants re-injection | adapted | dsh has no compaction hook; invariants + recap are the re-injection surface, and law 8.6 makes them the recovery path |
| Supervisor dev-daemon (backoff, health probe, storm breaker) | absorbed | .dsh/base/supervisor.mjs with pid-liveness status |
| In-session tool-use hooks (secret-exfil guard, no-direct-code, stop-gate) | rejected | dsh has no tool-use hook surface; the engine gate + githooks + CI are the enforcement seam |
| Machine-enforced author != reviewer | rejected | their own wiring is half-built (authorshipEnforced is always false in real sessions); dsh stays honestly prompt-only (law 5b.6) until a real feed exists |
| auto-push / kill-dev-ports hooks | rejected | violates least-side-effect (law 2: push is HIGH-tier); their own codex audit rejected these too |
| bypassPermissions default + fail-open secret guard | rejected | a hook bug must not have no permission backstop; dsh never ships bypass-by-default |
| Waiver rewriting an executed FAIL into SKIPPED | rejected | the exact defect they still carry (TODO 20b); dsh fixed it: a waiver pre-declares a skip, executed results are immutable (commit 689899a) |
| all-SKIPPED aggregating to PASS | rejected | dsh BLOCKs an all-skipped plan (aggregate: every-check-skipped) |

## codex-base (Codex scaffold)

Studied line-by-line 2026-09-03 (HEAD 94744af). Strongest concept design of the
family - assurance policy lattice, policy-bound receipts, rapid evidence loans -
with the weakest wiring: at study time only 1 of 17 assurance controls drove any
behaviour, the v2 deferrable flag was dead, and rapid/debt/readiness were
built-and-tested stubs.

| Mechanism | Verdict | Where it landed / why |
|---|---|---|
| Assurance floors (risk/operation/impact/attribute/path can only raise rigor) | adapted | wired into the real system: reviewLenses raises to team/production by affected module risk tier, and release gains a blocking review-depth floor (default production, never below team, catalog.review.releaseFloor). Floors only raise; attributes only shrink |
| Pre-declared waivers (an executed FAIL is unwaivable) | absorbed | waivePlan resolves before any check runs; a protected check runs regardless; executed results are never rewritten (commit 689899a) |
| Gate-bound release readiness (a receipt alone is not a release) | absorbed | release gains blocking gate-fresh: a full passing gate bound to exactly the release surface (range via gate --baseline, or the current diff) |
| Corrupt-state quarantine (rename aside + record, never silent) | absorbed | core.quarantine + state/quarantine.jsonl; risk reports QUARANTINED_STATE |
| Deterministic git fingerprint (--no-renames, untracked content, loud truncation) | absorbed | canonicalDiff/rangeDiffHash; fingerprint identical across diff.renames settings; failed measurement fans out conservatively |
| Gate log + dead-gate audit | already had | gateAudit predates the study; the ledger + gate log feed it |
| Rapid evidence loan with derived debt | adapted | dsh fast mode is the loan: time-boxed, reason-required, skips only allowFastSkip checks, cannot close task/release until repaid; their per-check DEFERRED naming is watching |
| Receipt v2 policy-binding (policyHash/executionPolicyHash in receipts) | watching | our receipts bind diff/range/plan already; binding the assurance policy hash is valuable only once a full assurance lattice exists - porting their unwired version would import a facade |
| PermissionRequest programmatic approval | rejected | no Codex hook surface in dsh; the engine never asks and never blocks on input |
| JSON Schema files for every record type | rejected | catalog.json is data, not code (law: no executable expressions); schema validation happens in lint functions with tests, not in a schema runtime |
| Exec rules / shell_environment_policy / Guardian policy | rejected | host-specific surfaces; dsh's floor is law 7 + scan-secrets + gitleaks |

## What their audits found in dsh, and the fixes

Their 2026-09-03 v5 study of dsh-base (fda169e) named three defects; all three
are fixed with tests:

| Their finding | Fix | Evidence |
|---|---|---|
| release false-green (any fresh receipt reads as ready) | release demands gate-fresh bound to the release surface | tests/release.test.mjs, tests/range-receipt.test.mjs, commit 689899a |
| waiver rewrites an executed FAIL into SKIPPED | waivers pre-declare skips; executed results immutable | tests/waiver-honesty.test.mjs, selftest, commit 689899a |
| secret-scan gaps (unquoted assignments, URL userinfo) | two new patterns with firing/non-firing tests | tests/audit-scripts.test.mjs, commit 689899a |

### New commits 2026-09-03 (26f5af5..9063663)

| Commit | Mechanism | Verdict | Where it landed / why |
|---|---|---|---|
| c006985 | supervisor stop lied on Windows: SIGTERM to the supervisor froze state at running, status inferred an abnormal death | adapted | dsh never signals the supervisor - stop writes the flag and kills the child, the parent's own exit handler finishes the stop; reading their fix exposed a dsh hole, that stop during the backoff window was ignored (the relaunch timer never checked the flag) - fixed with a red-first regression test |
| c006985 | Git Bash kill cannot signal native Windows node in tests | rejected | dsh tests drive process.kill from node, immune; CI-proven on windows-latest |
| 9063663 | "implemented but unguarded" pattern x3 (release exclusion rules had no test that reddened when deleted) | already have | the golden mutation ruler + red-first tests are the machine form of this guard; their release.mjs exclusion table has no dsh counterpart - every releaseReadiness condition has tests |
| bbbae36 | Windows CI was running a form that does not exist on Windows | note | dsh CI runs the real suite on windows-latest; no counterpart needed |
| 75fd0b0, 53fdcb0 | progress bookkeeping for the CI five-layer green | note | no mechanism |
| 3eb1948 path contract | out-of-repo absolute paths were rendered as path.relative '../etc/nope' artifacts in engine output | absorbed | dsh rel() had the same disease; fixed with a red-first test: in-repo paths render repo-relative, out-of-repo paths keep their original spelling (tests/path-contract.test.mjs) |
| 3eb1948 adr-check --dir false green | their --dir flag read zero records yet reported "no ADRs to enforce" | no surface | dsh adrCheck takes no --dir flag; the check reads the catalog's adr dir and a missing dir is reported, not passed |
| 3eb1948 six exclusion tables with a per-arm guard | four copies of one table drifted; they guard with a test instead of a shared source | already have | dsh has two runtime tables, one deliberate difference, pinned by tests/table-consistency.test.mjs since round 2 |
| 3eb1948 doctor manifest check sampled 3 random files | a random-sample manifest check is 3-red-2-green noise with rc 0 | already have | dsh manifest check walks the full list every time; nothing is sampled |
| 9063663 #19g | engine outputs mixed absolute and relative paths for the same field | already clean | audited dsh libs: every abs() call is internal filesystem access, no absolute path enters stdout JSON; outputs use rel() throughout |
| 9063663 #27 | four copies of one exclusion table drifted apart | guarded | dsh has two runtime tables (DIFF_EXCLUDED, CONTEXT_DENY); their one deliberate difference (trend packable) is now documented at both sites and pinned by tests/table-consistency.test.mjs - moving anything between the sets requires editing the test in the same commit |

### New commit 2026-09-03 (6810530, codex v5 assurance checkpoint)

| Mechanism | Verdict | Why |
|---|---|---|
| rule-registry (411 lines) + schema | their echo of dsh rules-audit | our M/P/phantom taxonomy is wired, tested and dogfooded (phantom=0); theirs is a WIP checkpoint with P4/P5 unfinished - watching |
| review-receipt / review-report schemas | their echo of dsh review receipts | ours carry lens coverage and are pinned by the 61-row ruler; watching until their wiring lands |
| 48-hour Rapid Mode window | rejected | dsh fast mode caps at 8 hours: a loan without a tight deadline is a discount; their own ADR-0002 said rapid must expire absolutely |
| execpolicy-check adapter (Codex CLI bridge) | no surface | dsh has no Codex execpolicy host; the engine's own gate is the policy surface |
| ba153ed (spec trace + release readiness binding) | their echo of dsh spec/trace/releaseReadiness | we hold the wired original: spec-lint + trace + the release conditions are tested and pinned by the 61-row ruler; theirs is still wip on a refactor branch (main untouched) - watching |
| 9c5cc2e P2-1/2 relative-input regression | their own path-contract fix returned relative inputs verbatim, so the reported path was not the file fs opened | immune by construction | dsh rel() resolves against cwd FIRST then classifies; pinned by a relative-input test so the regression cannot return silently |
| 9c5cc2e P2-3 guard false security | their six-table guard grepped arm names in the whole file, so an arm mentioned anywhere bypassed the check | hardened | our table-consistency test now iterates both tables exhaustively - a one-sided addition fails, and the same lesson is quoted in the test comment |
| 9c5cc2e P2-4 setup.ps1 semantic fork | their ps1 had its own leaf-name copy logic, 16/34 arms non-equivalent, silent install gaps | immune by design | dsh setup.ps1 is a thin wrapper; install.mjs is the single implementation (the comment says exactly one to maintain) |
| codex f4e8790..2b07971 (4 wip commits) | assurance workflow alignment, installer docs, manifest/package surface closure | watching | still wip; nothing wired beyond their earlier checkpoint; re-evaluate when their refactor branch merges |
| f3cd449 cc-base cross-pollination ledger | they built their own absorbed/adapted/rejected/watching ledger and a 6-batch absorption plan | reverse flow confirmed | their batches 1/2/4 (quarantine, unreadable-receipt fail-closed, supervisor corrupt state, arch-trend corrupt lines, all-SKIPPED rc3, trace-truncation rc3, golden --mutate, doctor full-list, Windows shim discovery, url-userinfo) are all dsh mechanisms we shipped 3-8 rounds earlier and theirs are still TBD; they verified our accusations one by one and confirmed them; their "not-reclaiming" row claims the window-bound exemption/rules-audit/per-edge ratchet/review-pack deletions/mutation ruler/supervisor as their own originals - both ledgers record their own lineage and both are readable in the other repo |
| f3cd449 symlink spelling priority | their repoRelative went spelling-first with identity fallback (100k calls 1449ms->154ms) | already aligned | dsh rel() is lexical path.resolve - spelling-first by construction, no realpath per call |
| f3cd449 trace truncation | their batch-1 plans truncated trace -> rc3 | preempted | dsh trace ignored t.truncated and reported ok over an incomplete set - fixed before their batch landed: ok folds !truncated with a reason (tests/trace-truncation.test.mjs) |
| f3cd449 receipt engineHash (their batch 3, from codex identity.mjs) | runtime tree hash into evidence identity | preempted | dsh receipts now bind engineIdentityHash - evidence from an older scaffold cannot certify a newer one, so a scaffold upgrade stales receipts and forces re-review (tests/engine-binding.test.mjs) |

### cc-base 2.0.0 delivered (harvest 2026-09-06, 70 commits since f3cd449)

| Commit(s) | Mechanism | Verdict | Why |
|---|---|---|---|
| v3-A series | tier architecture: profile.json three strength tiers, tier.mjs single resolver, 22 hooks three-state; fast mode folded into tiers (advise blocks nothing but records debt) | watching | their assurance-profile answer; dsh has REVIEW_PROFILES + fast mode + floors - the same design space, different shape |
| v3-D series | all 52 bash/ps1 hooks deleted; 22 hooks ported to one Node runtime (239/0 red locks) | no surface | dsh has no host hook surface; our single Node engine is the equivalent move, made at founding |
| 873fb98 + 89727eb | fast-window read-side 8h clamp anchored on the write-time epoch; future timestamps cannot shift the window | absorbed | our fastState trusted the stored until - a hand-edited future date extended the loan indefinitely; fixed red-first (tests/fast-clamp.test.mjs) |
| f2eee5c | manifest --check compares-only and is hooked to pre-commit | absorbed | our pre-commit now runs the manifest check when FRAMEWORK-MANIFEST.json exists, so a changed managed asset without a regenerated manifest is caught at commit time |
| 346b354 | their whole mutation matrix deleted; meta-tests do not enter the release chain | divergence, keep ours | our battery stays: it is the guard against unguarded implementations, run manually and pinned by the ruler |
| ad319fb | golden baseline thinned 29k->14k lines by hashing big stdout by size | note | we keep full structure with field-name masking and verbatim digests; both rulers hold, different cost trade |
| 56448b6 | six exclusion tables consolidated into one exclusions.json + generator with a drift gate | equivalent, keep ours | our two tables + exhaustive guard test pin the same contract with less machinery |
| 05970e3 | CLAUDE.md dieted 349->188 lines | note | our AGENTS.md is 18.5KB and the user has ruled the size argument settled |
| 6f67a18 | dispatch only minimal context; subagents must not self-derive/verify/long-report (user's 60-round complaint) | note | our law 9 envelope + evidence handles already codify this |
| dbbb35a | repo went public with internal addresses scrubbed | note | not our call |

### codex-base 2.0.0 delivered (harvest 2026-09-06, refactor branch merged, 13 commits)

| Commit | Mechanism | Verdict | Why |
|---|---|---|---|
| 9e455d5 | v5 assurance harness complete (harness.mjs +921, bootstrap +264) | watching | real wiring this time; the resolver now drives policy - their own admission of human-acceptance-unverified stands |
| e2199a6 | flexible assurance: policy v2 resource caps, read-only floors, policy-aware context budgets | watching | the floors direction matches our PROFILE_RANK; the context-budget-per-policy idea is recorded for the next context-pack change |
| 6d1429d, 912238c | command-safety gaps, git-config and trace evidence gaps | already have | our gate is the command-safety surface and our trace fails truncated measurements |
| 85bf110 | authorized Git lifecycle automation | no surface | dsh never automates git operations; release never tags |
| a862013 | stale gate-log lock recovery test | no surface | dsh gate log is append-only with no locks; corruption fails visible instead |
| 989fe43 | hook decision preservation + PowerShell 7 interop | already have | dsh gate log preserves every decision; setup.ps1 already requires PowerShell 7 |
| their v5 spec-lint: only a heading declares a requirement | heading-bound declarations | absorbed this harvest | our specLint counted prose citations as declarations - our own PRODUCT-SPEC prose index line was a phantom-declaration factory; fixed red-first (tests/spec-heading.test.mjs), 27 requirements re-anchored to their real headings with zero loss |

### The big day 2026-09-04/05 — both delivered real work

| Commit | Mechanism | Verdict | Why |
|---|---|---|---|
| cc a30aa21 (#47) | authorship auto-recording: PostToolUse hook feeds agent_type + file_path into an authorship ledger, making author != reviewer machine-enforced | verified real | their A/B evidence shows enforced:true with a ledger and an honest false without one; record-keeping fails open (never blocks a tool). dsh has no PostToolUse surface, so our law 5b.6 stays honestly prompt-only - and theirs now admits the earlier half-wiring in the commit message |
| cc ca8f080 (#20b) | waivers pre-declared; an executed FAIL is no longer rewritten to SKIPPED | their absorption of dsh waivePlan | the exact mechanism we shipped in round 1; their golden re-record was their stated reason for deferring it |
| cc 750fe76 | instruction-exemption window hash rebinding + local git hooks install | their absorption of dsh window-bound exemptions | rebinding after the exemption context changed; the CI red they fixed 3 times was hook-install state |
| cc d3e0d1a | secret pattern scheme relaxation + fast-mode CRLF fork + static-check.ps1 | note | their fix list; the CRLF fork is the class our LF-normalization is structurally immune to |
| cc de9864c (#41) | atomic installer lock creation | their batch-5 slice | codex-inspired; our installer has staged swap + the dsh-base-new sidecar policy instead |
| cc b976a08 (v3-D) | 22 pairs of node-hook red-lock tests; v3 moves hooks from bash/ps1 pairs to one Node implementation | watching | their v3 "tiered execution + trimming" echoes codex assurance profiles; dsh already has one Node engine |
| cc #52 (TODO) | pre-push block reasons are not persisted | already have | dsh persists every gate with reason + results in the ledger and the gate log |
| codex 9e455d5 + e2199a6 | v5 assurance harness complete; policy-v2 resource caps, read-only floors, context depth/budgets wired to one resolver | verified real this time | harness.mjs +921 lines, bootstrap +264 - the 17-control facade is being wired for real; the commit honestly says human acceptance unverified |
| codex 6d1429d, 912238c | command-safety gap closure, git-config and trace evidence gaps | watching | re-evaluate against our command-safety equivalents when they merge the refactor branch |

Also notable: codex now carries a feedback file named review-agent-no-inline-guard-vocabulary.md - the exact discipline this session recommended after their triple moderation block. The observation loop feeds both directions; ours is recorded, theirs is now too.

### cursor-base joins the observation (2026-09-05, nine commits, 2.0.0)

| Commit | Mechanism | Verdict | Why |
|---|---|---|---|
| 9748a24 | 2.0.0: tiered assurance, structured review, memory, governance audit | watching | the trio converges on one design space - which validates dsh's architecture; the differentiation is now wiring quality, test depth and honesty, where dsh holds the 61-row ruler, 164 tests and six-job CI |
| fc3ea07 | range review kept fresh against its own base, receipt bound to it | already have | dsh range receipts (write --base) do exactly this, shipped rounds earlier and pinned in the ruler |
| 05ff9ab..417962b | structured self-review three rounds, engine escalated at round 3 | already have | dsh review maxRounds escalation is the same mechanism |
| 06aaf2b, 7cd02d5 | Windows service-tree kill (EBUSY), SIGTERM-is-TerminateProcess | already have | the same class cc-base hit; dsh supervisor stop kills only the child and lets the parent finish - pinned by the backoff-window stop test |
| their Risks section | authorship is a per-conversation claim, health probe trusts any 2xx/3xx | note | honest risk ledgers are the cheapest high-value practice; ours is in progress.md the same way |

### grok-base (checked 2026-09-05)

Active at v3.3.0 (last commit minutes before this check, 145 files): shell classifier vectors, forbid-ratchet tests, CI hygiene, fitness false-green fixes, Windows missing-binary BLOCKED. No big release this cycle; incremental fixes only - smaller surface than the other three.

## Watching

- cc-base, codex-base and cursor-base are checked for new commits every round; new candidate
  mechanisms go through the verdict table before any code moves.
- codex-base receipt v2 policy-binding and the rapid-loan DEFERRED naming are
  the two watching items; both need a real assurance lattice first.
