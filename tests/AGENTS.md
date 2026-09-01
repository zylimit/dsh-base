# tests — behavioural tests for the engine and the scripts

## Purpose

The independent proof that the engine behaves as the documents claim. `selftest`
covers pure functions inside the engine; this directory covers the observable
surface: process exit codes, stdout JSON shape, and end-to-end behaviour against
temporary fixture repositories.

## Boundaries

1. Tests use `node --test` and the Node standard library only. No test framework
   is installed, because the engine promises to run without a package manager.
2. A test never mutates the host repository. Fixtures are created under the OS
   temporary directory and removed afterwards.
3. Tests assert **exit codes and JSON fields**, not human-readable stderr text.
   Diagnostic wording is allowed to change; the contract is the exit code and the
   JSON.
4. A test that requires network access does not belong here.

## Invariants

1. Every requirement id in `docs/requirements/PRODUCT-SPEC.md` is named by at
   least one test in this directory. `node .dsh/base/dsb.mjs trace` enforces it and
   fails below the declared coverage minimum.
2. Every new engine capability arrives with at least one test here and at least one
   assertion in `.dsh/base/lib/selftest.mjs`.
3. A fix arrives with a test that failed before it. A test written after a green fix
   proves only that the code agrees with itself.
4. A flaky test is a defect. Quarantine requires an owner and an expiry date
   recorded in `progress.md`, never a silent retry.

## Verification

```sh
node .dsh/base/audit/run-tests.mjs
node .dsh/base/dsb.mjs trace
```
