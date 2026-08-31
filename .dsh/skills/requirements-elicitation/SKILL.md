---
name: requirements-elicitation
description: Use when a product, feature, or change lacks a decidable specification; produces EARS-form requirements with acceptance criteria in PRODUCT-SPEC.md.
whenToUse: Before design or planning, whenever requirements are absent, vague, or adjective-based.
---

## Purpose
Turn an informal request into a specification where every statement can be answered yes or no by a test.
Produces `docs/requirements/PRODUCT-SPEC.md` (EARS-form REQ/NFR entries with Given/When/Then acceptance criteria) and a paired `docs/requirements/PRODUCT-SPEC-CHANGELOG.md` entry.

## When this fires
- A request arrives as a feature name, a screenshot, or an adjective ("fast", "user-friendly") rather than a behaviour.
- `node .dsh/base/dsb.mjs spec-lint` exits non-zero, or exits `3` because no requirement document exists.
- A REQ id is referenced by code or a plan but is not defined in the spec (dangling id, reported by `trace`).
- Scope is being negotiated: what is in, what is explicitly out.

## Procedure

1. Cover all six dimensions. An unanswered dimension blocks the spec; write "out of scope because <reason>" rather than leaving it blank.

| # | Dimension | The question it answers | Decidable form |
|---|-----------|-------------------------|----------------|
| 1 | Product framing | What problem, for whom, and what breaks if it does not exist | One sentence naming the problem and the current workaround |
| 2 | Target users and jobs | Which roles, which job-to-be-done, what frequency | Role + trigger + outcome the user can observe |
| 3 | Core capabilities | What the system must do, ranked | Verb-object list, each mapped to at least one REQ |
| 4 | User journeys | The end-to-end path, including the failure path | Numbered steps with the state after each step |
| 5 | Technical constraints | Platform, language, data, integrations, deadlines, existing systems | Named versions, named systems, named limits |
| 6 | Key attributes | `resilience`, `security`, `safety`, `privacy`, `reliability` | One NFR each, with a number and a unit, or an explicit written waiver |

2. Apply the sufficiency gate before writing anything: every dimension answered AND each answer expressed as a decidable statement. An adjective is not an answer. "Fast" fails; "p95 response under 300 ms at 50 concurrent users" passes. `spec-lint` rejects the terms `user-friendly`, `robust`, `scalable`, `efficient`, `appropriate`, `reasonable`, `flexible`, `as needed`, `best effort`, `if possible`, and placeholders `TBD`, `TODO`, `FIXME`, `???`.
3. Ask with `ask_user_question`, one or two questions at a time, never a questionnaire. Each question names the decision it unblocks.
4. When the human genuinely does not know, do not park the item: offer 2-3 concrete options with tradeoffs, for example "(a) session cookie - simplest, no mobile client; (b) JWT with 15 min expiry - mobile ready, needs refresh endpoint; (c) opaque token in Redis - revocable, adds a dependency". Record the chosen option and the rejected one.
5. Write each functional requirement in EARS form with a unique `REQ-<AREA>-<NNN>` id, a normative keyword (`SHALL` or `MUST`), and Given/When/Then acceptance criteria. Ids are append-only; never renumber or reuse.
6. Write each quality requirement as `NFR-<ATTR>-<NNN>` carrying a number and a unit. `spec-lint` errors with `NO_METRIC` on an NFR without a measurable target.
7. Update `docs/requirements/PRODUCT-SPEC-CHANGELOG.md` in the same turn as any spec edit: date, ids added/changed/removed, one-line reason. A spec edit without a changelog entry is an incomplete turn.
8. Verify with `node .dsh/base/dsb.mjs spec-lint`. Exit `0` closes the phase. Exit `1` names file, line, id and code (`PLACEHOLDER`, `DUPLICATE_ID`, `NOT_NORMATIVE`, `NO_METRIC`, `NO_ACCEPTANCE`, `AMBIGUOUS`, `ATTRIBUTE_UNADDRESSED`) - fix and re-run. Exit `3` means no requirement document was found at all.
9. Run `node .dsh/base/dsb.mjs trace` once code or tests exist, to confirm every id is referenced and no dangling id is cited.

