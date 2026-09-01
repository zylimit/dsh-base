# Security

Attribute id `security`. Protected attribute: never waivable, never fast-skippable, never downgraded by a waiver.
Related: [RESILIENCE.md](./RESILIENCE.md) · [SAFETY.md](./SAFETY.md) · [PRIVACY.md](./PRIVACY.md) · [RELIABILITY.md](./RELIABILITY.md) · [../LARGE-REPO-GUIDE.md](../LARGE-REPO-GUIDE.md) · [../QUALITY-ATTRIBUTES.md](../QUALITY-ATTRIBUTES.md) · [../../AGENTS.md](../../AGENTS.md)

## 1. Definition

Security is the preservation of confidentiality, integrity and availability of information and of the systems processing it, against an adversary who is deliberate, adaptive and free to attack any exposed surface. It is defined against a **threat model**, not against a checklist.

Security is **not**:

| Not this | Because |
|---|---|
| Privacy | Privacy governs lawful, purposeful handling of personal data ([PRIVACY.md](./PRIVACY.md)). Encrypted, correctly authorised misuse of personal data is still a privacy violation. |
| Safety | Safety concerns harm to people, environment and equipment ([SAFETY.md](./SAFETY.md)). A secure system can still be unsafe. |
| Compliance | Passing an audit is evidence about documents, not about an adversary. |
| A tool run | A clean SAST report proves the rules that ran, not the absence of an attack path. |
| Obscurity | Undocumented endpoints, custom encodings and secret URLs are enumeration targets, not controls. |

## 2. Failure modes defended against

1. Broken authorization: object references usable across tenants, missing function-level checks, mediation only in the UI.
2. Broken authentication and session handling: fixed session ids, no rotation on privilege change, no absolute lifetime.
3. Injection into an interpreter: SQL, shell, LDAP, template, deserialisation, prompt-to-tool chains.
4. Secret exposure: credentials in source, in logs, in CI output, in context packs, in error messages.
5. Cryptographic failure: home-made schemes, MD5/SHA-1 where a guarantee is needed, ECB mode, predictable IVs, `Math.random` for tokens.
6. Transport failure: plaintext hops, disabled certificate verification, downgrade.
7. Supply-chain compromise: unpinned dependency, typosquat, malicious postinstall, unsigned artefact.
8. Server-side request forgery and unrestricted redirect.
9. Insecure defaults: debug endpoints, default credentials, permissive CORS, open buckets.
10. Audit failure: no trail, or a trail the attacker can edit.
11. Multi-tenant leakage through cache keys, connection reuse, shared search indices, log aggregation.

## 3. Threat contract

1. Every trust boundary gets a STRIDE pass. Boundaries are: untrusted client to edge, edge to service, service to service, service to data store, service to third party, operator to production, build system to artefact.
2. Every identified threat gets an id `THR-<AREA>-<NNN>`, append-only, never reused.
3. Each `THR` resolves to exactly one of: a named mechanism (with the check id that proves it), a transferred control (name the party and the contract), or a **signed, expiring accepted risk** naming the approver and the expiry date.
4. An unresolved `THR` in a module declaring `security: high` or `critical` blocks the gate through the attributes rule, because no passing check claims the gap.

| Boundary | S | T | R | I | D | E |
|---|---|---|---|---|---|---|
| Client → edge | Token forgery | Parameter tampering | Missing audit of write | Response over-disclosure | Volumetric flood | Privilege escalation via role claim |
| Service → service | Unauthenticated peer | Message replay | No caller identity in log | Verbose error leakage | Pool exhaustion | Confused deputy |
| Service → store | Shared DB user | Unvalidated write path | No change log | Bulk export | Expensive query | Grant creep |
| Build → artefact | Compromised runner | Dependency substitution | Unsigned artefact | Secret in build log | Cache poisoning | Pipeline write to prod |

## 4. Tactics

