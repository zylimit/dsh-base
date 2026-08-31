# ADR-0008: Roles and slash commands are implemented as skills

Status: Accepted
Date: 2025-01-01
Deciders: maintainers
Enforced-by: skills-lint | manual:maintainers audit the skill catalog at each release

## Context

Donor scaffolds define subagents and slash commands as markdown files that their
host reads. The DeepSeek Harness reads neither. Its only repository-level extension
point for procedure is `.dsh/skills/<name>/SKILL.md`, which the model can load by
name and which a human can invoke directly by typing `/<skill-name>`.

## Decision

Every role (implementer, reviewer, tester, analyst) and every operator command is a
skill. A delegation supplies the role skill's content in the child's prompt together
with the six-field task envelope; there is no separate agent-definition format.

## Consequences

- One asset type, one lint (`skills-lint`), one discovery mechanism.
- A malformed skill is dropped silently by the harness, so `skills-lint` is the only
  signal that a skill exists but will never fire. It runs in the pre-commit hook and
  in CI.
- Role restrictions (for example "the reviewer does not edit code") are prompt-only.
  Where a restriction must be mechanical it is expressed as a check instead.

## Alternatives rejected

- **Invent a project-local agent-definition format and a loader.** Rejected: it
  would be read by nothing the harness ships, so it would be documentation wearing
  the costume of a mechanism.
