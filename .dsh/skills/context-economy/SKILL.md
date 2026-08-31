---
name: context-economy
description: Use when context is the binding constraint - batching tool calls, trimming results, deciding what enters a message, or compacting a long session without losing established facts.
whenToUse: Any session that reads many files, delegates repeatedly, or approaches a compaction boundary.
---

## Purpose
Treat model attention as the scarce resource and spend it deliberately. Produces fewer, larger tool programs; short extracted results instead of pasted files; on-demand instructions instead of always-resident prose; and a compaction that loses no established fact.

## When this fires
- More than three tool round trips would answer one question.
- A tool result is large, or would be pasted into a message.
- A delegate needs context that already exists as an artifact.
- The session is near a compaction boundary or has just been compacted.
- Root instructions or a skill body are being edited.

## Procedure

### A. Batch with Code Mode
1. One `run_code` program can replace five round trips. Put every independent read, glob and grep for a question into a single program.
2. Overlap independent read-only calls with `Promise.all`; sequence only genuine dependencies with `await`.
3. Return the extracted answer, not the raw material: filter, count, slice, then `console.log` or `return` only that. Everything else stays out of the conversation by construction.
4. Wrap a call that may fail in `try/catch` (`ToolCallError`) so one failure does not discard the batch.

### B. Keep results small
1. Tool results are pruned above a size threshold: a huge result buys nothing and displaces earlier context. Extract in-program.
2. Never paste a large file into a message. A path plus a line range communicates the same thing at a fraction of the cost: `src/auth/session.ts:120-168`.
3. Write intermediate findings to a file and pass the path. Inventories, audit tables and scan output belong on disk, not in the transcript.
4. Read with `offset`/`limit`. Full reads are for files you will change.

### C. Keep the always-resident surface small
1. The `AGENTS.md` chain (`$DSH_HOME/AGENTS.md`, then project root down to cwd) and the skill catalog are resent on every request. Every line there is paid on every turn, forever.
2. Keep the root file a constitution: invariants, prohibitions, pointers. Push procedure into skills that load on demand. Enforce with `node .dsh/base/dsb.mjs agents-lint` against `agentsMd{requireForRiskTiers,maxBytes}`; exit 1 means the file is over budget or missing where required.
3. Nested `AGENTS.md` loads only when a first-party `read`/`write`/`edit` touches that directory. That is exactly why module contracts, local invariants and local commands belong in the module directory: they cost nothing until someone works there.
4. Skill descriptions are catalog-resident; bodies are not. Keep descriptions under 200 characters (the catalog truncates at 500) and put detail in the body or in `references/`. Verify with `node .dsh/base/dsb.mjs skills-lint`, exit 0 required.

### D. Delegate with packs, not with retyping
1. `node .dsh/base/dsb.mjs context-pack --focus <module-id>` - build the pack once, pass the path in the task envelope.
2. `node .dsh/base/dsb.mjs review-pack` - hand a reviewer the diff plus evidence pointers instead of a narrated summary.
3. A subagent starts with no history; a fork starts with all of it. Choose by what the child actually needs to read, not by convenience.

### E. Compact deliberately
1. Compact at a phase boundary - after a gate passes, before the next module - never mid-edit and never with an unverified claim outstanding.
2. Before compaction, flush state to artifacts: append to `progress.md`, run `node .dsh/base/dsb.mjs task status`, save the last `gate` output path.
3. After compaction, re-establish facts from artifacts (`progress.md`, task status, gate output, receipts), never from the summary text. A summary is a lossy retelling; treat it as a hint about where to look.
4. Re-run the cheapest check that proves the current state (`node .dsh/base/dsb.mjs gate`; exit 4 means the evidence is stale and must be regenerated).

### F. Expensive vs cheap habits
| Expensive | Cheap | Why |
|---|---|---|
| Five sequential single-tool calls | One `run_code` program batching them | One result block instead of five, no interleaved reasoning |
| `read` on a 3000-line file | `grep` then `read` with `offset`/`limit` | Pays only for the matched region |
| Pasting a config file into the message | `path:line-line` reference | Same information, no transcript cost |
| Restating module context per delegate | `context-pack --focus` path | Written once, read on demand |
| Procedure in root `AGENTS.md` | Procedure in a skill | Skill body loads only when routed to |
| Global invariants copied into each module file | Module contract in that module `AGENTS.md` | Loads only when that directory is touched |
| Narrating findings turn by turn | Findings file plus a pointer | Survives compaction |
| Re-deriving state after compaction from memory | Re-read artifacts and re-run one check | Facts, not recollection |

## Output contract
At every phase boundary write or update a checkpoint (default `progress.md`):
```
Phase      : <name> (<open|closed>)
Established: <fact> -> <artifact path or command + exit code>
Open       : <question> -> <who or what resolves it>
Artifacts  : <pack path>, <findings path>, <gate output path>
Next       : <single next action>
```
In messages, reference code as `<path>:<start>-<end>`. Reference evidence as command plus exit code. Never inline more than 20 lines of file content.

## Stop conditions
Halt and ask the human when:
- Compaction is imminent and an unverified change is outstanding: finish or record it first.
- Post-compaction artifacts contradict the summary and the conflict cannot be resolved by re-running a check.
- Root `AGENTS.md` must exceed `agentsMd.maxBytes` to state a genuine invariant: the owner decides between raising the limit and moving the text.
- A task cannot be scoped small enough to fit the remaining context even after delegation.

## Anti-patterns
| Failure mode | Correction |
|---|---|
| Issuing one tool call per turn to "stay careful". | Batch independent calls in one `run_code` program; care is in the extraction, not the pacing. |
| Returning a whole tool result so it is "on the record". | Return the extracted fields; write the rest to a file and cite the path. |
| Pasting a 400-line file to discuss two functions. | Cite `path:120-168` and quote at most the decisive lines. |
| Growing root `AGENTS.md` with each new lesson. | Graduate the lesson into a check or a skill; `agents-lint` guards the budget. |
| Putting module rules in the root file so they are "always known". | Put them in the module `AGENTS.md`; they load when that directory is touched. |
| Writing a 40 KB skill body for completeness. | Split detail into `references/` files that load on demand; the body is paid in full at load. |
| Compacting mid-task and resuming from the summary. | Compact at a phase boundary; resume from `progress.md`, task status and gate output. |
| Re-explaining the same module to each delegate. | Generate one context pack and pass its path. |
