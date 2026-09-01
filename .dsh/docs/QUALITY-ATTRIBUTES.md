# Quality attributes

Eight attributes, six tiers, three coverage rules, and one command that decides whether a
declaration is real: `node .dsh/base/dsb.mjs attributes`. Declaring an attribute is a
commitment to wire a check that claims it. An unwired declaration is a visible gap, never a
pass.

Legend: **M** = machine-enforced (command and exit code named). **P** = prompt-only.

## 1. The eight attributes

**security** — information security. Confidentiality, integrity, authentication,
authorization, anti-tamper, supply-chain integrity. Its defining assumption is an
*adversary*: an actor who benefits from making the system behave outside its contract.
Threats are recorded as `THR-<AREA>-<NNN>` and analysed with the `threat-modeling` skill.

**safety** — functional safety. Freedom from unacceptable harm to people, environment,
equipment, money or reputation caused by what the system *does*, including when it is
working exactly as specified. No adversary is required: a duplicate payment, a robot
arm moving while a human is in range, and a mass email to the wrong list are all safety
events. Hazards are recorded as `HAZ-<AREA>-<NNN>` and
analysed with the `safety-analysis` skill. Security asks "who can attack this"; safety
asks "what harm can this cause when nobody attacks it".

**privacy** — lawful, minimal, purpose-bound, revocable handling of personal data:
collection, derivation, storage, logging, export, sharing and deletion. A system can be
fully secure and still violate privacy by collecting more than it needs, retaining it
longer than allowed, or logging an identifier in plaintext. Enforced in part by `fitness`
rule `no-pii-in-logs` (M, exit 1) and the `context-pack` deny list; analysed with the
`privacy-by-design` skill.

**resilience** — the ability to absorb faults, attacks, saturation and dependency failure
and to recover with bounded damage. It assumes failure *will* happen and asks what happens
next: timeouts, bounded retries with backoff and jitter, circuit breakers, bulkheads,
graceful degradation, recovery time and blast radius. Enforced in part by `fitness` rules
`no-unbounded-retry` and `no-unbounded-resource` (M, warning severity, applied only where
the module declares `resilience` at `high` or above).

**reliability** — correct, continuous operation over time under expected conditions. It
asks how rarely the system produces a wrong or missing result: defect rate, failure rate
between incidents, data correctness, idempotency, test strength. Enforced in part by
`fitness` rule `no-silent-failure` (M, error severity) and by `trace` coverage.
The distinction: **reliability is how seldom it breaks; resilience is how well it behaves
when it does.** A component with perfect retry logic and a wrong calculation is resilient
and unreliable; a correct component with no timeout is reliable and not resilient.

**availability** — the fraction of time the service is usable at its boundary, measured
against a stated window and SLI. It is a *consequence* of reliability, resilience, capacity
and maintenance policy, not an independent property; it is declared separately because it
is the number the user experiences and the one an SLO is written against
(`reliability-slo` skill).

**performance** — latency, throughput and resource consumption at a defined load. Every
performance claim needs a number, a unit and a load context; `spec-lint` rejects an `NFR-`
without a measurable target (`NO_METRIC`, M, exit 1).

**maintainability** — the cost of changing the system: comprehensibility, modularity,
boundary discipline, test strength, dependency hygiene, drift resistance. Measured here by
`arch-check` drift metrics and the `arch-trend` ratchet rather than by opinion.

Per-attribute playbooks — definition, design obligations, evidence — live in
[nfr/SECURITY.md](nfr/SECURITY.md), [nfr/SAFETY.md](nfr/SAFETY.md),
[nfr/PRIVACY.md](nfr/PRIVACY.md), [nfr/RESILIENCE.md](nfr/RESILIENCE.md) and
[nfr/RELIABILITY.md](nfr/RELIABILITY.md).

## 2. The six tiers

