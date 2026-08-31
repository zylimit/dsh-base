---
name: threat-modeling
description: Use when a change touches a trust boundary, an authn/authz path, secret handling or the dependency set, or when a module declares security at high or critical.
whenToUse: Before shipping any change that crosses a trust boundary or alters authentication, authorization, secrets or dependencies.
---

## Purpose

Convert an informal security discussion into an auditable artifact. Produces `docs/security/THREAT-MODEL.md`: trust boundaries derived from the catalog layer graph, STRIDE findings for every boundary-crossing data flow, and exactly one recorded disposition per threat - a named mechanism, or a signed acceptance with an expiry.

## When this fires

- A module in `.dsh/base/catalog.json` declares `security` at `critical` or `high` and no current threat model covers it.
- A change adds or moves a listener, an inbound parser, a credential or key, an authorization decision, a cross-layer call, or a dependency source.
- `node .dsh/base/dsb.mjs attributes` reports a `security` gap (exit 1).
- `node .dsh/base/dsb.mjs fitness --all` reports `no-secret-literal`, `no-insecure-transport`, `no-unsafe-dynamic-exec` or `no-weak-crypto`.
- The user invokes `/threat-modeling`.

## Procedure

1. Bound the pass: `node .dsh/base/dsb.mjs impact`. Exit 3 means no catalog is configured - stop and say so; there is nothing to model against. The affected module ids are the scope.
2. Draw boundaries from the catalog, not from memory. `layers[]` is ordered outermost first. A trust boundary exists where (a) a flow crosses a layer edge, (b) a flow crosses a `dependsOn` edge into a module with a different `riskTier`, or (c) data enters or leaves the process (network, filesystem, IPC, queue, browser, third-party API). Number them B1..Bn and name the two modules each separates.
3. Enumerate the flows crossing each boundary. One row per flow: id, source module, sink module, data classes carried, channel, caller authentication, authorization decision point. A flow whose authentication you cannot name is already a finding.
4. Apply STRIDE per flow: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege. Each cell is either a threat or the literal `n/a` plus a one-line reason. A blank cell means unreviewed, not safe.
5. Assign `THR-<AREA>-<NNN>` (AREA is 2-6 uppercase letters). Ids are append-only: never renumber, never reuse; a dead threat gets `Status: retired` and keeps its id.
6. Rate each threat: Likelihood 1-5, Impact 1-5, Risk = L x I. Risk >= 12 must be closed by a mechanism; acceptance is not available at that level.
7. Give each threat exactly one disposition, never both and never neither:

   | Disposition | Required evidence |
   | --- | --- |
   | Mechanism: check | A check id present in `catalog.checks` whose `attributes` include `security` |
   | Mechanism: code control | `path:line` of the enforcing code plus the test id that proves it fires |
   | Mechanism: platform control | Control name, the system that owns it, and how an auditor reads its state |
   | Accepted risk | Named human owner, ISO expiry date, compensating detection, review date |

8. Write the abuse cases (minimum three). An abuse case describes a motivated attacker with a goal, a starting position and a budget: credential stuffing against the login path, a malicious dependency publishing a post-install script, an insider exporting a table. A confused user is a usability defect, not an abuse case.
9. Write the secrets rule set: no secret in source (`no-secret-literal`), no secret in logs, no secret in a context pack (`.dsh/base/lib/context.mjs` deny-lists `.env`, `*.pem`, `*.key`, `*secret*`, `*credential*`), injection at runtime from a managed store, rotation period per secret class, and the rotation owner. State the blast radius of each secret: what an attacker holding it can reach.
10. Write the authn/authz decision table: one row per protected operation with columns Operation, Caller identity source, Authentication mechanism, Authorization rule, Decision point (`path:line`), Deny default (yes/no), Audit event emitted. Deny default must be `yes` for every row.
11. Write the supply-chain section: dependency sources and their provenance, lockfile integrity (lockfile committed, CI installs frozen), vulnerability scanning cadence, SBOM generation and where the SBOM is stored, and the rule for adding a dependency (who approves, what is checked).
12. Wire each mechanism as a real check. Add to `catalog.checks`: `{ "command": ..., "class": "security", "attributes": ["security"], "timeoutMs": ... }`. Do not set `allowFastSkip: true` on a security check - protected attributes are never fast-skipped, so the flag only misleads a reader. Recommended wiring:

   | Tool | Decides | Suggested check id | attributes |
   | --- | --- | --- | --- |
   | semgrep | Code-level injection, authz and crypto misuse patterns | `sec-semgrep` | `["security"]` |
   | gitleaks | Committed credential material, history included | `sec-secrets` | `["security"]` |
   | osv-scanner | Known vulnerabilities in resolved dependencies | `sec-deps` | `["security"]` |
   | trivy | Container and OS package vulnerabilities, misconfiguration | `sec-image` | `["security"]` |
   | syft | SBOM generation, the input other scanners audit | `sec-sbom` | `["security", "maintainability"]` |

