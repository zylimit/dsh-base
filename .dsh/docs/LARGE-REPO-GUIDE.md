# Large-repository guide

Operating a repository of 1 000 000+ lines with the DeepSeek Harness and the `dsb` engine.
Related: [nfr/RESILIENCE.md](./nfr/RESILIENCE.md) · [nfr/SECURITY.md](./nfr/SECURITY.md) · [nfr/SAFETY.md](./nfr/SAFETY.md) · [nfr/PRIVACY.md](./nfr/PRIVACY.md) · [nfr/RELIABILITY.md](./nfr/RELIABILITY.md) · [../AGENTS.md](../../AGENTS.md)

## 1. Why a full scan is the wrong primitive

At a million lines, "read the code and understand it" is not a strategy — it is an unbounded cost with no completion criterion.

1. **Cost scales with repository size, not with the change.** A three-file change does not become safer by reading 40 000 files; it becomes slower and the context fills with irrelevant material.
2. **Context is finite and lossy.** Everything read competes with the task description, the diff and the verification output. dsh compacts, prunes tool results at 8192 characters (head 4096, tail 1024 in the shipped code preset) and meters tokens — but a pruned fact is a fact you no longer have.
3. **Full scans go stale instantly.** A snapshot understanding of a tree with hundreds of commits per day describes a repository that no longer exists.
4. **Full scans produce false confidence.** Having *seen* a file is not having *verified* a property of it. Verification comes from checks, not from reading.

The correct primitive is: **locate → bound → verify**. Locate the affected code with search, bound the work with the module map, verify with impact-scoped checks.

## 2. The four pillars

| Pillar | Mechanism | Command | Failure if absent |
|---|---|---|---|
| Explicit module map | `.dsh/base/catalog.json` modules, layers, `dependsOn`, `forbiddenDependencies` | `catalog-lint` | Nothing can be scoped; every change is "global" |
| Impact-scoped verification | Reverse-dependency closure over the graph | `impact`, `gate` | Either everything runs (slow) or something related is missed |
| Machine-enforced boundaries | Real import edges compared against the declared graph, plus the ratchet | `arch-check`, `arch-trend --gate` | Documented architecture drifts from the built one |
| Incremental caches | Per-file size+mtime cache for `arch-check`; scoped `fitness --paths` | `arch-check`, `fitness --paths` | Every run pays full-tree cost, so nobody runs it |

## 3. Module sizing

Target **30-150 modules** for a million-line repository, drawn along **business-domain** lines, not directory lines.

Reasoning:

1. Below ~30, modules are too coarse: nearly every change touches the same two modules, the impact set is effectively the whole repository, and `forbiddenDependencies` has nothing to forbid.
2. Above ~150, the map costs more to maintain than it returns: every refactor becomes a catalog edit, `dependsOn` lists grow into noise, and engineers stop updating it — an unmaintained map is worse than none because `impact` will confidently under-scope.
3. One module per directory is an anti-pattern: directory structure follows language and framework convention, so the map ends up describing the build system instead of the failure domains.
4. Size heuristic: a module is the unit a single team can own, whose invariants fit on one page, and whose deletion would remove one capability. Typical span 5 000-40 000 lines.
5. `riskTier` and `attributes` are declared per module; if two halves of a module need different tiers, that is the signal to split it.

## 4. Nested `AGENTS.md` as the boundary contract

dsh auto-injects the `AGENTS.md` chain: `$DSH_HOME/AGENTS.md`, then every directory from the project root down to the agent cwd. **A nested `AGENTS.md` is loaded automatically the first time a first-party read, write or edit touches that directory.** There is no watcher; the refresh is touch-driven.

That property is what makes it the cheapest boundary contract available at this scale: **cost scales with attention, not with repository size.** A repository can carry 150 module contracts and an agent working in two modules pays for two.

Rules:

