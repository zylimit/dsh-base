# .dsh/skills — the skill library

## Purpose

Every reusable procedure this project knows. The DeepSeek Harness discovers skills
here and offers them to the model by name and description; a human invokes one
directly by typing `/<skill-name>`. This directory is the project's procedural
memory, and the root `AGENTS.md` is deliberately small because this directory
exists.

## Boundaries

1. Discovery is exactly one level deep: `.dsh/skills/<name>/SKILL.md` or
   `.dsh/skills/<name>.md`. A nested tree is not discovered. Supporting material
   goes in `<name>/references/`, `<name>/scripts/` or `<name>/assets/` and is
   loaded only when the skill body points at it.
2. Frontmatter keys the harness understands: `name`, `description`, `whenToUse`,
   `metadata`, `disable-model-invocation`, `user-invocable`. The last two are
   hyphen-case; a camelCase spelling makes the harness drop the entire skill without
   an error the model can see.
3. `name` must be kebab-case and identical to the directory name.
4. A skill states procedure. It does not restate the constitution, and it never
   contradicts the root `AGENTS.md`.
5. Skills contain no executable logic that a check should own. If a rule can be
   verified by a command, add the command to `catalog.checks` and have the skill
   name it.

## Invariants

1. `description` describes the **trigger**, not the procedure, and starts with
   "Use when". A description that reads like a summary invites the model to act on
   the summary instead of loading the skill.
2. Every catalog description is resent on every request. Keep descriptions under
   200 characters; the harness truncates at 500.
3. A skill body is paid in full at load time. Keep it between 3 KB and 12 KB and
   push detail into `references/`.
4. Every skill body carries the same six sections: Purpose, When this fires,
   Procedure, Output contract, Stop conditions, Anti-patterns.
5. Duplicate skill names shadow each other silently. Names are unique here.

## Verification

```sh
node .dsh/base/dsb.mjs skills-lint   # frontmatter contract, naming, size, duplicates
```

A malformed skill is dropped silently by the harness, so this lint is the only
signal that a skill exists but will never fire. Run it after every edit here.