13. Verify the wiring: `node .dsh/base/dsb.mjs catalog-lint` (exit 1 = malformed catalog) then `node .dsh/base/dsb.mjs attributes` (exit 1 while any module at a blocking tier has no wired claiming check).
14. Make the model traceable. `node .dsh/base/dsb.mjs trace` resolves only `REQ-` and `NFR-` ids declared under `trace.requirementDirs`; a `THR-` id found in scanned code or tests is reported as dangling and the command exits 1. So: keep `THR-` ids inside `docs/security/` and add that directory to `trace.requirementDirs`, and pair every mitigated threat with an `NFR-SEC-<NNN>` (with a numeric target) that code and tests cite.
15. Record structural decisions as ADRs whose `Enforced-by:` line names a real check id, fitness rule id or engine capability; `node .dsh/base/dsb.mjs adr-check` exits 1 on a phantom reference.
16. Close the pass: `node .dsh/base/dsb.mjs gate` (exit 2 = blocking failure). A security check reported `BLOCKED` means the scanner never ran; that is a failure, not a pass.

## Output contract

`docs/security/THREAT-MODEL.md`, in this order:

```
# Threat model - <system>
Version: <n> | Date: <ISO> | Owner: <name> | Catalog commit: <sha>

## 1. Scope and assumptions
## 2. Trust boundaries        (B-id | separates | crossing channel | data classes)
## 3. Data flows              (F-id | source | sink | data | channel | authn | authz point)
## 4. STRIDE findings         (THR-id | F-id | category | description | L | I | risk | disposition)
## 5. Dispositions            (THR-id | mechanism-or-acceptance | check id / path:line / owner+expiry)
## 6. Abuse cases             (actor | goal | entry point | steps | detection | THR ids)
## 7. Secrets handling        (secret | store | injection | rotation period | owner | blast radius)
## 8. Authn/authz decisions   (operation | identity | authn | authz rule | decision point | deny default | audit event)
## 9. Supply chain            (source | provenance | lockfile policy | scan cadence | SBOM path | approver)
## 10. Mitigation-to-check map (THR-id | check id | attributes | last PASS evidence path)
## 11. Open risks             (THR-id | owner | expiry | compensation | review date)
```

Every row in section 10 must name a check id that exists in `catalog.checks` and claims `security`.

## Stop conditions

Halt and ask the human when:

- A threat has Risk >= 20 and no mechanism exists that you can implement inside the current task scope.
- An acceptance has no named individual owner or no expiry date. Do not sign it yourself; a subagent cannot own residual risk.
- `gitleaks` (or any scan) finds live credential material in history: stop all other work, report, and let the human drive rotation. Do not rewrite history unasked.
- A mitigation would require a waiver on a `security` check: the engine refuses it (protected attributes are never waivable and waiver text naming security is rejected), so the only paths are fix or documented acceptance by the owner.
- The catalog has no module owning the boundary you found; ownership must be assigned before the threat can be dispositioned.

## Anti-patterns

| Failure mode | Correction |
| --- | --- |
| STRIDE table with empty cells | Every cell is a threat or an explicit `n/a` with a reason; blank means unreviewed. |
| Mitigation named as "input validation" or "we use TLS" | Name the check id or the `path:line` that enforces it, plus the test that proves it fires. |
| Threat both mitigated and accepted, or dispositioned as "monitor it" | Exactly one disposition per threat; monitoring is a detection mechanism only if an alert with an owner exists. |
| Accepted risk with no expiry | Acceptances expire; without a date they become permanent silently. Set a date and a review owner. |
| Adding a scanner as a shell step in CI only | Register it in `catalog.checks` with `attributes: ["security"]` so `attributes` and `gate` can see it; an unregistered scanner does not count as coverage. |
| Treating `BLOCKED` as acceptable because the tool is not installed | A missing tool is BLOCKED, never PASS. Install it, or the attribute is uncovered. |
| Citing `THR-` ids in test names | `trace` cannot resolve THR ids and reports them dangling (exit 1). Cite the paired `NFR-SEC-<NNN>`. |
| Modelling the design you wish existed | Model the code as merged: read the routes, the clients and the config, and cite files. |
