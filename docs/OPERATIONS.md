# Operations - the daily commands, exactly

This document is the concrete counterpart to `AGENTS.md` and the
`.dsh/docs/` theory: what to type, in which order, and what each run proves.
Every timing figure below was measured on 2026-09-02 with the commands shown,
not estimated.

> **Current review configuration** (fast-iteration, decision recorded in
> `progress.md` 2026-09-02): `catalog.review.profile = "personal"` with
> `catalog.review.lenses = ["correctness"]` - only the correctness lens convenes.
> Rejected alternative: the production team (6 lenses). Repayment obligation:
> revert to `production` and re-run the full-lens review before any release,
> because an unconvened security/privacy lens is a gap, not a pass.

## 0. Known environment issue: unpoison git first

The development environment that hosts this repository injects
`GIT_CONFIG_COUNT=1` with an empty `GIT_CONFIG_KEY_0` and a proxy URL in
`GIT_CONFIG_VALUE_0`. Every bare `git` call then dies with
`error: missing config key GIT_CONFIG_KEY_0`, and every dsb command that
derives facts from git (`gate`, `impact`, `arch-check`, `cochange`,
`review start`, `release`) misreports `not a git repository`.

Prefix every git-dependent command with:

```sh
export GIT_CONFIG_COUNT=0
```

This is per shell, not once per machine: each fresh shell re-injects the
broken variable. The root cause lives in the harness runner, outside this
repository. Delete this section once that is fixed.

## 1. Daily loop: change code, prove it, commit

```sh
export GIT_CONFIG_COUNT=0
node .dsh/base/dsb.mjs gate
```

The gate is impact-scoped: only checks that claim attributes of the changed
modules run. Measured on a clean tree, all 14 checks: about 5.3 s total
(`unit` 3.4 s, `syntax` 1.1 s). Exit `0` means PASS and the evidence is
recorded under `.dsh/base/evidence/`. Exit `2` means a blocking gate failure -
read the per-check lines, fix, and re-run the same command. Never re-run with
different arguments to obtain a greener answer.

## 2. Deadline mode (fast mode)

```sh
node .dsh/base/dsb.mjs fast on --minutes 90 --reason "ship X now, repay before close"
export GIT_CONFIG_COUNT=0
node .dsh/base/dsb.mjs gate     # measured 1.9 s; unit and trace become SKIPPED (fast-mode)
```

Rules that hold during the window:

- a reason is mandatory and the window has a hard maximum of 8 hours;
- only checks pre-marked `allowFastSkip` can be skipped - in this repository
  that is `unit` and `trace`;
- checks claiming security, safety or privacy run regardless, window or not;
- the gate record is stamped `fastMode` and that record cannot close a task
  or a release.

Repay the debt before the window closes:

```sh
node .dsh/base/dsb.mjs fast off
export GIT_CONFIG_COUNT=0
node .dsh/base/dsb.mjs gate           # full run, all 14 checks
node .dsh/base/dsb.mjs fast status    # must say "fast mode is closed"
```

## 3. Review (currently correctness-only)

```sh
export GIT_CONFIG_COUNT=0
node .dsh/base/dsb.mjs review-pack                    # evidence pack, incl. deletion audit
node .dsh/base/dsb.mjs review start                   # opens the session, prints convened lenses
node .dsh/base/dsb.mjs review blue < claims.json      # what was verified, with evidence
node .dsh/base/dsb.mjs review lens correctness < findings.json
node .dsh/base/dsb.mjs review verdict                 # exit 0 = ACCEPT, receipt written
```

stdin formats (the engine rejects anything else):

```jsonc
// blue   {"claims":[{"claim":"what I verified","evidence":"command + exit code, or evidence path"}]}
// lens   {"findings":[{"severity":"error","location":"file:line","summary":"located problem"}]}
```

- delegate each lens to a separate agent that did not write the change;
- a finding without a `file:line` is rejected;
- the verdict is computed from what was recorded, never asserted - one error
  finding means FIX_REQUIRED, four clean lenses cannot outvote it;
- `maxRounds` is 3; at the limit the verdict reports `escalate` and stops.

## 4. Before a release

1. `node .dsh/base/dsb.mjs fast status` - must say closed.
2. Revert `.dsh/base/catalog.json` review block to `"profile": "production"`
   (remove the `lenses` override), commit it.
3. Full gate must PASS with no `fastMode` stamp.
4. Full-lens review must ACCEPT (production convenes correctness, testing,
   architecture, security, reliability, performance).
5. `node .dsh/base/dsb.mjs release` - checks nine conditions and never tags.

## 5. Quick reference

| Intent | Command |
|---|---|
| Prove the change | `node .dsh/base/dsb.mjs gate` |
| What does my change affect? | `node .dsh/base/dsb.mjs impact` |
| Open/close a fast window | `node .dsh/base/dsb.mjs fast on --minutes N --reason "..."` / `fast off` |
| Where is the fast debt? | `node .dsh/base/dsb.mjs fast status` |
| Assemble review evidence | `node .dsh/base/dsb.mjs review-pack` |
| Open a review session | `node .dsh/base/dsb.mjs review start` |
| Record the blue claims | `node .dsh/base/dsb.mjs review blue < claims.json` |
| Report one lens | `node .dsh/base/dsb.mjs review lens <name> < findings.json` |
| Compute the verdict | `node .dsh/base/dsb.mjs review verdict` |
| Where are we? | `node .dsh/base/dsb.mjs recap` |
| What may never be traded away? | `node .dsh/base/dsb.mjs invariants` |
