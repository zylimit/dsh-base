# Product Specification changelog

Every edit to `PRODUCT-SPEC.md` adds an entry here in the same change. A spec edit
without a changelog entry is an incomplete change.

## 1.1 — copy surface collapsed into .dsh/

- Changed: the acceptance command of NFR-SEC-001 now reads
  `node .dsh/base/audit/scan-secrets.mjs`; the audit scripts moved from
  `scripts/` into `.dsh/base/audit/` and the reference manual moved from
  `docs/` into `.dsh/docs/`.
- Rationale: the scaffold must be installable by copying one directory, and it
  must not claim ownership of `docs/` or `scripts/`, which belong to the adopting
  project. No requirement text changed; only a path inside an acceptance criterion.
- Approver: maintainers.

## 1.0 — initial specification

- Added: REQ-GOV-001..004, REQ-ARC-001..006, REQ-SPC-001..002, REQ-DEL-001..002,
  REQ-SCL-001, REQ-OPS-001..002.
- Added: NFR-MAINT-001, NFR-PERF-001..002, NFR-SEC-001..002, NFR-PRIV-001,
  NFR-SAFE-001, NFR-REL-001, NFR-RES-001, NFR-AVAIL-001.
- Rationale: the scaffold governs itself, so its own behaviour has to be stated as
  decidable requirements before it can require the same of an adopting project.
- Approver: maintainers.

## 1.2 - project renamed deepseek-base -> dsh-base

- Changed: every reference to the project name across the constitution, engine output, hooks, installer messages and this specification now reads dsh-base.
- Rationale: the config repository is zylimit/dsh-base; the old name collided with the upstream product family. No requirement semantics changed.
- Approver: maintainers.
