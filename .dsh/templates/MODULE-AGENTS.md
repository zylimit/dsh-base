# <module id> - <one-line responsibility>

<!-- rule: copy to <module-directory>/AGENTS.md - the directory derived from the module's
     first `paths` entry in .dsh/base/catalog.json, with wildcards dropped. -->
<!-- rule: dsh loads this file automatically the first time an agent reads or writes inside
     this directory. Nobody has to remember to read it, which makes it the cheapest boundary
     contract available - and the only one that reliably reaches a zero-context subagent. -->
<!-- rule: once loaded it is paid for on every request in that session. Keep it small:
     `agentsMd.maxBytes` in the catalog is the hard warning (default 12000 bytes), but 1-3 KB
     is the working target. Procedure belongs in a skill; reference material belongs in
     docs/. This file carries only what a stranger must know before touching the code. -->
<!-- rule: `node .dsh/base/dsb.mjs agents-lint` requires these four headings, matched at the
     start of a line with 1-4 hashes: `## Purpose`, `## Boundaries`, `## Invariants`,
     `## Verification`. A missing heading is MODULE_AGENTS_INCOMPLETE (warning); a module at
     riskTier high or critical with no AGENTS.md at all is an error, exit 1. -->
<!-- rule: `## Common tasks` and `## Known debt` are optional and come last. -->

## Purpose

<!-- rule: one paragraph. The capability this module owns and why it exists as a separate
     module. Not a file listing - the reader can see the files. -->

EXAMPLE: Owns refund state and the idempotency interlock. It exists separately from
refund-api because the interlock must hold for every entry point, including the batch
importer, and a rule enforced in a request handler is not enforced.

## Boundaries

<!-- rule: four statements: what it owns, what it does not own, what it may import, what it
     must never import. The import rules mirror `dependsOn` and `forbiddenDependencies` in
     the catalog; arch-check enforces them, so a mismatch here is a documentation defect. -->

1. Owns: EXAMPLE the `pg.refunds` table and every write to it; the idempotency key format.
2. Does not own: EXAMPLE HTTP shape, authentication, provider retry policy (refund-api).
3. May import: EXAMPLE refund-ports, platform-clock.
4. Must never import: EXAMPLE refund-api, reporting-ui. A domain module that imports its
   transport can be bypassed by the next transport.

## Invariants

<!-- rule: numbered, decidable statements that must hold after every change. Each one is
     falsifiable by a named test or check; an invariant nothing can falsify is a slogan. -->

1. EXAMPLE A refund is written only through `recordRefund()`; no other write path exists.
   Falsified by: `refund-interlock-test`.
2. EXAMPLE Every provider call is preceded by an accepted idempotency key.
   Falsified by: `refund-interlock-test` case `provider-call-without-key`.
3. EXAMPLE Failure is refusal: on an unknown clock, a partial write or a restart mid-call,
   the module refuses to serve and raises, rather than issuing a second call.

## Verification

<!-- rule: the exact commands that prove this module still works, plus the check ids from
     catalog.json `verification[]` for this module. A command a reader cannot paste is not
     verification. -->

```sh
npm test -- services/refund/core     # EXAMPLE unit and interlock tests
node .dsh/base/dsb.mjs gate          # EXAMPLE impact-scoped checks: unit, refund-interlock-test
```

## Common tasks

<!-- rule: optional. Two to five entries, each a real recurring intent with the command or
     file that starts it. Delete the section rather than filling it with guesses. -->

| Intent | Start here |
|---|---|
| EXAMPLE add a refund state | `services/refund/core/state.ts`, then extend `refund-interlock-test` |

## Known debt

<!-- rule: optional but valuable: it stops an agent from "fixing" a known compromise, and
     from treating a partial control as complete. Name the condition that repays it. -->

EXAMPLE: the idempotency key TTL is enforced by a background sweep, not by the store. A
crash during the sweep window leaves an expired key readable for up to 60 s. Repaid when the
store gains native TTL support; tracked in ADR-0007.
