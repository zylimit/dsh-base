# Changelog

## 1.0.0

Initial release.

- Project constitution (`AGENTS.md`) with eleven laws, each backed by a named
  command or explicitly marked prompt-only.
- Zero-dependency governance engine (`.dsh/base/dsb.mjs`) with 27 subcommands and
  a five-value exit-code contract.
- 23 skills covering the operating loop, requirement elicitation, architecture
  design and guarding, threat modelling, hazard analysis, privacy by design,
  resilience, reliability, delegation, context economy, review, testing, debugging,
  release, incident response, skill authoring and feedback graduation.
- Self-governing module catalog: 13 modules, 5 layers, forbidden edges, per-module
  quality attributes, per-module verification plans.
- 58 engine self-test assertions and 38 behavioural tests.
- 27 requirements (`REQ-*` and `NFR-*`) with 100 % test traceability.
- 8 architecture decision records, each naming a resolvable enforcement point.
- git hooks (pre-commit, commit-msg, pre-push) and a CI matrix over two operating
  systems and three Node versions.
