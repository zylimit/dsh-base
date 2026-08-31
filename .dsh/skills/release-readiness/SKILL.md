---
name: release-readiness
description: Use when preparing to tag, publish, or deploy; enforces four machine-checked conditions, human authorization, acceptance evidence, privacy audit, and rollback.
whenToUse: Before any release, tag, publish, or deployment step, and immediately after one.
---

## Purpose
The release gate: four conditions a machine decides, then one decision a human makes.
Produces a release record - the artifact identity, the acceptance evidence triple, the privacy audit result, and the rollback plan - so that a failed release can be undone by someone who was not present.

## When this fires
- A phase is complete and a tag, package publication, or deployment is proposed.
- A hotfix is about to bypass the normal loop.
- A release step timed out or returned 5xx and the state is unknown.
- Someone asks whether the current commit is releasable.

## Procedure

1. Verify the four conditions. All four are machine-checked; any non-zero exit stops the release.

| # | Condition | Command | Pass criterion |
|---|---|---|---|
| 1 | Definition of done closed | `node .dsh/base/dsb.mjs dod` | exit `0` |
| 2 | No `FAIL` or `BLOCKED` in the latest ledger entry, and every `critical`/`high` attribute has a fresh `PASS` | `node .dsh/base/dsb.mjs gate` then `attributes` and `ledger verify` | gate `PASS`, zero attribute gaps, exit `0` |
| 3 | Evidence is bound to the exact diff being released | `node .dsh/base/dsb.mjs receipt verify` | exit `0`; exit `4` means stale, re-verify |
| 4 | Requirement traceability meets the declared minimum | `node .dsh/base/dsb.mjs trace` | coverage >= `trace.minCoverage`, zero dangling ids |

2. Run the supporting audits and stop on any violation: `risk` (expired waivers, unmitigated high risk), `adr-check` (unenforced decisions), `arch-trend --gate` (violations must not increase), `retention` (evidence retention policy).
3. Obtain human authorization. Release is HIGH tier without exception. Present, in one message via `ask_user_question`: what ships (commit and diff hash), the four condition results with exit codes, known `Not verified` items, the rollback plan, and the blast radius. Do not proceed on silence, on "go ahead" given before the results existed, or on a subagent's approval - a delegated subagent cannot authorise a release and must report `BLOCKED` upward.
4. Perform the artifact privacy audit before publishing. Scan the exact package or image that will ship - not the source tree - for: absolute home paths (`C:\Users\<name>`, `/home/<name>`, `/Users/<name>`), tokens and API keys, private keys and certificates, `.env` files, database URLs with credentials, internal hostnames, and runtime state (`.dsh/base/state`, `evidence`, `receipts`, `waivers`, `trend`, caches, logs, coverage output). A single hit stops the release until the packaging rules are fixed. Cross-check with `node .dsh/base/dsb.mjs fitness --all` for `no-secret-literal` and `no-pii-in-logs`.
5. Write the rollback plan before the release step runs, not after: the previous artifact identity, the exact command to restore it, the data or schema changes that are not reversible, and the observable signal that says rollback is needed. A release without a written rollback plan does not proceed.
6. Execute the release step. Record the artifact identity immediately: tag or digest, and its creation time.
7. Collect the acceptance evidence triple. All three are required; two of three is not a release:
   - artifact identity: the tag or content digest actually deployed, plus its creation timestamp, matched against the commit you authorised;
   - health check: a request to the deployed instance returning a healthy status, with the response quoted;
   - live smoke test: exercise the specific capability that changed, against the deployed instance, and quote the observed result - not a local test run.
8. Treat any timeout, 5xx, or dropped connection during a release step as "may have executed". Before retrying, verify actual state: list tags, query the registry digest, check the deployment revision, inspect the migration table. A blind retry can double-publish, double-migrate, or roll a good deployment backwards.
9. Record the release in `progress.md` `Done` with the evidence triple, and write a receipt so later work can detect drift from the released state.

## Output contract
```
Release: <name> <version/tag>
Commit: <sha>  Diff hash: <hash>
Conditions: dod exit 0 | gate PASS (0 gaps) | receipt verify exit 0 | trace <coverage> >= <min>
Audits: risk 0 | adr-check 0 | arch-trend 0 | privacy audit: 0 findings over <n> packaged files
Authorized by: <human> at <timestamp>, on the results above
Artifact: <tag or digest>, created <timestamp>
Health: <endpoint> -> <status/latency>
Smoke: <capability> -> <observed result>
Rollback: <exact command> | irreversible: <migrations/data, or none>
Not verified: <explicit list>
```

## Stop conditions
- Any of the four conditions exits non-zero, or `attributes` reports a gap on a `critical`/`high` attribute.
- `receipt verify` exits `4`: the tree changed after verification - re-run the gate, do not release the older evidence.
- The privacy audit finds any home path, credential, key, or runtime state inside the artifact.
- No rollback plan exists, or the change includes an irreversible migration without an explicit human acknowledgement of that fact.
- Human authorization is absent, stale (given before the current results), or delegated to a subagent.
- A release step's outcome is unknown after a timeout and the actual state cannot be determined: stop and hand to a human; never retry blind.
- A hotfix is requested that skips the gate: state exactly which conditions are unproven and require an explicit written exception naming the accepted risk.

## Anti-patterns
| Failure mode | Correction |
|---|---|
| "CI was green yesterday" as release evidence | Evidence is diff-bound; `receipt verify` must pass for the exact diff shipping now |
| Health check treated as acceptance | Health proves the process is up; add a live smoke test of the changed capability |
| Retrying a timed-out publish or migration immediately | Verify state first: a timeout means "may have executed" |
| Auditing the source tree instead of the package | Scan the built artifact; packaging rules, not `.gitignore`, decide what ships |
| Rollback written after the release | The plan is a precondition; without it the release does not start |
| Asking for approval before the four conditions are run | Authorization must be given on the results, not on intent |
| Releasing with attribute gaps because "the tests pass" | `BLOCKED_BY_ATTRIBUTES` means the risk is unproven; wire a claiming check |
| Shipping `.dsh/base/state`, receipts, or evidence in the package | Exclude runtime state; it leaks paths, hostnames, and internal history |