1. Every module at `riskTier` `high` or `critical` carries an `AGENTS.md` with **Purpose · Boundaries · Invariants · Verification**. Machine-enforced by `agents-lint`.
2. Keep each file small (the engine's `agentsMd.maxBytes` bound, 12 000 bytes in the shipped fixture). A contract nobody can read in one screen is not a contract.
3. Write **invariants and prohibitions**, not tutorials. "Never import from `ui`", "every write goes through `repo.save`", "tenant id comes from the principal".
4. Name the module's verification command so a delegate can prove its work without asking.
5. Do not duplicate the root [../AGENTS.md](../../AGENTS.md); a nested file adds local constraints only.

## 5. Search discipline for agents

1. `glob` and `grep` before `read`. Locate by pattern, then read the located range.
2. Never read a file over ~500 lines in full when a targeted `grep` answers the question. Read with `offset`/`limit` around the match.
3. Never read generated output, lockfiles, vendored trees, minified bundles or build artefacts. They are excluded from context packs for the same reason.
4. Prefer one `run_code` program that batches independent `glob`/`grep`/`read` calls over one tool call per file. One call per file is the dominant avoidable cost in this harness.
5. Extract and print only what you need from a batched program; intermediate results stay out of the conversation.
6. Write intermediate findings to a file and pass the path. Do not paste large content into messages.
7. When a `grep` returns a capped result, it says where the complete match list was saved — read that file rather than re-running broader searches.

## 6. Context packs

`node .dsh/base/dsb.mjs context-pack --focus "src/billing/**" --budget 40000` builds a budgeted, deny-filtered bundle for a delegate. The deny list covers `.env`, key material, `.ssh`, `.aws`, `node_modules`, build output, lockfiles and all engine runtime state; `.env.example` is explicitly allowed back.

Budgets live in `catalog.json` under `contextPack`: `maxTotalChars`, `maxFiles`, `maxFileChars`, `maxDiffChars`.

When a pack reports omissions:

1. **Do not raise the budget first.** An omission usually means the focus is too wide, not that the delegate needs more.
2. Narrow `--focus` to the module or path the task actually names.
3. Split the task by module and dispatch one delegate per module.
4. If the omissions are diff-driven (a large diff), split the change; check `budget` — over budget means split or escalate, never widen the budget to hide a boundary failure.
5. Only then raise the budget, and record why.
6. Always state in the dispatch brief that the pack is partial, so the delegate reports `NEEDS_CONTEXT` instead of guessing.

## 7. Delegation and fan-out

| Pattern | Tool | Use when |
|---|---|---|
| One scoped task, result needed now | `subagent` with `run_in_background: false` | The next step depends on the answer |
| Several independent scoped tasks | `subagent` background, started in one message | Audits, per-module analyses, parallel reads |
| Task that builds on this conversation | `subagent_fork` | Review or continuation needing the current context |
| Tens of uniform units of work | `workflow` | Fan-out over modules, files or findings with phases |
| Fresh-agent iteration toward one objective | `ralph` | Only when explicitly requested |

Every dispatch carries the six-field task envelope (**Goal · Scope · Out of scope · Existing pattern · Verification · Escalation**) plus a context-pack path. Every result carries the six-field result envelope with `Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`.

Worked `workflow` skeleton — audit many modules in parallel. `meta` is a **parameter**, not code; the `script` is a plain-JS body ending in `return`:

```js
// meta: { "name": "module-audit",
//         "description": "Audit affected modules against their AGENTS.md contract",
//         "phases": [{ "title": "Audit" }, { "title": "Synthesis" }] }

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['module', 'status', 'findings'],
  properties: {
    module: { type: 'string' },
    status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'] },
    findings: { type: 'array', items: { type: 'string' } }
  }
}

const brief = (id) => [
  'Goal: audit module ' + id + ' against its declared contract.',
  'Scope: files of module ' + id + ' only, plus its AGENTS.md and catalog entry.',
  'Out of scope: every other module; no edits.',
  'Existing pattern: hard rules in .dsh/docs/nfr/RELIABILITY.md section 7.',
  'Verification: node .dsh/base/dsb.mjs fitness --paths <files of ' + id + '>',
  'Escalation: return status BLOCKED with the missing input; never widen scope.'
].join('\n')

phase('Audit')
log('auditing ' + args.modules.length + ' modules')
const results = await pipeline(
  args.modules,
  async (_prev, id) => agent(brief(id), { label: 'audit:' + id, phase: 'Audit', schema: SCHEMA })
)

phase('Synthesis')
const ok = results.filter(Boolean)                    // a failed child resolves to null
const blocked = ok.filter(r => r.status === 'BLOCKED')
return { audited: ok.length, dropped: results.length - ok.length, blocked, results: ok }
```

Notes on the skeleton: a stage that throws drops that **item** to `null` and skips its remaining stages, so `.filter(Boolean)` is mandatory; `parallel()` is a barrier and is only needed when a step genuinely requires every prior result together; the script has no filesystem, network or timer access — the agents do the work, the script coordinates.

## 8. Parallel-write serialization

1. At most one delegate writes to a given module at a time. Reads may overlap freely.
2. Partition fan-out by module, never by "files that look related".
3. When two modules must change together, that is one task for one delegate, not two coordinated ones.
4. Merge conflicts inside one module are a scoping failure, not a git problem: re-partition and re-dispatch.
5. Serialize the catalog: `.dsh/base/catalog.json` is a single-writer file, and editing its risk or attribute fields is a HIGH approval action.

## 9. Truncation and cache invalidation

1. Measurement tools report `truncated` when a tracked-file list, a match set or a finding set hit a cap. A truncated measurement is **not** a measurement of the whole tree.
2. On `truncated`, `impact` fans out conservatively to the full set and flags the result `degraded`. Over-testing is cheap; a missed regression is not. Degraded is exit 3 and is never a green result.
3. The same rule applies to an unmapped path, a path listed in `global`, or a non-git tree: conservative full fan-out.
4. Never "fix" a truncation by lowering the tracked-path bound or narrowing the scan to make output fit. That converts an honest degraded signal into a false green.
5. `arch-check` caches per file by size and mtime. A cached entry is invalidated by any content change; a branch switch or a checkout that rewrites mtimes invalidates broadly and the next run is slow — expected, not a fault.
6. Record the baseline with `arch-check --record` and gate regressions with `arch-trend --gate`: legacy debt is tolerated, new debt is not.

## 10. CI sharding by affected module

1. Compute the impact set once per pipeline run: `node .dsh/base/dsb.mjs impact`.
2. Shard by module, one shard per module or per group of modules sharing a runtime.
3. Skip shards with an empty impact set — but never skip when the impact result is `degraded`.
4. Run the static composite once for the whole repository: `node .dsh/base/dsb.mjs dod`. It is cheap and catches map-level defects.
5. Publish per-shard evidence to the ledger; a broken hash chain fails closed and all prior verification is treated as unproven.
6. Bind review to the diff: `receipt write` records the verdict against `diffHash`; one byte of change stales it (exit 4).

## 11. Performance budget — **targets, not measurements**

Every number below is a **target** for an adopting team to replace with its own measurements. None is a benchmark of this repository.

| Activity | Target | Notes |
|---|---|---|
| Cold orientation before the first edit | ≤ 6 tool calls | Root `AGENTS.md`, catalog, one `grep`, one scoped read |
| `impact` on a 3-file change | ≤ 5 s | Graph closure, no file reads |
| `arch-check`, warm cache | ≤ 60 s | Cold run is proportional to tracked files |
| `fitness --all` | ≤ 120 s | Use `--paths` in the inner loop |
| `gate` on a 3-module impact set | ≤ 10 min | Dominated by the project's own tests |
| CI shard wall clock | ≤ 15 min | Shard until this holds |
| Tasks requiring a full fan-out | ≤ 10 % | Higher means the module map is too coarse |

## 12. Anti-patterns

| Anti-pattern | Why it fails |
|---|---|
| "Read the whole module to be safe" | Unbounded cost, stale by the next commit, and it proves nothing a check would not |
| One module per directory | Describes the build system instead of the failure domains |
| Catalog left unmaintained | `impact` under-scopes with confidence; worse than no map |
| Raising the context-pack budget on the first omission | Hides a scoping error and ships a bloated brief |
| Two delegates writing the same module | Merge conflicts plus unverifiable authorship of the change |
| Narrowing a scan so the output fits | Evidence tampering by omission |