| Tactic | What it prevents | How to implement | How to verify | Cost |
|---|---|---|---|---|
| Deny by default | Accidental exposure of a new route | Central policy layer rejecting unless an explicit allow rule matches | Test: an unregistered route returns 403 with no handler invoked | medium |
| Complete mediation | Cached authorization decisions surviving revocation | Authorize per request at the resource, not once at login | Test: revoke mid-session, next request fails | medium |
| Least privilege | Blast radius of one stolen credential | Per-service DB roles, scoped tokens, no wildcard IAM | Review of grants; automated grant diff in CI | medium |
| Object-level authorization | Cross-tenant object access | Tenant id in every query predicate, enforced in the data layer | Test matrix: tenant A id requested by tenant B returns 404 | medium |
| Session hygiene | Session fixation and long-lived theft | Rotate on privilege change, idle and absolute lifetimes, secure cookie flags, server-side revocation | Test asserting rotation and expiry; cookie attribute assertion | low |
| Strong credential storage | Offline cracking after a dump | Memory-hard KDF (Argon2id or scrypt) with recorded parameters | Test asserting KDF id and cost parameters | low |
| Input validation at the boundary | Malformed input reaching interpreters | Schema validation, allow-lists, canonical decode once, typed rejection | Property test with fuzzed input; schema contract test | medium |
| Output encoding at the sink | XSS, template injection | Context-aware encoding at the render sink, not at input | Template test per sink context | medium |
| Parameterised queries | SQL injection | Prepared statements or a query builder; never string concatenation | `fitness` `no-unsafe-dynamic-exec`; SAST rule; test with quote payloads | low |
| No dynamic execution of input | RCE | Remove `eval`, `new Function`, `shell=True`; use argument-vector process spawn | `fitness` `no-unsafe-dynamic-exec` (error, exit 1) | low |
| Runtime secret injection | Credentials in the repository | Secret manager or environment injection, `.env.example` only in git | `fitness` `no-secret-literal` (error, exit 1); `context-pack` deny list | low |
| Secret rotation | Indefinite value of a leaked secret | Versioned secrets, dual-read during rotation, automated expiry | Rotation drill record; age report per secret | medium |
| Approved cryptography | Home-made or broken schemes | Platform library, AES-GCM or ChaCha20-Poly1305, RSA ≥ 3072 or ECDSA/Ed25519 P-256+, SHA-256+, CSPRNG | `fitness` `no-weak-crypto` (error, exit 1); crypto review | low |
| TLS everywhere, verification on | Interception and downgrade | TLS 1.2+ with modern ciphers, certificate verification always on, mTLS between services | `fitness` `no-insecure-transport` (error, exit 1); TLS scan | low |
| SSRF containment | Internal network pivot | Egress allow-list, block link-local and private ranges, no redirect following into new hosts | Test with metadata-endpoint payloads | medium |
| Supply-chain integrity | Malicious or vulnerable dependency | Committed lockfile, pinned digests, SBOM per build, signed artefacts, vulnerability scan gate | Scanner check in `catalog.json` claiming `security`; SBOM artefact attached to the release | medium |
| Tamper-evident audit log | Attacker editing their trail | Append-only sink, hash chain `chain = sha256(prev + NUL + contentHash)`, off-host replication | Chain verification job; the engine's own `ledger` is the local example | medium |
| Tenant isolation | Cross-tenant leakage | Tenant id in cache keys, per-tenant encryption keys where required, no shared mutable global state | Isolation test per shared component (cache, search, log) | high |
| Secure defaults | Insecure production from day one | Deny CORS by default, debug off, no default credentials, private storage | Configuration test asserting the default posture | low |

## 5. Hard rules

`M` = machine-enforced (named check), `P` = prompt-only.

1. **M** (`fitness` / `no-secret-literal`, error, exit 1) — no credential, token, private key or API key literal in tracked files, fixtures or commit messages.
2. **M** (`fitness` / `no-insecure-transport`, error) — TLS certificate verification is never disabled; no plaintext transport for authenticated or personal data.
3. **M** (`fitness` / `no-unsafe-dynamic-exec`, error) — no `eval`, `new Function`, `os.system`, `shell=True` or `Runtime.exec` on interpolated input.
4. **M** (`fitness` / `no-weak-crypto`, error) — no MD5, SHA-1, DES or RC4 where a cryptographic guarantee is required, and no `Math.random` for tokens, nonces, salts or session ids.
5. **M** (`attributes`, exit 2) — a module declaring `security: high|critical` passes at least one check claiming `security`; a claiming check that FAILs or is BLOCKED reopens the gap.
6. **M** (`catalog-lint`, exit 1) — `security: minimal|none` requires an `attributeReasons.security` entry.
7. **P** — every request is authorized at the resource, on every request, including internal service-to-service calls.
8. **P** — every query touching tenant data carries the tenant predicate in the data layer, not in the caller.
9. **P** — every new externally reachable route is registered in the policy layer before merge; the default is deny.
10. **P** — every `THR-<AREA>-<NNN>` resolves to a mechanism, a transferred control, or a signed accepted risk with an expiry date.
11. **P** — passwords use a memory-hard KDF with recorded parameters; no unsalted hash, no reversible storage.
12. **P** — dependencies are pinned by lockfile; a new or upgraded dependency is a HIGH approval action (see [../../AGENTS.md](../../AGENTS.md) §2).
13. **P** — security-relevant events (authn, authz denial, privilege change, secret access, export) are logged with actor, subject, action, result and correlation id, and never with the secret or personal datum itself (see `no-pii-in-logs` in [PRIVACY.md](./PRIVACY.md)).
14. **P** — error responses to untrusted callers carry a typed code and no stack trace, SQL fragment or internal hostname.
15. **P** — no security waiver exists: the engine refuses to express one. A gap is fixed or the release does not ship.