| Tier | Declaration means | Engine behaviour | Enforcement |
|---|---|---|---|
| `critical` | Failure here is unacceptable; the attribute is a release condition | Blocks: the gate does not pass unless a check claiming the attribute ran and passed for the affected module | M — `gate` returns `BLOCKED_BY_ATTRIBUTES`, exit 2; `attributes` exit 1; `risk` `UNWIRED_ATTRIBUTE` exit 1 |
| `high` | The attribute is load-bearing for this module | Identical blocking semantics to `critical` | M — same commands and exit codes |
| `medium` | Relevant; degradation is tolerated but must be seen | Recorded in `attributes` rows with `blocking: false`; does not stop the gate | P — the reviewer names the covering check, or records why none exists |
| `low` | Acknowledged, not actively governed | Recorded only | P |
| `minimal` | Deliberately out of scope, with a reason | Requires an `attributeReasons` entry | M — `catalog-lint` `UNJUSTIFIED_TIER`, exit 1 |
| `none` | Not applicable to this module, with a reason | Requires an `attributeReasons` entry | M — `catalog-lint` `UNJUSTIFIED_TIER`, exit 1 |

Blocking tiers are exactly `critical` and `high`. Opting out is a recorded decision, never
a free default: the two lowest tiers cost a written sentence.

## 3. The three coverage rules

1. **Counter-evidence outranks confirming evidence.** For each declared attribute the
   engine collects every check that claims it, then requires at least one `PASS` **and zero**
   `FAIL` or `BLOCKED` among the claiming checks that actually executed. One contradicting
   check reopens the gap even when three others passed. Reason: a passing test proves one
   path; a failing test disproves the claim.
2. **Declared but unwired is a visible gap, not a pass.** If no check in the catalog claims
   the attribute, or claiming checks exist but none is in the module's verification plan,
   the gap is reported with `why` set to `no check in the catalog claims this attribute` or
   `no claiming check was in the executed plan`. Silence is not coverage.
3. **`SKIPPED` covers nothing.** A check skipped by `--fast`, by `--dry-run` or by a waiver
   is not counted as passing. A gate where every check is `SKIPPED` aggregates to `BLOCKED`,
   and an empty verification plan aggregates to `BLOCKED` — nothing ran, so nothing is proven.

Aggregation order for the gate as a whole: any `FAIL` wins, else any `BLOCKED` wins, else
`PASS`; a `PASS` with at least one blocking attribute gap becomes `BLOCKED_BY_ATTRIBUTES`.

## 4. Declaring and claiming

A **module declares** what matters. A **check claims** what it proves. The gate joins the
two through the module's verification plan.

```json
{
  "layers": ["ui", "service", "core"],
  "modules": [
    {
      "id": "billing-api",
      "paths": ["services/billing/**"],
      "layer": "service",
      "riskTier": "high",
      "dependsOn": ["billing-core"],
      "forbiddenDependencies": ["reporting-ui"],
      "verification": ["billing-unit", "billing-contract"],
      "attributes": {
        "security": "critical",
        "privacy": "high",
        "reliability": "high",
        "performance": "medium",
        "safety": "none"
      },
      "attributeReasons": {
        "safety": "No actuation, dispatch or irreversible physical effect; the module only records intent. Rationale and rejected alternatives in ADR-0007."
      }
    }
  ],
  "checks": {
    "billing-unit":     { "command": "npm run test:billing",          "class": "test",     "attributes": ["reliability"], "timeoutMs": 600000 },
    "billing-contract": { "command": "npm run test:contract:billing", "class": "test",     "attributes": ["reliability"] },
    "sast":             { "command": "semgrep --config p/ci --error", "class": "security", "attributes": ["security"] },
    "secret-scan":      { "command": "gitleaks detect --no-banner --redact", "class": "security", "attributes": ["security", "privacy"] }
  }
}
```

`catalog-lint` errors on this shape (all M, exit 1): `UNKNOWN_ATTRIBUTE`, `UNKNOWN_TIER`,
`UNJUSTIFIED_TIER` (a `minimal`/`none` tier with no reason), `DANGLING_CHECK`,
`CHECK_NO_COMMAND`, and `PROTECTED_FAST_SKIP` (a check claiming a protected attribute that
also sets `allowFastSkip`). A module with no `verification` list falls back to
`riskChecks[riskTier]`.

## 5. Protected attributes

`security`, `safety` and `privacy` are protected, together with any check whose `class` is
one of those three words:

1. A waiver can never downgrade them. `applyWaivers` skips protected checks entirely, and
   `validateWaiver` rejects any waiver whose `reason` or `scope` contains
   `security`, `safety`, `privacy`, `pii`, `secret`, `credential`, `destructive`, `deploy`,
   `production` or `push` (M, `waiver check` exit 1). There is no expressible waiver for
   them.
