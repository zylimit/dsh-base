# Protocols

The exact machine contracts of the deepseek-base engine: what `dsb` accepts on stdin, what
it writes to disk, how evidence is bound to a diff, and what every exit code means.
Everything here is machine-enforced unless marked prompt-only (**P**).

Engine entry point: `node .dsh/base/dsb.mjs <subcommand>`. stdout is exactly one line of
JSON; stderr carries human diagnostics. Parse stdout, read the exit code, ignore neither.

## 1. Task envelope — `task start`

Piped to stdin as JSON. Six fields plus an id.

```json
{
  "id": "REQ-BILL-014-retry-budget",
  "goal": "Bound the billing retry loop so a downstream outage cannot amplify load.",
  "scope": "services/billing/retry/**, services/billing/http/client.ts",
  "outOfScope": "billing-core schema, reporting-ui, any dependency addition",
  "existingPattern": "services/billing/http/client.ts:88 (bounded backoff already used there)",
  "verification": "node .dsh/base/dsb.mjs gate  -> expect exit 0 and gate PASS",
  "escalation": "If the fix requires a new dependency or a schema change, stop and return BLOCKED."
}
```

| Field | Required by the engine | Notes |
|---|---|---|
| `id` | yes | Sanitised to `[A-Za-z0-9._-]` and truncated to 120 chars |
| `goal` `scope` `outOfScope` `verification` `escalation` | yes | Non-empty strings; a missing one aborts with exit `3` and names what is missing |
| `existingPattern` | no (engine) / yes (**P**) | [../AGENTS.md](../AGENTS.md) section 3 requires it; the engine stores it but does not validate it |

The engine adds `state: "active"`, `baseCommit` (HEAD at start) and `startedAt`, then writes
`.dsh/base/state/task.json`. There is one active task per worktree: a second `task start`
replaces the file. `task status` returns the record plus the current `diffHash`.
`task complete` returns exit `2` with a `blockers` array unless all four hold: a `PASS` gate
record bound to the current `diffHash`, a fresh `ACCEPT` receipt, an intact ledger chain, and
a non-empty verification plan.

## 2. Result envelope (P)

Text, not JSON. No command parses it; it is the contract between a delegate and the agent
that dispatched it.

```
Status         : DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
Changed        : <path> - <one-line reason>   (one per line)
Verified       : <command> -> exit <code> -> <what it proves>
Not verified   : <what was not checked and why>   (never "nothing")
Needs review by: <owner from catalog modules[].owners, or none>
Evidence       : <receipt id / ledger entry / evidence log path>
```

Only the Evidence pointer is machine-checkable (`receipt verify`, `ledger`, and the
`evidence` + `evidenceSha256` fields of the gate record). A `Verified` line without a
command and an exit code is an assertion and is rejected.

## 3. Review receipt — `receipt write`

Piped to stdin as JSON. Caller supplies four required fields; the engine computes the rest.

| Field | Source | Rule |
|---|---|---|
| `taskId` | caller (required) | Sanitised; becomes the file name |
| `reviewer` | caller (required) | Agent id or human name |
| `verdict` | caller (required) | Exactly `ACCEPT`, `FIX_REQUIRED` or `NEEDS_MORE_EVIDENCE`; anything else aborts with exit `3` |
| `scope` | caller (required) | What was actually reviewed |
| `notes` | caller (optional) | Defaults to `""` |
| `baseCommit` | engine | HEAD at write time |
| `diffHash` | engine | Canonical diff fingerprint at write time |
| `createdAt` | engine | ISO timestamp |
| `contentHash` | engine | `sha256` of the LF-normalised JSON of every other field |
| `version` | engine | `1` |

Written to `.dsh/base/receipts/<taskId>.json` and appended to the ledger as a
`kind: "receipt"` entry.

**Staleness rule.** `diffHash` is the SHA-256 of the canonical diff against HEAD plus a
content hash of every untracked file, engine runtime state excluded. `receipt verify`
passes only when some receipt has the current `diffHash` and `verdict: "ACCEPT"`, and no
receipt fails its own `contentHash`. One byte of change stales every receipt (exit `4`);
one hand-edited receipt fails the whole verification.

## 4. Waiver — `waiver create`

Piped to stdin as JSON. A waiver downgrades `FAIL` or `BLOCKED` to `SKIPPED` for exactly one
check id.

