---
name: large-repo-navigation
description: Use when working in a repository too large to read end to end (1,000,000+ lines), on cold start in an unfamiliar tree, or when a search result comes back truncated.
whenToUse: Any task in a repository whose full contents cannot fit in context, especially first contact.
---

## Purpose
Operate in a repository that cannot be read. Substitute a declared module map for a full scan, impact-scoped verification for full re-runs, machine-enforced boundaries for reviewer vigilance, and incremental caches for recomputation. Produces a focus set of module ids, a context pack path, and a verification plan sized to the diff rather than to the repo.

## When this fires
- First contact with a tree you have not edited in this session.
- A `glob` or `grep` result is reported as truncated or capped.
- A change touches more than one module, or crosses a layer boundary.
- Onboarding an existing codebase onto the governance engine (brownfield).
- Full verification would cost more wall time than the edit it verifies.
- A delegate asks "where is X" instead of naming a module id.

## Procedure

### A. Cold start on an unfamiliar large repo
1. `node .dsh/base/dsb.mjs doctor` - confirms engine, catalog and toolchain. Exit 3 means governance is not configured: stop and report, never continue as if the result were clean. Exit 2 means blocking failure: stop.
2. `node .dsh/base/dsb.mjs catalog-lint` - confirms the module map itself is well formed. Exit 1 means the map is wrong; every scoping decision made from a broken map is invalid, so fix the catalog first.
3. `node .dsh/base/dsb.mjs impact` - maps changed or intended paths to `modules[]`, layers, owners, risk tier and the check ids selected by `riskChecks`. An empty plan is BLOCKED, not PASS: it means the paths matched no module, so either the paths are wrong or the catalog has a hole.
4. Read only the `AGENTS.md` of each impacted module directory. Nested instruction files auto-load when a first-party `read`/`write`/`edit` touches that directory, so one targeted read per impacted module pulls in its contract; do not walk sibling modules "for background".
5. `node .dsh/base/dsb.mjs context-pack --focus <module-id>` - materialise the pack once and pass its path onward. Retyping context into a prompt is the second most expensive habit in this repo, after reading files nobody asked for.
6. Delegate execution per `delegation-protocol`, with the pack path in the Existing pattern field. Retain judgement; delegate evidence gathering.
7. `node .dsh/base/dsb.mjs gate` on the impacted scope before claiming done. Exit 2 stops the task; exit 4 means the evidence is stale and must be regenerated, not re-argued.

### B. Search discipline (in force at all times)
1. `grep` or `glob` before `read`. A path pattern or a regex answers "does this exist" and "where" at a fraction of the cost of opening the file.
2. Never read a file over 500 lines in full when a targeted `grep` plus a bounded `read` (`offset`/`limit`) answers the question. Open the matched region plus 40 lines of context.
3. Never read generated output, lock files, minified bundles, snapshots, or vendored trees. If such a path is required for a decision, state which decision, and read only the matched lines.
4. Search by symbol, error string, or configuration key - not by guessed filename. Guessed filenames produce empty results that are misread as absence.
5. One question per search. A regex encoding three unrelated questions produces a result set nobody can attribute.

### C. Brownfield onboarding (existing repo, governance off)
1. Enumerate top-level structure with one depth-limited `glob`; do not recurse into everything.
2. Declare `modules[]` in `.dsh/base/catalog.json`: `id`, `paths[]`, `layer`, `owners[]`, `riskTier`, `dependsOn[]`, `forbiddenDependencies[]`, `provides[]`. Start coarse; a map with 12 accurate modules beats 90 speculative ones.
3. Set `attributes{}` per module across the eight quality attributes. Any `minimal` or `none` requires a written `attributeReasons` entry; `critical` and `high` block the gate, so declaring them commits you to wiring checks.
4. `node .dsh/base/dsb.mjs arch-check` - expect violations. Do not fix them now and do not delete the edges from the catalog to make the number go down.
5. `node .dsh/base/dsb.mjs arch-check --record` - freeze the current violation counts as the baseline snapshot. This is the moment existing debt becomes tolerated and new debt becomes blockable.
6. Turn the ratchet on: `node .dsh/base/dsb.mjs arch-trend --gate` in the gate path. It fails only when the newest measurement is worse than the best ever recorded.
7. Wire `checks{}` for the modules whose attributes are `critical` or `high` first. A missing tool reports BLOCKED, never PASS.

