---
name: skill-authoring
description: Use when creating, editing, splitting or debugging a skill in .dsh/skills, or when a skill exists on disk but never appears in the session catalog.
whenToUse: Any change under .dsh/skills, and any time a written skill fails to load or fails to fire.
---

## Purpose
Write skills the harness will actually load and route to. A malformed skill is dropped silently - no error, no catalog entry - so correctness of the frontmatter is a hard gate, not a style preference. Produces one valid `SKILL.md` bundle plus its behaviour test.

## When this fires
- A new skill, role or user-invocable command is being added.
- A skill body exceeds its useful size, or repeats another skill.
- A skill is on disk but absent from the session catalog, or present but never routed to.
- `node .dsh/base/dsb.mjs skills-lint` exits non-zero.

## Procedure

### A. Place the bundle correctly
1. Path: `<projectRoot>/.dsh/skills/<name>/SKILL.md` (or `<name>.md`). Discovery is exactly one level deep; a skill nested deeper is invisible. Project root is the nearest `.git` ancestor.
2. Directory name is the skill name: kebab-case, and `name:` in the frontmatter must equal it exactly. A mismatch drops the skill.
3. Optional sibling directories inside the bundle: `references/`, `scripts/`, `assets/`. They resolve against the skill resource base and load only when the body tells the agent to read them.

### B. Write the frontmatter contract
```
---
name: <exact-directory-name>          # required, kebab-case, equals the directory
description: Use when <trigger>...    # required, one sentence, under 200 chars
whenToUse: <one short sentence>       # optional
metadata: <mapping>                   # optional
disable-model-invocation: true|false  # optional, HYPHEN-case only
user-invocable: true|false            # optional, HYPHEN-case only
---
```
1. `disableModelInvocation` and `userInvocable` (camelCase) are rejected and drop the whole skill. There is no warning. Check the spelling character by character.
2. `user-invocable: true` makes the skill available as `/<name>` typed by a user; that injects the body into the message. This is the only slash-command mechanism in dsh - there are no markdown-defined commands.
3. `disable-model-invocation: true` keeps the skill out of model routing while remaining user-invocable. Use it for commands that must never fire on their own.
4. The catalog truncates descriptions at 500 characters. Keep under ~200 so nothing is cut mid-sentence.

### C. Write the description as a trigger, not a summary
The description is catalog-resident and is the only text the model sees before loading. Describe *when to load*, never *what to do*: a description that reads like a procedure invites the model to act on the summary instead of loading the skill.

| Verdict | Description |
|---|---|
| Bad | `Run the tests, check coverage, then commit if the gate passes.` (a procedure - the model will just do it) |
| Bad | `Testing helper.` (no trigger, no routing signal) |
| Bad | `Use when you need quality.` (not decidable) |
| Good | `Use when a change is ready to verify - selects the impact-scoped check set and interprets gate exit codes.` |
| Good | `Use when a skill fails to appear in the session catalog or a skills-lint run exits non-zero.` |

### D. Size and structure discipline
1. The body is paid in full at load time; every line competes with the task. Target 3-12 KB. Above that, split: keep the decision procedure in the body, move tables, long examples and reference data to `references/<topic>.md` and name the path in the body.
2. Required body sections, in order: `## Purpose`, `## When this fires`, `## Procedure`, `## Output contract`, `## Stop conditions`, `## Anti-patterns`.
3. Every rule must be decidable. Where a machine check exists, name the exact command and the exit code that means stop. Where none exists, write "prompt-only" explicitly. Never imply automation that does not exist.
4. No repetition across sections and no overlap with an existing skill; two skills that both claim a trigger produce unpredictable routing. Merge, or narrow one description.

### E. Verify
1. `node .dsh/base/dsb.mjs skills-lint` - exit 0 required. Exit 1 names the rule violated (frontmatter shape, name mismatch, description length, key spelling, size).
2. `node .dsh/base/dsb.mjs catalog-lint` when the skill is referenced by a module or a check.
3. Confirm the skill appears in the session catalog after it is written. Absent from the catalog means dropped, regardless of how the file reads.
4. Run the behaviour test (section F). A loading skill that never fires is still a failure.

### F. Behaviour test
Record one test per skill in the body or in `references/tests.md`:
```
Trigger phrase : "<a sentence a user would plausibly write>"
Expected       : skill <name> is loaded before any task action
Observable     : <first concrete action the agent takes, e.g. runs node .dsh/base/dsb.mjs impact>
Negative       : "<a nearby sentence that must NOT load it>"
```
If the trigger phrase does not load the skill, the description is wrong - not the model. Rewrite the trigger clause and re-test.

## Output contract
One bundle per skill:
```
.dsh/skills/<name>/SKILL.md          # frontmatter + six sections, 3-12 KB
.dsh/skills/<name>/references/*.md   # optional, on-demand detail
.dsh/skills/<name>/scripts/*         # optional, invoked by the body
.dsh/skills/<name>/assets/*          # optional, templates and fixtures
```
Report after writing: skill name, byte size, `skills-lint` exit code, catalog presence (yes/no), behaviour-test trigger phrase.

## Stop conditions
Halt and ask the human when:
- The new skill overlaps an existing skill description and merging would change another owner's routing.
- `skills-lint` exits 1 for a reason the frontmatter contract does not explain.
- The skill would exceed 12 KB and the content cannot be split without breaking the procedure.
- The skill needs enforcement that does not exist in dsh (hooks, markdown-defined subagents, markdown-defined commands, a project settings file). Redesign it as a check in the catalog or as prompt-only text; do not invent the mechanism.
- A skill would encode a policy decision (what is allowed to ship) rather than a procedure.

## Anti-patterns
| Failure mode | Correction |
|---|---|
| `userInvocable: true` in frontmatter. | Use `user-invocable`; the camelCase key drops the entire skill with no error. |
| `name:` differs from the directory name. | Make them identical, kebab-case. |
| A description that summarises the procedure. | Describe the trigger; the model must load the skill to learn the steps. |
| Skill placed at `.dsh/skills/group/sub/SKILL.md`. | Discovery is one level deep; flatten to `.dsh/skills/<name>/SKILL.md`. |
| A 30 KB body "so nothing is missed". | Keep the decision path in the body; move detail to `references/` that loads on demand. |
| Claiming a hook or settings file enforces the rule. | Enforcement lives in git hooks, CI and the dsb engine; name the real check id or write "prompt-only". |
| Assuming the skill works because the file was written. | Confirm catalog presence and run the behaviour test. |
| Two skills with near-identical triggers. | Narrow one description or merge them; ambiguous routing is a defect. |
