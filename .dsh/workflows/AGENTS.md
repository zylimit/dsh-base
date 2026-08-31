# .dsh/workflows — reference fan-out scripts

## Purpose

Plain JavaScript bodies for the harness `workflow` tool: orchestration that spreads
one question across many subagents. They live here as readable, reviewable files
and are copied into the tool's `script` parameter when run.

## Boundaries

1. A workflow script coordinates; it never does the work. The only hooks available
   inside it are `agent()`, `pipeline()`, `parallel()`, `phase()`, `log()` and
   `args`.
2. There is **no filesystem, network, timer or Node API** inside a workflow script.
   Anything that must touch the repository is done by a spawned agent.
3. The script body ends with `return <json-serialisable value>`. That value is the
   tool result.
4. `agent()` resolves `null` when a child fails. Always `.filter(Boolean)` before
   aggregating, and report how many children were lost.
5. Prefer `pipeline()` over `parallel()`: `parallel()` is a barrier and makes the
   slowest child set the pace for every stage that follows.

## Invariants

1. A workflow that writes to the repository serialises its writers: at most one
   agent writes a given module.
2. Every structured result uses an object-rooted JSON Schema restricted to
   `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`,
   `const` and `oneOf`. Other keywords are rejected loudly.
3. A workflow is a read-and-report instrument by default. Turning one into a
   migration that edits files is a MEDIUM-tier act and needs an explicit scope list.
4. Findings without a file path and line number are not findings.

## Verification

```sh
node scripts/check-syntax.mjs    # every script here must parse
```

Behaviour is verified by running the workflow against a known-answer subset and
comparing the report with a manual inspection of that subset. Prompt-only.
