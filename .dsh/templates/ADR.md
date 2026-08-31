# ADR-<NNNN>: <the decision, as a statement>

<!-- rule: file name is docs/adr/ADR-<NNNN>-<slug>.md, NNNN zero-padded, slug lowercase and
     hyphenated. Example: docs/adr/ADR-0007-refund-core-owns-idempotency.md -->
<!-- rule: one decision per ADR. Two decisions in one file cannot be superseded separately. -->
<!-- rule: an ADR is immutable once Accepted. Changing your mind means a NEW ADR whose
     Status supersedes this one, and this file's Status becomes
     "Superseded by ADR-<NNNN>". Never edit the Decision of a live ADR. -->

Status: <Proposed | Accepted | Superseded by ADR-NNNN | Deprecated | Rejected>
Date: <YYYY-MM-DD>
Deciders: <human names, not roles>
Enforced-by: <token>

<!-- rule: Enforced-by is MANDATORY on every live ADR - one whose Status is not Superseded,
     Deprecated or Rejected. `node .dsh/base/dsb.mjs adr-check` resolves each comma-separated
     token against, in order: a check id in catalog.checks; a fitness rule id
     (no-secret-literal, no-pii-in-logs, no-silent-failure, no-unbounded-retry,
     no-unreferenced-deferral, no-insecure-transport, no-unsafe-dynamic-exec, no-weak-crypto,
     no-unbounded-resource); an engine capability name (arch-check, arch-trend, catalog-lint,
     impact, gate, verify, fitness, attributes, receipt, waiver, budget, trace, agents-lint,
     skills-lint, spec-lint, adr-check, context-pack, layers, forbiddenDependencies); or the
     literal form `manual:<who, when>`. -->
<!-- rule: no line at all is NO_ENFORCEMENT (error). A token that resolves to nothing is
     PHANTOM_ENFORCEMENT (error), which is the worse failure: the document reads as enforced
     while enforcing nothing, so nobody looks again. An unrecognised extra token beside a
     good one is a warning. -->
<!-- rule: `manual:` is honest, not free. It records that no machine enforces this, names the
     person and the moment the check happens, and is counted in the adr-check output as
     manualOnly. If the count is climbing, the architecture is drifting by consent. -->
<!-- rule: EXAMPLE tokens for this repository - `Enforced-by: arch-check` ·
     `Enforced-by: fitness, no-unbounded-retry` · `Enforced-by: secrets` ·
     `Enforced-by: manual:release captain, at every tag` -->

## Context

<!-- rule: the forces, in the present tense, with numbers where numbers exist. What is true
     today that makes a decision necessary now. No solution language here. -->

EXAMPLE: Two modules write the refund table. Idempotency is implemented in the API handler,
so a second entry point (the batch importer, shipping next quarter) would bypass it. In the
last 90 days, 4 duplicate refunds reached settlement.

## Decision

<!-- rule: one paragraph, active voice, present tense: "We <verb> ...". State what becomes
     true, and what is now forbidden. The forbidden half is the part a check can enforce. -->

EXAMPLE: We move idempotency-key ownership into refund-core. No module other than
refund-core may write pg.refunds; refund-api calls the core through its port. The edge
refund-core -> refund-api is added to forbiddenDependencies.

## Consequences

<!-- rule: both directions, and at least one cost. An ADR with only benefits was not a
     decision, it was an announcement. -->

Positive: EXAMPLE every write path passes one interlock, provable by one test.
Negative: EXAMPLE the batch importer must be rewritten against the port (2 days).
Neutral: EXAMPLE refund-core gains a dependency on the clock, injected for tests.

## Alternatives rejected

<!-- rule: each alternative names why it lost, in terms of the forces in Context. "Not
     chosen" is not a reason. An ADR without rejected alternatives will be re-litigated. -->

| Alternative | Rejected because |
|---|---|
| EXAMPLE keep idempotency in the API handler and document the rule | documentation does not stop a second entry point; the failure repeats with the importer |
| EXAMPLE add a unique index only | protects the row, not the provider call; the duplicate money movement happens before the insert |

## Verification

```sh
node .dsh/base/dsb.mjs adr-check    # exit 1 on NO_ENFORCEMENT or PHANTOM_ENFORCEMENT
node .dsh/base/dsb.mjs arch-check   # the named edge is actually enforced
```
