---
name: architecture-design
description: Use when designing or restructuring a system; produces ARCHITECTURE.md plus the enforced catalog.json module graph, and per-module AGENTS.md contracts.
whenToUse: After the spec is decidable and before planning, or whenever module boundaries change.
bridge: true
---

## Purpose
Convert an approved specification into a structure that a machine can enforce: `docs/architecture/ARCHITECTURE.md` for the reasoning and `.dsh/base/catalog.json` for the module graph, layers, and forbidden edges.
A design that cannot be expressed as modules, layers and forbidden dependencies is not finished - it is a diagram.

## When this fires
- `node .dsh/base/dsb.mjs spec-lint` exits `0` and no architecture document exists.
- `node .dsh/base/dsb.mjs impact` reports `degraded` because changed paths map to no module.
- A new component, dependency direction, or integration boundary is proposed.
- `arch-check` reports a forbidden edge or a cycle, or `arch-trend --gate` shows violations increasing.

## Procedure

1. Pick the scale tier and build only what it requires.

| Tier | Trigger | Deliverable |
|---|---|---|
| S | Single deployable, under ~10k LOC, one owner | One page in `docs/architecture/ARCHITECTURE.md`: context, components, data, one decision table. No catalog modules |
| M | Multiple components or teams, ~10k-200k LOC | S plus `catalog.json` `modules[]` with `paths`, `owners`, `riskTier`, `attributes`, `verification` |
| L | Platform or 200k+ LOC, several deployables | M plus `layers[]` (outermost first), `dependsOn`/`forbiddenDependencies` per module, and an `AGENTS.md` in every module directory |

2. Write the architecture document first: context, component responsibilities, data ownership, sync/async boundaries, failure modes per boundary, and the decision table. Every decision that constrains future code becomes an ADR (`ADR-<NNNN>`) with a mandatory `Enforced-by:` line naming a check id, a fitness rule id, an engine capability, or the literal `manual: <who reviews>`. `node .dsh/base/dsb.mjs adr-check` exits `1` on `NO_ENFORCEMENT` or `PHANTOM_ENFORCEMENT`.
3. Encode the same design in `.dsh/base/catalog.json` in the same session. For each module set `id`, `paths[]`, `layer`, `owners[]`, `riskTier`, `dependsOn[]`, `forbiddenDependencies[]`, `provides[]`, `attributes{}` (eight attributes, six tiers) and `verification[]` (check ids that actually exist in `checks`).
4. Justify every `minimal` or `none` tier with a written `attributeReasons` entry. Declaring `security: critical` without a check in `verification` that claims `security` produces `BLOCKED_BY_ATTRIBUTES` at the gate - decide the tier and the proof together.
5. Size modules by business domain, not by directory. For a 1M+ LOC system target 30-150 modules; one module per directory produces a graph nobody reads and an `impact` set that is either everything or nothing. Merge modules that always change together; split a module whose owners disagree about its purpose.
6. Apply the seven principles and record, for each, the observable violation signal.

| Principle | Class level | Architecture level | Violation signal | Check |
|---|---|---|---|---|
| SRP | One reason to change per unit | One business capability per module | One feature change repeatedly touches 4+ modules | `budget` (`maxModulesTouched`), `impact` |
| OCP | Extend without editing | New adapters plug in without editing the core | Every new case edits the same switch in the same module | prompt-only; reviewer reads `impact` history |
| LSP | Subtype honours the contract | Any implementation of a port is swappable | Callers branch on the concrete implementation | prompt-only; module `verification` tests |
| ISP | Narrow interfaces | Consumers depend on the slice they use | `provides[]` grows past ~7 entries; unrelated consumers share one entry | prompt-only; catalog review |
| DIP | Depend on abstractions | Inner layers never import outer ones | Domain imports infrastructure | `arch-check` (`forbiddenDependencies`, `layers`), exit `1` |
| Law of Demeter | Talk to neighbours | No reaching through a module to its transitive dependency | Chained access `a.b().c().d()`; undeclared cross-module import | `arch-check` catches the undeclared edge; chain depth is prompt-only |
| Composition over inheritance | Assemble behaviour | Compose services instead of inheriting frameworks | Deep base-class hierarchies; a framework type in the domain | prompt-only; reviewer verdict |

7. Write `AGENTS.md` in each module directory. The linter requires exactly these four headings: `Purpose`, `Boundaries`, `Invariants`, `Verification`. dsh auto-loads that file whenever a first-party `read`/`write`/`edit` touches the directory, so it is the cheapest boundary contract available. Keep it under `agentsMd.maxBytes` (default 12000).
8. Verify in order and stop on the first failure: `node .dsh/base/dsb.mjs catalog-lint` (exit `1`: unknown layer, unknown check id, undeclared module path, cycle), `node .dsh/base/dsb.mjs arch-check` (exit `1`: forbidden or undeclared edge; `--record` writes the trend baseline), `node .dsh/base/dsb.mjs agents-lint` (exit `1`: missing root `AGENTS.md`, or a `high`/`critical` module with no `AGENTS.md`), and `node .dsh/base/dsb.mjs arch-trend --gate` to reject an increase in violations.