## 6. Measurable targets

Metrics that must appear in an `NFR-SECURITY-<NNN>`. Placeholders, not measurements.

| Metric | Unit | Placeholder |
|---|---|---|
| Time to patch a critical dependency vulnerability | hours from advisory | ≤ 72 |
| Critical/high vulnerabilities in a released artefact | count | 0 |
| Secret maximum age | days | ≤ 90 |
| Secret rotation execution time | minutes | ≤ 30 |
| Session idle / absolute lifetime | minutes | 30 / 720 |
| KDF cost | Argon2id m, t, p | 64 MiB, 3, 1 |
| Minimum key strength | bits | AES-256, RSA ≥ 3072, ECC ≥ 256 |
| Minimum TLS version | version | 1.2 |
| Authorization test coverage of protected routes | percent | 100 |
| Cross-tenant isolation tests per shared component | count | ≥ 1 |
| Audit-trail chain verification | runs per day | ≥ 1 |
| Mean time to detect a security event | minutes | ≤ 15 |

EARS form example: *When a dependency advisory of severity critical is published for a pinned dependency, the release pipeline SHALL fail the `dep-scan` check until the dependency is upgraded or a signed accepted risk with an expiry date exists.*

## 7. How it is gated here

| Mechanism | Command | Effect |
|---|---|---|
| Anti-pattern scan | `node .dsh/base/dsb.mjs fitness --all` | `no-secret-literal`, `no-insecure-transport`, `no-unsafe-dynamic-exec`, `no-weak-crypto` are **error** severity: any finding sets exit 1 |
| Tier gate | `node .dsh/base/dsb.mjs attributes` | Blocking gap returns `BLOCKED_BY_ATTRIBUTES` |
| Proof | `node .dsh/base/dsb.mjs gate` | Exit 2 blocking, 3 degraded, 4 stale evidence |
| Waivers | `node .dsh/base/dsb.mjs waiver create` | Rejects `security`: there is no expressible security waiver |
| Evidence chain | `node .dsh/base/dsb.mjs ledger` | A broken hash chain fails closed; all prior verification is unproven |
| Decision enforcement | `node .dsh/base/dsb.mjs adr-check` | A security ADR must name a real check id, fitness rule id, engine capability or `manual:<who>` |

Allow-list caveat: each fitness rule suppresses a finding when its allow pattern matches a five-line window (for example `process.env`, `vault`, `localhost`, `sandbox`, `checksum`). The rules are a fast screen, not a proof; reviewer rule 7-14 above still apply.

Candidate external tools (none shipped; register the adopted one as a check claiming `security`): Semgrep or CodeQL for SAST, gitleaks or trufflehog for secret history, osv-scanner, Trivy or Grype for dependencies and images, Syft for SBOM, Sigstore/cosign for provenance, OWASP ZAP for dynamic scanning, `tlsx` or `testssl.sh` for transport posture.

Module declaration in `catalog.json`:

```json
{
  "id": "auth",
  "paths": ["src/auth/**"],
  "layer": "domain",
  "riskTier": "critical",
  "forbiddenDependencies": ["ui"],
  "attributes": { "security": "critical", "privacy": "high" },
  "verification": ["unit", "sast", "dep-scan", "authz-matrix"]
}
```

with, for example, `"sast": { "command": "semgrep --error --config .semgrep.yml", "class": "security", "attributes": ["security"] }`. A security check must never set `allowFastSkip`.

## 8. Anti-patterns

| Anti-pattern | Why it fails |
|---|---|
| Authorization in the UI or gateway only | Direct API calls bypass it; mediation must be at the resource |
| Tenant id taken from a request body | Attacker-controlled; derive it from the authenticated principal |
<!-- dsb-fitness:ignore — the rows below quote the anti-patterns they forbid -->
| Blanket `try/catch` around auth failures | Turns a denial into an allow path; also violates `no-silent-failure` |
| Rolling your own crypto or token format | Reviewers cannot prove it; use vetted primitives and libraries |
| Encrypting with a key committed next to the ciphertext | Key management, not encryption, is the control |
| `rejectUnauthorized: false` "just for staging" | Ships to production; the flag is invisible in review diffs | <!-- dsb-fitness:ignore quoted anti-pattern -->
| Logging the full request body for debugging | Ships secrets and personal data to a lower-trust sink |
| Vulnerability report suppressed to make CI green | Evidence deletion; use an expiring, signed accepted risk instead |
| A pentest report as the security evidence | Point-in-time, unbound to the current diff; bind evidence to `diffHash` |
