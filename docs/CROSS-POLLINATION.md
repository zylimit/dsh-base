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

Measured margins (2026-09-03): 95 self-test assertions, 157 behavioural tests,
a 52-row golden-baseline ruler with a 13/13 mutation kill rate, all green in
CI across ubuntu/windows/macos x node 22/24. The ruler scenario set now
includes a real gate run, a fast-mode loan window, and corrupt receipt/trend
fixtures, so the newest integrity code dies twice: once by its behavioural
test, once by the ruler.

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
| 9063663 #19g | engine outputs mixed absolute and relative paths for the same field | already clean | audited dsh libs: every abs() call is internal filesystem access, no absolute path enters stdout JSON; outputs use rel() throughout |
| 9063663 #27 | four copies of one exclusion table drifted apart | guarded | dsh has two runtime tables (DIFF_EXCLUDED, CONTEXT_DENY); their one deliberate difference (trend packable) is now documented at both sites and pinned by tests/table-consistency.test.mjs - moving anything between the sets requires editing the test in the same commit |

## Watching

- cc-base and codex-base are checked for new commits every round; new candidate
  mechanisms go through the verdict table before any code moves.
- codex-base receipt v2 policy-binding and the rapid-loan DEFERRED naming are
  the two watching items; both need a real assurance lattice first.