```json
{
  "owner": "team-payments",
  "reason": "Flaky contract fixture regenerates on every run; tracked as ISSUE-4412.",
  "scope": "billing-contract",
  "expiry": "2026-03-31T00:00:00Z",
  "compensation": "billing-unit covers the same code path; manual smoke test before release."
}
```

| Field | Source | Rule |
|---|---|---|
| `owner` `reason` `scope` `compensation` | caller | Non-empty strings; `scope` must equal a check id or the waiver never applies |
| `expiry` | caller | Must parse as a future timestamp; an expired waiver is inert and is reported by `risk` as `EXPIRED_WAIVER` (exit 1) |
| `version` `created_at` `contentHash` | engine | `version` is forced to `1`; `contentHash` is `sha256` over the LF-normalised JSON with keys sorted |

**Forbidden-word rule.** `reason` and `scope` are matched, case-insensitively, against
`safety`, `security`, `privacy`, `pii`, `secret`, `credential`, `destructive`, `deploy`,
`production`, `push`. A hit rejects the waiver (`waiver create` exit `1`, `waiver check`
exit `1`). Independently, `applyWaivers` never downgrades a check whose `class` or claimed
`attributes` include `security`, `safety` or `privacy`. There is no way to express a
protected waiver.

A waived check becomes `SKIPPED`, which covers no attribute: waiving the only claiming
check for a blocking attribute turns `FAIL` into `BLOCKED_BY_ATTRIBUTES`, not into a pass.
Waivers are git-ignored (section 8), so CI sees the undowngraded result.

## 5. Ledger

Append-only `.dsh/base/state/ledger.jsonl`. One JSON object per line. Every gate run and
every receipt is appended.

```
contentHash = sha256(LF(JSON.stringify(record)))
chain       = sha256(prev + "\0" + contentHash)
prev        = chain of the previous line, or 64 zeros for the first entry
line        = { ...record, contentHash, prev, chain }
```

`dsb ledger` recomputes the whole chain and reports each break as
`unparseable-line`, `content-hash-mismatch`, `chain-predecessor-mismatch` or
`chain-hash-mismatch` (exit `1`).

**Fail-closed consequence.** A broken chain means every prior verification is treated as
unproven: `task complete` blocks, `dod` fails on its `ledger` step, `risk` reports
`LEDGER_BROKEN`, and the only honest recovery is to re-run the gates that mattered. Do not
repair the file by hand; the chain is the evidence.

## 6. Gate result record

Written to the ledger and printed on stdout by `dsb gate` (the `detail` field with full
check output is omitted from stdout).

```json
{
  "command": "gate",
  "at": "<iso>",
  "gate": "PASS | FAIL | BLOCKED | BLOCKED_BY_ATTRIBUTES",
  "reason": "all-executed-checks-passed | at-least-one-check-failed | at-least-one-check-blocked | every-check-skipped | empty-plan: ... | <n> blocking quality-attribute gap(s): ...",
  "baseCommit": "<sha or null>",
  "diffHash": "<sha256 or null>",
  "planHash": "<sha256 of the resolved check-id/module plan>",
  "modules": ["billing-api"],
  "degraded": false,
  "results": [
    { "id": "billing-unit", "status": "PASS", "reason": null, "durationMs": 4210,
      "evidence": ".dsh/base/evidence/billing-unit-<epoch>.log", "evidenceSha256": "<sha256>" }
  ],
  "attributeCoverage": [ { "module": "billing-api", "attribute": "security", "tier": "critical",
      "claiming": ["sast"], "executed": [], "passing": [], "contradicting": [], "covered": false } ],
  "attributeGaps": [ { "module": "billing-api", "attribute": "security", "tier": "critical",
      "why": "no claiming check was in the executed plan" } ],
  "waivers": [ { "check": "billing-contract", "waiver": ".dsh/base/waivers/billing-contract.json", "expiry": "<iso>" } ]
}
```

Statuses are exactly `PASS`, `FAIL`, `BLOCKED`, `SKIPPED`. `BLOCKED` reasons:
`check-undefined-or-empty-command`, `command-missing:<exe>`, `spawn-error:<code>`. A timeout
is `FAIL` (`timeout:<ms>ms`; default 900000 ms, per-check `timeoutMs`). `degraded: true`
means impact fanned out to every module: an unmapped or global changed path, a truncated
file list, or no git tree.

