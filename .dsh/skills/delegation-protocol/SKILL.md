---
name: delegation-protocol
description: Use when deciding whether to do work yourself or hand it to subagent, subagent_fork, workflow, ralph or goal tools, and when writing the dispatch brief or judging a result.
whenToUse: Before any handoff of work to another agent, and when a delegate returns a result.
---

## Purpose
Choose the correct dsh delegation mechanism, dispatch it with a complete brief, and judge the returned result against evidence rather than assertion. Produces one task envelope per delegate, one result envelope per return, and a delegation ledger line for the session record.

## When this fires
- A task exceeds what fits comfortably in this context, or splits into independent pieces.
- The same mechanical operation must be applied across many files (audit, migration, inventory).
- Work is research-shaped: gather evidence, return findings, no judgement call.
- A human explicitly asks for a Ralph loop or fresh-agent iteration.
- A single long-running objective must survive multiple autonomous rounds in this session.

## Procedure

### 1. Select the mechanism
| Mechanism | Correct when | Starting context | Do not use when |
|---|---|---|---|
| Do it yourself | Under ~10 tool calls; needs judgement, taste, or an irreversible decision. | Full | The work is bulk evidence gathering. |
| `subagent` | Self-contained work that must not consume this context: research, a scoped implementation, an analysis. Background by default; continuable via `send_message`; durable id. | None - the prompt must be standalone | The task depends on nuance from this conversation that you cannot restate. |
| `subagent_fork` | The subtask builds directly on this conversation: a review of what was just decided, a continuation, a second opinion on the same material. | All completed turns of this conversation | The child only needs a narrow slice; a fork carries the whole history at cost. |
| `workflow` | Fan-out over many independent items with phases: repo-wide audit, mechanical migration, multi-angle research, adversarial verification. Hooks: `agent`, `pipeline`, `parallel`, `phase`, `log`, `args`. | Per-agent prompt only | One or two delegations - use plain `subagent` calls. |
| `ralph` | Only on explicit human request for a fresh-agent loop. Each round is a new child with no conversation seed; the workspace is the memory. | Workspace state only | Ordinary long-running work - use goal tools. |
| Goal tools | One long-running completion objective for this session that should survive autonomous rounds. `create_goal` / `get_goal` / `update_goal`. | This session | Routine single-turn work. |

### 2. Scope the handoff
1. `node .dsh/base/dsb.mjs impact` - name the modules and check ids the delegate owns. Exit 2 stops the dispatch.
2. `node .dsh/base/dsb.mjs context-pack --focus <module-id>` - produce the pack; put its path in the brief.
3. Partition writes by module. Two writers on one module must be serialised; three or more parallel writers on the same module is forbidden. Readers may overlap freely.

### 3. Dispatch with the six-field task envelope (verbatim)
```
Goal            : <single outcome, one sentence, testable>
Scope           : <exact paths / module ids the delegate may change>
Out of scope    : <paths, refactors and decisions explicitly forbidden>
Existing pattern: <file:line to imitate; context pack path from dsb context-pack>
Verification    : <exact commands to run, e.g. node .dsh/base/dsb.mjs gate; expected exit 0>
Escalation      : <what to do when blocked; who decides; return BLOCKED with the reason>
```
Start independent delegations in one message. Never poll a background job in a sleep loop - you are notified when it settles; read it with `job_output` (use `wait: true` only when genuinely blocked on it).

### 4. Require the six-field result envelope
```
Status        : DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
Changed       : <paths, one per line, with a one-line reason each>
Verified      : <command -> exit code -> what it proves>
Not verified  : <what was NOT checked and why - required, never "nothing">
Needs review by: <owner from catalog modules[].owners, or none>
Evidence      : <receipt id / log path / gate output path>
```

### 5. Judge the return
1. Reject any claim without an evidence pointer. "Tests pass" without a command and an exit code is an assertion, not a result.
2. Re-run one cheap check yourself when Status is DONE and the change touches a `critical`/`high` module or a protected attribute (`security`, `safety`, `privacy`).
3. `node .dsh/base/dsb.mjs receipt verify` - exit 4 means the evidence is stale; require regeneration, do not accept the narrative.
4. On `BLOCKED`, escalate strictly in this order: (a) supply the missing context or pack; (b) raise the model for that delegation; (c) split the task into smaller independent units; (d) report the limitation to the human with what was tried.

## Output contract
Per delegation, append one ledger line to the session record:
```
<mechanism> | <subagent id or run id> | <module ids> | <status> | <evidence pointer>
```
Worked `workflow` script skeleton for a repo-wide audit (`meta` is a tool parameter, not code in the script; the script body is plain JavaScript ending in `return`):
```js
phase("inventory");
const targets = args.modules;                 // module ids passed in via args
log(`auditing ${targets.length} modules`);

phase("audit");
const findings = await pipeline(
  targets,
  async (_prev, id) => agent(
    `Audit module ${id}. Read only its declared paths. Report fitness-rule violations by rule id.`,
    { label: `audit:${id}`, phase: "audit", schema: {
        type: "object",
        properties: {
          module: { type: "string" },
          violations: { type: "array", items: { type: "object",
            properties: { rule: { type: "string" }, path: { type: "string" }, line: { type: "number" } },
            required: ["rule", "path"], additionalProperties: false } }
        },
        required: ["module", "violations"], additionalProperties: false } }
  ),
  async (audit, id) => audit && audit.violations.length
    ? agent(`Verify these violations against the source before they are reported: ${JSON.stringify(audit)}`,
            { label: `verify:${id}`, phase: "verify" })
    : audit
);

phase("report");
return { audited: targets.length, results: findings.filter(Boolean) };
```

## Stop conditions
Halt and ask the human when:
- The task requires an irreversible or contested decision (schema change, dependency addition, public contract change). Delegate the evidence, not the decision.
- `impact` cannot scope the work to modules, so no delegate can be given a bounded Scope.
- Two independent delegates return contradictory evidence for the same claim.
- A delegate returns `BLOCKED` after all four escalation steps.
- The work needs a Ralph loop but no human has asked for one.
- Writes cannot be partitioned to at most two writers per module.

## Anti-patterns
| Failure mode | Correction |
|---|---|
| Sending "fix the auth bug" with no Scope or Verification. | Fill all six task-envelope fields; an envelope with a blank field is not dispatched. |
| Accepting "done, all tests pass" with no command or exit code. | Require the Verified field as command -> exit code -> claim; otherwise return it as NEEDS_MORE_EVIDENCE. |
| Sleeping in a loop to watch a background job. | Do independent work; the runtime notifies you on settle, then read `job_output`. |
| Three subagents writing to the same module in parallel. | Serialise writes per module; parallelise reads and analysis only. |
| Using `subagent_fork` for a task that needs none of this conversation. | Use `subagent` with a standalone prompt; a fork pays for history it will not use. |
| Hand-rolling twenty sequential `subagent` calls for one audit. | Use `workflow` with `pipeline` and phases. |
| Starting a `ralph` loop because the task looks iterative. | Ralph requires an explicit human request; otherwise use goal tools. |
| Delegating the judgement and keeping the typing. | Delegate evidence gathering and mechanical edits; retain acceptance, risk and design calls. |
