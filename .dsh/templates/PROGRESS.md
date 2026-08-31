# progress.md

<!-- rule: copy to progress.md at the repository root. This file is project memory: what is
     pinned, what was decided and why, what remains, and what is proven. Context is not
     memory - a compaction summary is a claim, this file is where claims carry evidence. -->
<!-- rule: exactly these eight sections, in this order: Pinned, Decisions, TODO, In progress,
     Done, Risks and assumptions, Notes, Context index. -->
<!-- rule: confidence gate - hedged language ("maybe", "probably", "seems", "should be",
     "I think") never appears in Pinned, Decisions or Done. Demote it to Notes tagged
     Needs-Confirmation with the command that would settle it. -->
<!-- rule: recovery after a compaction or a new session is a four-source read: this file AND
     docs/requirements/PRODUCT-SPEC.md AND its changelog AND `node .dsh/base/dsb.mjs task
     status`. Reconcile disagreements in favour of the engine output, then correct here. -->
<!-- rule: two agents must not edit this file concurrently; a lost update erases memory. -->

## Pinned

<!-- rule: immutable within a phase. Changing a pinned line requires a human decision that is
     recorded under Decisions with its rejected alternative. -->

- Goal: <one sentence>
- Constraints: <decidable list>
- Sources: docs/requirements/PRODUCT-SPEC.md | docs/plan/DEV-PLAN.md | .dsh/base/catalog.json

## Decisions

<!-- rule: append-only. Every entry names the rejected alternative and why it lost; without
     one it is a preference, not a decision - move it to Done or Notes. A decision that
     constrains future code also gets an ADR under docs/adr/ with an Enforced-by: line. -->

- EXAMPLE 2026-02-11 | chose a bounded worker pool over an unbounded queue | an unbounded
  queue hides saturation until memory pressure, the pool refuses early and visibly | ADR-0009

## TODO

<!-- rule: monotone ids (#001, #002, ...) never reused, even after cancellation. Priority is
     P0 (blocks this phase), P1 (needed this phase) or P2 (deferred, with the condition that
     would raise it). -->

- EXAMPLE #014 P0 wire refund-interlock-test into refund-core verification (blocks phase 3)
- EXAMPLE #015 P2 replace the sweep-based key TTL (raise to P1 when the store gains TTL)

## In progress

<!-- rule: only what is actually being worked on right now. Each line names the TODO id, the
     owner (agent or human), and the current blocking question if there is one. -->

- EXAMPLE #014 | agent-3 | blocked on: which module owns the fixture data

## Done

<!-- rule: newest first. Every entry carries an evidence pointer: a command with its exit
     code, a ledger entry, a receipt diff hash, or an evidence log path. An entry that
     cannot be given one is not written - it stays In progress until it has one. -->

- EXAMPLE 2026-02-11 | #013 bound the provider client concurrency | evidence:
  `node .dsh/base/dsb.mjs gate` PASS exit 0, receipt 9f2c1a, evidence
  .dsh/base/evidence/unit-1770000000.log

## Risks and assumptions

<!-- rule: a risk carries impact, the observable trigger that would make it real, and the
     mitigation or the accepted-and-why. An assumption carries the check that would falsify
     it. An assumption with no falsifier is a belief. -->

- EXAMPLE RISK provider quota shared across tenants | trigger: 429 rate above 1/min |
  mitigation: per-tenant limiter, alert `provider-429`
- EXAMPLE ASSUMPTION the sandbox honours idempotency keys | falsified by:
  `npm test -- services/refund/contract`

## Notes

<!-- rule: where hedged statements live, tagged Needs-Confirmation with the command that
     would settle them. Also the place for context that is useful but not yet decided. -->

- EXAMPLE Needs-Confirmation: the search index may retain deleted subjects | settle with:
  `npm test -- privacy/erasure`

## Context index

<!-- rule: subject -> path. This is what a fresh agent reads before touching anything; keep
     it accurate or it costs more than it saves. -->

- spec: docs/requirements/PRODUCT-SPEC.md
- changelog: docs/requirements/PRODUCT-SPEC-CHANGELOG.md
- plan: docs/plan/DEV-PLAN.md
- architecture: docs/architecture/ARCHITECTURE.md
- catalog: .dsh/base/catalog.json
- key modules: <id -> path>
- key tests: <path>

<!-- rule: archive when Done passes 100 entries - move the oldest into progress.archive.md,
     keep the newest, and leave one line here pointing at the archive. Never delete history
     and never rewrite an archived entry; add a correcting entry instead. -->