## Dialogue examples

Two real exchanges, compressed: the first derives the design from business
facts instead of fashion; the second explains a tradeoff and lets the human
choose with the consequence named.

Exchange 1 - from business responsibility to module boundaries:

    AI:   谁在写这几个模块?改动总是一起发生吗?
    User: 就我一个。凭证和会话总是一起改。
    AI:   那它们是一个模块,不是一个目录一个模块。业务上它们同一份职责,
          拆开只会让 impact 要么全炸要么全漏。我把它们合成 auth。
    User: 行。
    -> What happened: the boundary came from responsibility and co-change,
       not from the directory tree - the exact rule cochange enforces later.

Exchange 2 - a tradeoff is explained, the human chooses, the consequence is named:

    AI:   同步接口简单但一个挂全挂;异步队列能扛挂但你要养消息中间件,
          团队就你一个人。
    User: 先同步。
    AI:   同步,并且把失败后果写进模块的风险档:availability 定 medium,
          触发条件是「下游超时率过 1%」,到那时再升档换异步。取舍进 ADR。
    -> What happened: the choice was made with the tradeoff and the
       upgrade-trigger both named, so the future decision is scheduled, not
       re-litigated.

## Facts vs inference

| Design element | Marker | Rule |
|---|---|---|
| business responsibilities, data ownership, team facts | F | restated from the spec or the human, never assumed |
| layer direction, module boundaries, tier choices | I | every I is a proposal with a named alternative, presented to the human before the catalog encodes it |
| failure consequences not yet known | U | recorded in the architecture document as open questions, not silently defaulted to "resilient" |

The catalog encodes F and confirmed I only. An unconfirmed tier is a guess
that the attribute gate will later turn into a false green or a false red.

## Handoff

The planner and implementers receive:

1. ARCHITECTURE.md with the decision table - every tradeoff named with its
   rejected alternative and the trigger that would reverse it.
2. The catalog graph the machine enforces - the same design, not a second one.
3. ADRs with Enforced-by lines - so a decision reads as enforced only when
   something actually enforces it.
4. The open questions with owners, because an unresolved failure consequence
   must block the tier that depends on it.

## Output contract
- `docs/architecture/ARCHITECTURE.md`: Context / Components and responsibilities / Data ownership / Boundaries and failure modes / Layer map (outermost first) / Module table / Decisions (ADR links) / Rejected alternatives.
- Module table columns: `id | layer | paths | owners | riskTier | attributes (non-default only) | verification`.
- `.dsh/base/catalog.json` updated in the same session; `catalog-lint` exit `0`.
- `<module-dir>/AGENTS.md` template:

```
# <module id>
## Purpose
One paragraph: the business capability this module owns.
## Boundaries
Owns: <files, data, decisions>. Does not own: <named neighbours>. May import: <modules>. Must not import: <modules>.
## Invariants
Numbered, decidable statements that must hold after every change.
## Verification
The exact commands that prove this module still works, and the check ids in catalog.json.
```

## Stop conditions
- The design cannot be expressed as modules with directed edges: stop and redesign; do not encode a wish into the catalog.
- A proposed edge is forbidden by an existing ADR: stop; either change the design or supersede the ADR with a new one that names the rejected alternative.
- Encoding the design would require editing `.dsh/base/lib/*`: forbidden - report the engine limitation instead.
- A module needs an attribute at `critical`/`high` but no check can prove it: stop and ask which check to add or which tier to lower; do not silently downgrade.
- `arch-check` reports pre-existing violations unrelated to this change: record the count, do not fix them in this session, and do not let the number increase.

## Anti-patterns
| Failure mode | Correction |
|---|---|
| Diagram-only design with no `catalog.json` change | Encode modules, layers and forbidden edges in the same session; `catalog-lint` exit `0` |
| One module per source directory | Group by business domain; 30-150 modules at 1M+ LOC |
| Declaring `security: critical` with no claiming check | Add the check to `verification` or lower the tier with a written `attributeReasons` entry |
| Adding a module without `paths` coverage for new files | Unmapped paths make `impact` degraded, which is exit `3`, not a pass |
| ADR without `Enforced-by:`, or naming a check that does not exist | `adr-check` flags `NO_ENFORCEMENT`/`PHANTOM_ENFORCEMENT`; name a real check id, fitness rule, capability, or `manual: <owner>` |
| `AGENTS.md` written as a tutorial | Four headings only, invariants decidable, under the byte cap |
| Fixing an `arch-check` failure by deleting the forbidden edge from the catalog | The edge exists in the code; fix the code or record a superseding ADR |
| Layer list written innermost first | `layers[]` is outermost first; an inverted list inverts every dependency rule |
