# scripts — audit tools that run outside the engine

## Purpose

Checks that must not depend on the governance engine, so that a failure inside the
engine cannot hide them. Each is a standalone Node program with no dependencies,
prints one line of JSON on stdout, and exits non-zero on a finding.

| Script | Claims | Answers |
|---|---|---|
| `check-syntax.mjs` | `reliability` | does every tracked JavaScript file parse? |
| `scan-secrets.mjs` | `security`, `privacy` | is a secret, a credential-shaped literal, or a developer home path committed? |
| `manifest.mjs` | `security`, `maintainability` | did a distributed asset drift from its recorded hash? |

## Boundaries

1. **No imports from `.dsh/base/lib/`.** These scripts are the independent
   observers. If they imported the engine, an engine defect could silence them.
   Enforced by `arch-check`: `tooling` declares no dependency on the engine modules.
2. Node standard library only. No package manager is assumed to exist.
3. Read-only with one exception: `manifest.mjs --write` rewrites
   `FRAMEWORK-MANIFEST.json` and nothing else.
4. Never print a secret. Findings carry a file, a line and a rule id; excerpts are
   capped and must never be widened to include the matched value in full.

## Invariants

1. Not a git repository is exit 3, never exit 0. The file set is never guessed.
2. `scan-secrets.mjs` suppression is one comment, `scan-secrets:ignore`, on the
   finding line. There is no global disable and no wildcard suppression.
3. Adding a pattern to `scan-secrets.mjs` requires a test in `tests/` proving it
   fires, and a check that it does not fire on the `.example` form.
4. Exit 1 means a finding. Exit 2 is unused here; the composite gate owns tier 2.

## Verification

```sh
node .dsh/base/audit/check-syntax.mjs
node .dsh/base/audit/scan-secrets.mjs
node .dsh/base/audit/manifest.mjs --check
node --test "tests/*.test.mjs"
```

## Known debt

`scan-secrets.mjs` is a lexical scanner. It proves that no known credential shape
is present in tracked text; it does not prove that no secret exists. Wire a real
scanner from `.dsh/base/adapters.json` (`gitleaks`, `trufflehog`) as an additional
check claiming `security` before treating this as sufficient for a high-risk module.