### EARS patterns
| Pattern | Template | Worked example |
|---|---|---|
| Ubiquitous | The <system> SHALL <response>. | `REQ-AUTH-001`: The API SHALL store password hashes using Argon2id with a memory cost of at least 64 MB. |
| Event-driven | WHEN <trigger>, the <system> SHALL <response>. | `REQ-AUTH-002`: WHEN a sign-in request presents valid credentials, the API SHALL return a session token that expires 900 seconds after issue. |
| State-driven | WHILE <state>, the <system> SHALL <response>. | `REQ-SYNC-003`: WHILE the device is offline, the client SHALL queue write operations in local storage up to 500 entries. |
| Unwanted behaviour | IF <condition>, THEN the <system> SHALL <response>. | `REQ-AUTH-004`: IF five consecutive sign-in attempts for one account fail within 60 seconds, THEN the API SHALL reject further attempts for that account for 300 seconds and emit an audit event. |
| Optional feature | WHERE <feature is included>, the <system> SHALL <response>. | `REQ-BILL-005`: WHERE the enterprise plan is enabled, the service SHALL export invoices as PDF within 10 seconds of request. |
| Complex | WHILE <state>, WHEN <trigger>, the <system> SHALL <response>. | `REQ-SYNC-006`: WHILE a sync is in progress, WHEN the user edits a queued record, the client SHALL keep the local edit and mark the record for re-sync without data loss. |

## Output contract
`docs/requirements/PRODUCT-SPEC.md` sections, in order: Problem and framing / Users and jobs / Scope (in and explicitly out) / Journeys / Functional requirements / Quality requirements / Constraints / Open questions with owner and deadline.

Requirement block template:

```
### REQ-AUTH-002 - Session token issue
WHEN a sign-in request presents valid credentials, the API SHALL return a session token that expires 900 seconds after issue.
Priority: P0 | Attributes: security, reliability | Source: <who asked>
Acceptance:
  Given a registered account with a correct password
  When POST /session is called with those credentials
  Then the response is 200, contains a token, and the token is rejected 901 seconds later
```

Changelog entry template: `YYYY-MM-DD | added REQ-AUTH-002, NFR-SEC-001 | changed REQ-AUTH-001 (hash cost raised) | reason: <one line>`.

## Stop conditions
- A dimension cannot be answered and the human cannot choose between the offered options: record it under Open questions with an owner and a date, and stop before design.
- A requested requirement contradicts an existing REQ: stop and ask which one wins; do not silently supersede.
- A stakeholder asks for a deadline-driven "just build it": state that the spec is the acceptance contract, offer the smallest decidable version, and ask for one decision.
- An NFR has no measurable target and the human declines to set one: mark the attribute out of scope in writing, or stop.
- The change touches `safety` or `privacy` behaviour and no attribute requirement exists: stop; these are never inferred.

## Anti-patterns
| Failure mode | Correction |
|---|---|
| Writing "the system should be secure and performant" | Split into `NFR-SEC-00N` and `NFR-PERF-00N`, each with a number and a unit |
| Asking twelve questions in one message | Ask 1-2, name the decision each unblocks, iterate |
| Filling gaps with plausible invented defaults | Offer 2-3 options with tradeoffs and let the human pick; record the rejection |
| Renumbering ids to tidy the document | Ids are append-only; mark superseded entries and keep the number |
| Editing the spec without touching the changelog | Paired update in the same turn, or the spec edit is not done |
| Acceptance criteria written as "works correctly" | Given/When/Then with observable values, status codes, and timings |
| Declaring the spec finished without running the linter | `node .dsh/base/dsb.mjs spec-lint` must exit `0` before design starts |