## 7. Exit codes

`0` clean · `1` violation · `2` blocking gate · `3` degraded · `4` stale. Per subcommand:

| Subcommand | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| `doctor` | always | — | — | — | — |
| `selftest` | all assertions pass | any assertion fails | — | — | — |
| `catalog-lint` | no errors | error findings | — | no/unparseable catalog | — |
| `impact` | computed | — | — | no catalog; not git and no `--paths` | — |
| `gate` / `verify` | `PASS` | — | `FAIL`, `BLOCKED`, `BLOCKED_BY_ATTRIBUTES` | no catalog; not git | — |
| `attributes` | no gaps | blocking gap | — | no catalog | — |
| `arch-check` | clean, or any run with `--record` | forbidden edge, layer violation or drift | — | no catalog; not git | — |
| `arch-trend` | ratchet holds, or report mode | regression past best-ever | — | no catalog | — |
| `fitness` | no error findings | error findings | — | no catalog | — |
| `adr-check` | every live ADR enforced | missing or phantom `Enforced-by` | — | no catalog | — |
| `spec-lint` | no error findings | error findings | — | no catalog; no requirement documents | — |
| `trace` | coverage >= `minCoverage`, no dangling ids | below coverage or dangling id | — | no catalog; spec degraded | — |
| `skills-lint` | no error findings | error findings | — | — | — |
| `agents-lint` | no error findings | missing root or high-risk `AGENTS.md` | — | no catalog | — |
| `budget` | within limits | over a limit | — | no catalog; not git | — |
| `context-pack` | pack written | — | — | no catalog | — |
| `receipt write` | receipt written | — | — | bad stdin JSON, missing field, bad verdict | — |
| `receipt verify` | fresh `ACCEPT` binds current diff | — | — | not a git repository | no fresh receipt |
| `waiver list` | always | — | — | — | — |
| `waiver check` | all valid | any invalid | — | — | — |
| `waiver create` | written | validation failed | — | bad stdin JSON | — |
| `task start` | started | — | — | bad JSON or incomplete envelope | — |
| `task status` | always | — | — | — | — |
| `task complete` | completed | — | blockers, or no active task | no catalog | — |
| `ledger` | chain intact | any break | — | — | — |
| `gate-audit` | always | — | — | no catalog | — |
| `risk` | no error-severity findings | error-severity finding | — | — | — |
| `retention` | always | — | — | — | — |
| `diff-hash` | computed | — | — | not a git repository | — |
| `review-pack` | pack written | — | — | not a git repository | — |
| `dod` | every blocking step `PASS` | — | any blocking step `FAIL` or `DEGRADED` | no catalog | — |
| `help` / unknown subcommand | `help` | — | — | unknown subcommand | — |

Reading rule: `3` is not a pass and `0` from `doctor` is not a health verdict — read its
`failing` array. See [OPERATING-MODEL.md](OPERATING-MODEL.md) section 3.

## 8. Runtime state — never committed

Git-ignored, machine-local, regenerable:

| Path | Contents |
|---|---|
| `.dsh/base/state/` | `task.json`, `ledger.jsonl`, `gate-log.jsonl`, `arch-cache.json`, `context/` packs, `review/` packs |
| `.dsh/base/evidence/` | Raw stdout+stderr of every executed check |
| `.dsh/base/receipts/` | Diff-bound review receipts |
| `.dsh/base/waivers/` | Structured waivers |
| `.dsh/base/trend/` | `arch-trend.jsonl` ratchet history |

These five paths are excluded from `diffHash` (so running the engine never stales its own
evidence) and from `context-pack` (so runtime state never reaches a delegate). Committed
instead: `.dsh/base/dsb.mjs`, `.dsh/base/lib/*`, `.dsh/base/catalog.json`, optional
`.dsh/base/fitness-rules.json`, and the git hooks directory.

Plan for the consequence: receipts, ledger and waivers are local. CI must run its own
`gate` and write its own receipt, and never sees a local waiver. `retention` prunes
evidence and packs by age and count but never deletes a file a ledger entry references.

See also [OPERATING-MODEL.md](OPERATING-MODEL.md) (when to invoke these contracts) and
[QUALITY-ATTRIBUTES.md](QUALITY-ATTRIBUTES.md) (`BLOCKED_BY_ATTRIBUTES`).
