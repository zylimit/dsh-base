# Fleet manifest authoring contract

<!-- rule: copy this guidance next to fleet.json at the FLEET ROOT - the directory
     that contains the service repositories, or a dedicated governance repository.
     The engine finds it by walking up from the working directory, or through
     DSB_FLEET, or with --fleet <path>. -->

A fleet manifest declares two things a single repository cannot see: which
repositories exist, and which contracts run between them.

## Placement

```
platform/
  fleet.json          <- the manifest
  orders/             <- a service repository, itself governed by .dsh/
  billing/
  web/
```

## Repository entry

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | stable short name; used by every fleet command |
| `path` | yes | location relative to `fleet.json` |
| `owners` | recommended | who negotiates a contract change; a contract with no owner has nobody to negotiate it |
| `provides[]` | | contracts this repository publishes |
| `consumes[]` | | contracts this repository depends on |

## Contract entry

| Field | Required | Meaning |
|---|---|---|
| `contract` | yes | globally unique id, conventionally `<repo>.<surface>` |
| `version` | yes | the published version; consumers may select `2.x` or an exact value |
| `kind` | | `http` · `grpc` · `event` · `schema` · `library` · `file` · `other` |
| `status` | | `active` · `deprecated` · `retired` |
| `sunset` | required when deprecated | ISO date; a deprecation nobody must act on is permanent |
| `spec` | recommended | path inside the providing repository to the contract document |
| `adr` | recommended | the decision that published it; a contract is an architectural commitment |
| `public` | | true when consumers exist outside this fleet, so `ORPHAN_CONTRACT` does not fire |
| `external` | consume side | true when the provider is outside this fleet |

## What the engine checks

```sh
node .dsh/base/dsb.mjs fleet lint        # the manifest is consistent and honest
node .dsh/base/dsb.mjs fleet status      # every repository is installed and healthy
node .dsh/base/dsb.mjs fleet impact <c>  # what a change to this contract costs
node .dsh/base/dsb.mjs fleet recap       # where the whole fleet is, in one budget
```

| Finding | Severity | Why |
|---|---|---|
| `DANGLING_CONSUME` | error | depends on a contract nobody here publishes |
| `UNPROVIDED_VERSION` | error | the offered versions do not include the one consumed |
| `CONTRACT_MULTIPLE_OWNERS` | error | ownership must be unambiguous |
| `DEPRECATED_WITHOUT_SUNSET` | error | a deprecation with no date never happens |
| `SUNSET_PASSED` | error | the date passed and consumers are still on it |
| `CONSUMING_RETIRED` | error | depends on something withdrawn |
| `CONSUMING_DEPRECATED` | warning | migrate before the sunset date |
| `CONTRACT_CYCLE` | warning | these repositories cannot be released independently — the distributed-monolith signature |
| `ORPHAN_CONTRACT` | warning | published and consumed by nobody; retire it or mark it public |
| `CONTRACT_WITHOUT_ADR` | warning | a published contract with no recorded decision |
| `NO_OWNER` | warning | nobody to negotiate a change |

## The rule that matters

**A breaking contract change is a coordinated release, and its cost is
`fleet impact`'s `coordinationCost`.** Publish the new version beside the old,
declare a sunset date, migrate every consumer, then retire. Never change a
published version in place: the consumers you cannot see are the ones that break.
