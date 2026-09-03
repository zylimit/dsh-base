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
- 88 engine self-test assertions and 123 behavioural tests; the scaffold governs itself.
