# Threat model - <system name>

<!-- rule: copy to docs/security/THREAT-MODEL.md. Derive boundaries from
     .dsh/base/catalog.json (layers, dependsOn, riskTier), not from memory. -->
<!-- rule: every threat gets exactly one disposition - a named mechanism OR an accepted risk
     with an owner and an expiry. Never both, never neither. A threat with two dispositions
     is unowned; a threat with none is a decision nobody made. -->
<!-- rule: keep THR- ids inside docs/security/ and pair every mitigated threat with an
     `NFR-SEC-<NNN>` that code and tests cite. `trace` resolves only REQ-/NFR- ids declared
     under `trace.requirementDirs`; a THR- id found in code or tests is reported dangling. -->
<!-- rule: a mechanism is real only when it is wired as a check in catalog.checks with
     `attributes: ["security"]` and reachable from the module's verification list. A tool
     that is not wired is an intention. A check reported BLOCKED never ran. -->

Version: <n> | Date: <YYYY-MM-DD> | Owner: <name> | Catalog commit: <sha> | Modules: <ids>

## 1. Scope and assumptions

<!-- rule: what is inside the boundary, what is assumed trusted, and who the adversary is.
     An assumed-trusted component is a dependency of your security posture: name it. -->

EXAMPLE assumption: the service mesh authenticates peer identity; this model does not
re-verify it and inherits its compromise.

## 2. Trust boundaries

<!-- rule: a boundary exists where a flow crosses a layer edge, crosses into a different
     riskTier, or leaves the process (network, filesystem, IPC, queue, browser, third party).
     Number them B1..Bn and name the two sides. -->

| Boundary | Separates | Channel | Data classes crossing |
|---|---|---|---|
| B1 EXAMPLE | internet -> refund-api | HTTPS | payment intent, customer id |
| B2 EXAMPLE | refund-api -> provider | HTTPS, egress proxy | payment intent, provider token |

## 3. Data flows

| Flow | Boundary | Source | Sink | Data | Caller authn | Authorization decision point |
|---|---|---|---|---|---|---|
| F1 EXAMPLE | B1 | support-ui | refund-api | refund request | signed session cookie | services/refund/api/authz.ts:41 |

<!-- rule: a flow whose authentication you cannot name is already a finding. Write it as a
     threat rather than leaving the cell empty. -->

## 4. STRIDE per boundary

<!-- rule: one table per boundary. Every cell is a THR- id or the literal `n/a` with a
     one-line reason. A blank cell means unreviewed, not safe. -->

Boundary B1 (EXAMPLE)

| Category | Finding |
|---|---|
| Spoofing | THR-REFD-001 |
| Tampering | THR-REFD-002 |
| Repudiation | n/a - every write emits an append-only audit event with the actor id |
| Information disclosure | THR-REFD-003 |
| Denial of service | THR-REFD-004 |
| Elevation of privilege | n/a - one role; no privileged operation is reachable from B1 |

## 5. Threat register

<!-- rule: id `THR-<AREA>-<NNN>`, AREA 2-6 uppercase letters, append-only; a dead threat
     keeps its id and gains "Status: retired". Likelihood and impact are 1-5, risk = L x I.
     Risk >= 12 must be closed by a mechanism - acceptance is not available at that level. -->

| THR id | Flow | Threat | STRIDE | L | I | Risk | Mitigation mechanism OR accepted risk | NFR |
|---|---|---|---|---|---|---|---|---|
| THR-REFD-001 EXAMPLE | F1 | replayed session cookie issues a refund | Spoofing | 3 | 5 | 15 | mechanism: check `sec-semgrep` rule `require-authz-decorator` + rotation at services/refund/api/session.ts:88 | NFR-SEC-001 |
| THR-REFD-004 EXAMPLE | F1 | unbounded refund submissions exhaust the provider quota | Denial of service | 3 | 3 | 9 | accepted: owner s.novak, expiry 2026-09-30, compensating alert `refund-rps-p99`, review 2026-06-30 | NFR-SEC-003 |

## 6. Abuse cases

<!-- rule: minimum three. An abuse case names a motivated actor with a goal, a starting
     position and a budget. A confused user is a usability defect, not an abuse case. -->

| Actor | Goal | Entry point | Steps | Detection | THR ids |
|---|---|---|---|---|---|
| EXAMPLE credential-stuffing operator | issue refunds to a controlled account | B1 | replay leaked cookies, submit refunds under the per-tenant limit | rate anomaly per tenant | THR-REFD-001 |

## 7. Secrets handling

<!-- rule: no secret in source, logs, fixtures, commit messages or a context pack. Enforced
     by the `no-secret-literal` fitness rule and the context-pack deny list. Never read a
     secret file to "check" it; read the `.example` form. State blast radius per secret:
     what the holder can reach. -->

| Secret | Store | Injection | Rotation | Owner | Blast radius |
|---|---|---|---|---|---|
| EXAMPLE provider API credential | managed secret store | environment variable at start | 90 days | @payments | can issue refunds for every tenant |

## 8. Supply chain

| Question | Answer |
|---|---|
| Dependency sources | EXAMPLE public registry through an internal mirror, provenance recorded |
| Lockfile policy | EXAMPLE committed; CI installs frozen and fails on drift |
| Vulnerability scan | EXAMPLE check `sec-deps` (osv-scanner) on every gate |
| SBOM | EXAMPLE check `sec-sbom` (syft), stored with the release artifact |
| Adding a dependency | EXAMPLE HIGH tier: named human approval, license and provenance reviewed |

## 9. Mitigation-to-check map

<!-- rule: every row names a check id that exists in catalog.checks and claims `security`.
     A row whose check is missing, SKIPPED or BLOCKED is an open threat, not a closed one. -->

| THR id | Check id | Attributes | Last PASS evidence |
|---|---|---|---|
| THR-REFD-001 EXAMPLE | sec-semgrep | security | .dsh/base/evidence/sec-semgrep-<epoch>.log |

## Verification

```sh
node .dsh/base/dsb.mjs catalog-lint  # the wiring is well formed
node .dsh/base/dsb.mjs attributes    # no module at a blocking security tier is unwired
node .dsh/base/dsb.mjs fitness --all # no-secret-literal, no-insecure-transport, no-weak-crypto
node .dsh/base/dsb.mjs gate          # exit 2 is a blocking failure; BLOCKED means it never ran
```
