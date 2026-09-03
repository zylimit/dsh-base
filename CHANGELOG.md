# Changelog

## 1.0.0

Initial release for the configuration repository.

- Project constitution (`AGENTS.md`) with eleven laws; every machine-enforced rule names its command and exit code, and prompt-only rules say so.
- Zero-dependency governance engine (`node .dsh/base/dsb.mjs`, 40 subcommands) with a five-value exit-code contract: 0 clean, 1 violation, 2 blocking gate, 3 degraded (never a pass), 4 stale evidence.
- Module catalog as the authoritative architecture: real import edges vs the declared graph, forbidden edges, layer direction, a drift ratchet, and ADR enforcement with phantom-reference detection.
- Quality attributes at six tiers with counter-evidence priority; security, safety and privacy are never waivable, never fast-skippable.
- Impact-scoped verification: four-state checks (PASS/FAIL/BLOCKED/SKIPPED), a missing tool is BLOCKED, an empty plan is BLOCKED.
- Diff-bound evidence: hash-chained ledger, working-tree receipts, and commit-range receipts (`receipt write --base <tag>`) for releases.
- Structured-disagreement review: nine lenses in three stages, convened by a rigor profile (personal 1 lens / team 3 / production 6 / regulated 9), a round cap that escalates instead of looping, and a dated backlog that never accepts security, safety or privacy findings.
- Fast mode: a time-boxed, reason-required loan that expires, skips only pre-declared checks, and cannot close a task or a release until repaid.
- Fleet layer: `fleet.json` contracts between repositories, lint, impact cost, status and recap.
- Co-change analysis: boundaries measured from git history, not asserted from line counts.
- Bounded memory: three-file synchronisation as a commit gate, budgeted `recap`, `invariants` for post-compaction re-injection, ledger and changelog archiving that never deletes.
- Catalog discovery that proposes a complete draft from the real tree, so a human corrects rather than transcribes.
- Instruction-file security scanning: AGENTS.md and SKILL.md are treated as untrusted input.
- Release readiness (`dsb release`) assembles nine conditions and never tags.
- One-directory copy surface (`.dsh/` + `AGENTS.md`), idempotent batch installer, private or vendored modes.
- Stale-PATH tool discovery: when where.exe cannot see a tool installed by WinGet, scoop or chocolatey (a PATH snapshot artifact, not a missing tool), the engine finds the directory that actually contains the executable and prepends it to the check's own PATH instead of reporting a false BLOCKED.
- Gate-bound release readiness: a release is READY only when a full, passing gate is bound to exactly the release surface (a range recorded by `gate --baseline <ref>`, or the current diff) — a review receipt alone no longer closes the gap.
- Honest waivers: a waiver pre-declares a skip before a check runs; an executed FAIL or BLOCKED is an immutable ledger fact no waiver rewrites, and protected checks run regardless.
- Secret scanning catches unquoted credential assignments and URL userinfo, not just quoted literals.
- Deterministic evidence fingerprints: rename detection is disabled in canonical and range diffs so the hash cannot depend on a machine's `diff.renames` setting; a failed or truncated git measurement is loud (no hash is produced); untracked symlinks and unreadable files are named instead of followed; and a failed changed-file measurement fans the gate out conservatively instead of reading as "nothing changed".
- Quarantined state: a corrupt task, fast-mode or review state file is moved aside with a timestamp and recorded in `state/quarantine.jsonl`; `risk` reports the quarantine, the engine continues from defaults, and nothing is silently rebuilt.
- Window-bound instruction exemptions: a `scan-instructions:ignore` marker can carry the sha256 of the marker line and its two neighbours (`--hash` computes it); editing the exempted content or either neighbour voids the exemption with a `suppression-stale` finding instead of silently widening it.
- Phantom rule detection: `rules-audit` classifies enforcement-shaped tokens that resolve to nothing (`dsb phantasm`, a missing script) as phantoms - a reference that reads as enforced while enforcing nothing - and reports them separately from silent rules.
- Per-edge drift ratchet: trend snapshots record debt-edge identities, and `arch-trend --gate` rejects any edge absent from a prior snapshot even when the count stayed level; forbidden dependency edges are violations of the declared architecture and are never baselineable; legacy count-based snapshots keep the old ratchet.
- The review evidence pack renders what left: a budgeted removed-lines section and a renames section beside the deletion audit, so reviewers cannot skim only the additions.
- Assurance floors, wired: an affected module at `high` risk convenes at least the `team` review profile and at `critical` risk at least `production` (attributes still only shrink the team); the release gate gains a blocking `review-depth` condition - the accepting receipt must convene the configured release floor (default `production`, never below `team`, `catalog.review.releaseFloor`).
- Golden-baseline mutation ruler: `tests/golden-baseline.mjs --record|--check|--mutate` pins the full stdout-JSON and exit-code contract of every subcommand across four repo states (46 rows), normalizes only field-name-keyed timestamps and environment facts (digests and counts stay verbatim), and runs a curated mutation battery against the engine to measure how much drift the contract would catch. Its first recording exposed seven host-dependent self-test assertions, now fixed: `selftest` passes 94/94 in a foreign directory.
- 94 engine self-test assertions and 146 behavioural tests; the scaffold governs itself.