2. They are never fast-skipped: `gate --fast` ignores `allowFastSkip` on a protected check,
   and declaring both is a catalog error (M).
3. Their tiers live in `catalog.json` risk and attribute fields — editing those fields is a
   HIGH-tier action requiring human authorization (P, [OPERATING-MODEL.md](OPERATING-MODEL.md) section 4).

## 6. Worked example: every check green, gate blocked

Using the catalog above, a change under `services/billing/**` resolves to module
`billing-api`, whose verification plan is `billing-unit` and `billing-contract`. Both pass.
No check in the plan claims `security`, although `sast` and `secret-scan` do exist.

```json
{
  "command": "gate",
  "gate": "BLOCKED_BY_ATTRIBUTES",
  "reason": "1 blocking quality-attribute gap(s): green checks that prove nothing about a critical/high attribute do not close the gate",
  "modules": ["billing-api"],
  "results": [
    { "id": "billing-contract", "status": "PASS" },
    { "id": "billing-unit", "status": "PASS" }
  ],
  "attributeGaps": [
    {
      "module": "billing-api",
      "attribute": "security",
      "tier": "critical",
      "claiming": ["sast", "secret-scan"],
      "executed": [],
      "passing": [],
      "contradicting": [],
      "covered": false,
      "why": "no claiming check was in the executed plan"
    }
  ]
}
```

Exit code `2`. The tests passed; the gate refuses to convert that into "the security
posture is proven". Two legitimate fixes: add `sast` and `secret-scan` to
`modules[].verification` (or to `riskChecks.high`), or lower the declared tier and write
the `attributeReasons` sentence that justifies it. Both are decisions with an author.
Deleting the declaration to silence the message is the failure mode this design prevents.

Run `node .dsh/base/dsb.mjs attributes` **before** the gate: it performs the same join
statically over every module and exits `1` on the same gap, without spending the test time.
`risk` reports the subset where no check claims the attribute at all (`UNWIRED_ATTRIBUTE`).

## 7. Candidate external tools

A tool becomes evidence only when it is wired as a check that claims the attribute and is
reachable from the module's verification plan. A missing binary is `BLOCKED` with reason
`command-missing:<exe>`, never `PASS`.

| Attribute | Candidate tool | Honest limitation of a passing run |
|---|---|---|
| security | `semgrep` | Pattern matching, not proof; finds only what a rule encodes, and rule drift is invisible |
| security | `gitleaks` | Cannot tell a live secret from a revoked or fake one; entropy heuristics produce false positives |
| security | `osv-scanner` | Blind to vendored or patched code and to vulnerabilities with no advisory yet |
| security | `trivy` | Depends on feed freshness; most base-image findings are not fixable inside this repository |
| security / resilience | `checkov` | Checks the declared infrastructure, not the deployed state; post-apply drift is invisible |
| safety | (none in this list) | No off-the-shelf scanner decides functional safety; the claim comes from hazard tests carrying `HAZ-` ids, proven by `trace` |
| privacy | `presidio` | Recall depends on locale and entity coverage; cannot see personal data assembled at runtime |
| privacy | `gitleaks` | Detects identifier shapes, never the lawfulness of the processing |
| resilience | `schemathesis` | Only as good as the schema; a wrong-but-well-formed response passes |
| resilience | `k6` | Saturation only; proves nothing about fault injection, dependency loss or recovery time |
| reliability | `stryker` | Expensive; a mutation score is test strength, not correctness, and survivors need triage |
| reliability | `schemathesis` | Contract conformance is not business correctness |
| availability | `k6` | Environment- and dataset-bound; not a production capacity or failover proof |
| performance | `k6` | A local or CI run is not production; noisy neighbours and cold caches move the number |
| maintainability | `syft` | An SBOM proves composition only — not vulnerability, not license compliance |
| maintainability | `semgrep` | Cannot see architectural intent; `arch-check` owns module-edge truth |

See [PROTOCOLS.md](PROTOCOLS.md) for the exact check, waiver and gate record shapes, and
[ADOPTION.md](ADOPTION.md) for the order in which to declare attributes in a large
existing repository.