### D. Budgets
| Budget | Value | Enforcement |
|---|---|---|
| Reads before first edit, cold start | 10 files / 2000 lines | prompt-only |
| Full read of a single file | up to 500 lines; beyond that use `offset`/`limit` | prompt-only |
| Modules read per task | only those named by `impact` | prompt-only |
| Changed files / lines / modules / new files per change | `budget{maxChangedFiles,maxChangedLines,maxModulesTouched,maxNewFiles}` | `node .dsh/base/dsb.mjs budget`, exit 1 |
| Re-verification scope | check ids selected by `impact` | `node .dsh/base/dsb.mjs gate`, exit 2 |

Exceeding the budget means split the change. Raising the limit to fit the change is a catalog edit that requires the module owner.

### E. Truncated scans
A truncated `glob` or `grep` result is a bad measurement, not a small answer.
1. Do not conclude "no other matches" from a truncated set.
2. Narrow the query (add `include`, anchor the path, tighten the regex) and re-run until the result is complete, or read the full spilled result file the tool reports.
3. If it still cannot be made complete, fan out conservatively: treat every candidate module as impacted and run the full check set for that layer.
4. Record the truncation in the navigation note. A silent pass on a truncated measurement is a fabricated result.

## Output contract
Emit one navigation note before the first edit, and paste it into the dispatch brief of any delegate:

```
Focus modules : <module-id>[, <module-id>...]   (source: dsb impact)
Layers        : <layer>[, <layer>]
Risk tier     : <critical|high|medium|low|minimal|none>
Context pack  : <path from dsb context-pack --focus>
Checks        : <check ids selected by riskChecks>
Read budget   : <files read>/<lines read>
Truncation    : none | <query> truncated, handled by <narrow|full fan-out>
Unknowns      : <question -> who answers it>
```

For brownfield onboarding also emit the baseline line: `arch-check --record` snapshot id, violation count per category, date.

## Stop conditions
Halt and ask the human when:
- `doctor` exits 3 (governance not configured) or `catalog-lint` exits 1 and the fix is not obvious from the error.
- `impact` returns an empty plan for a non-empty change set: the catalog does not describe the code you are editing.
- The change would exceed `budget` and cannot be split without breaking a public contract.
- A required module has no `owners[]`, or the owner list is stale.
- A truncated scan cannot be narrowed and conservative fan-out exceeds the session time available.
- Onboarding requires recording a baseline that would freeze a `security`, `safety` or `privacy` violation. Protected attributes are never baselined away; escalate instead.

## Anti-patterns
| Failure mode | Correction |
|---|---|
| Reading the tree to "get oriented" before running `impact`. | The module map is the orientation. Run `doctor`, `catalog-lint`, `impact`, then read at most the impacted modules. |
| Running the full check suite because scoping felt risky. | Scope with `impact`; if the result is doubted, fix the catalog, do not brute-force the suite. |
| Reading a 4000-line file in full to find one function. | `grep` the symbol, then `read` with `offset`/`limit` around the hit. |
| Treating a truncated `grep` as "no further matches". | Narrow and re-run, or fan out to every candidate module and say so in the note. |
| Deleting catalog edges so `arch-check` reports zero violations. | Record the real baseline with `arch-check --record`; the ratchet tolerates old debt and blocks new debt. |
| Pasting module context into every subagent prompt. | Generate one pack with `context-pack --focus` and pass the path. |
| Editing a module whose `AGENTS.md` was never opened. | Touch the module directory with a first-party read so its contract loads, and follow it. |
| Raising `maxChangedLines` to make `budget` pass. | Split the change; a limit edit is an owner decision, not a workaround. |
