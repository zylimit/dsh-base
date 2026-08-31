# .dsh/base/lib — governance engine internals

## Purpose

The five libraries that make up the `dsb` engine. They turn a repository into
machine-checkable facts: what a path belongs to, what a change affects, what a
check proved, and whether a claim still binds the current diff.

| File | Module id | Layer | Owns |
|---|---|---|---|
| `core.mjs` | `engine-core` | platform | repo discovery, atomic IO, hashing, glob, catalog loading, path classification, git access |
| `graph.mjs` | `engine-graph` | capability | catalog lint, impact closure, import-edge extraction, architecture check, drift ratchet |
| `quality.mjs` | `engine-quality` | capability | four-state checks, attribute coverage, hash-chained ledger, waivers, receipts, change budget, task envelope |
| `scan.mjs` | `engine-scan` | capability | fitness rules, ADR audit, spec lint, skill lint, module-contract lint, traceability |
| `context.mjs` | `engine-context` | capability | budgeted context packing with the secret deny list, doctor, retention, decay scan, attribute wiring audit |
| `selftest.mjs` | `engine-selftest` | app | the engine's own regression assertions |

## Boundaries

1. Dependency direction is one way: `app -> capability -> platform`. `core.mjs`
   imports nothing from this directory. A capability module may import `core`
   and (for `quality` and `context`) the capability modules already declared in
   `.dsh/base/catalog.json`. Enforced by `arch-check` through `layers` and
   `forbiddenDependencies`.
2. **Zero runtime dependencies.** Node standard library only. This engine must run
   in a bare checkout on a machine with no package manager, because that is exactly
   the situation in which governance is most likely to be skipped.
3. Nothing here writes outside `.dsh/base/{state,evidence,receipts,waivers,trend}`,
   and nothing here reads a path the `context-pack` deny list forbids.
4. No network access. No telemetry. No prompts. The engine is a pure function of the
   working tree plus git.
5. stdout is exactly one line of JSON. Human text goes to stderr. A caller must be
   able to pipe stdout into a parser without stripping anything.

## Invariants

1. **A missing tool is `BLOCKED`, never `PASS`.** So is an undefined command, an
   empty plan, and an all-skipped run. Nothing ran, so nothing is proven.
2. **Degraded is exit 3, never exit 0.** Not-a-git-repo and no-catalog are reported,
   never silently treated as clean.
3. **Conservative expansion.** An unmapped path, a global path, a truncated tracked
   list or a non-git tree fans impact out to every module and sets `degraded: true`.
4. **Protected attributes cannot be bypassed.** `security`, `safety` and `privacy`
   are never waived, never fast-skipped, and the waiver validator refuses to express
   them.
5. **Evidence binds to a diff.** Any change to `canonicalDiff()` or `sha256Lf()`
   invalidates every stored receipt. Treat both as a versioned wire format: change
   them only with an ADR and a migration note.
6. **The ledger is append-only and hash-chained.** Never rewrite a line. A broken
   chain fails closed.
7. Line endings never affect identity: hash through `sha256Lf`.

## Verification

```sh
node .dsh/base/dsb.mjs selftest      # 56+ assertions over pure functions, must exit 0
node scripts/check-syntax.mjs        # every tracked .mjs parses
node --test "tests/*.test.mjs"       # behavioural tests over the engine surface
node .dsh/base/dsb.mjs arch-check    # layer direction and forbidden edges hold
node .dsh/base/dsb.mjs fitness --all # anti-pattern scan over the engine itself
```

Adding a capability means adding assertions to `selftest.mjs` in the same change.
An engine capability with no assertion is not a capability, it is a claim.

## Known debt

- `resolveSpecifier` attributes package-name imports through `provides` prefixes and
  a path-shaped fallback. Unresolvable specifiers are counted and sampled in the
  `arch-check` output rather than silently dropped; read `unresolved` before
  trusting a clean edge report in a polyglot repository.
- The glob compiler supports `**`, `*`, `?`, `{a,b}` and `[...]`. It does not
  support extglob or negation. Express exclusions with `ignored` entries instead.
