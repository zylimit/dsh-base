---
name: incident-response
description: Use when production is degraded, a release is failing, data may be exposed, or a security event is suspected - to stabilise, diagnose, recover and run the postmortem.
whenToUse: The moment a failure signal is credible, before any diagnosis or fix is attempted.
---

## Purpose
Run a failure from first signal to closed postmortem without making it worse. Produces a timeline, a reversible mitigation record, a blast-radius assessment, a recovery verification, and action items that each name an owner, a date and a verification.

## When this fires
- A monitor, user report, failing gate on a released artifact, or a colleague signals degradation.
- A deploy or migration produces unexpected behaviour in a shared environment.
- Credentials, tokens or personal data may have been exposed (security variant, section G).
- Recovery from an earlier incident has regressed.

## Procedure

### A. Detect
1. Record the first signal verbatim with a UTC timestamp: source, message, observed impact.
2. Reproduce the signal once, cheaply. Do not begin fixing during reproduction.
3. Classify severity by user-visible impact and reversibility, not by how alarming it feels.

### B. Declare
1. Name one incident commander. The commander decides and records; other agents and people execute. Never two commanders.
2. Open the incident file `docs/incidents/<YYYY-MM-DD>-<slug>.md` and start the timeline immediately. Every entry: UTC time, actor, action or observation, evidence pointer.
3. State the mitigation objective in one sentence (what "stable" means for this incident).

### C. Stabilise (before diagnosing)
1. Mitigate first, understand second. Restore service by the cheapest reversible action: roll back, disable the flag, drain the node, fail over, block the input.
2. Change one thing at a time. Two simultaneous changes destroy the causal record and can compound the failure.
3. Record every mitigation as a reversible action with its rollback in the same line: `action -> rollback -> observed effect -> time`.
4. If a mitigation does not improve the signal within its stated window, roll it back before trying the next one.
5. A gate may be suspended for non-protected checks only, via `node .dsh/base/dsb.mjs waiver create` with an expiry and a reason. `security`, `safety` and `privacy` are protected: never waived, in an incident or out of one.

### D. Diagnose (after the bleeding stops)
1. `node .dsh/base/dsb.mjs impact` on the suspect change set - names the modules, owners and check ids in the blast radius. An empty plan is BLOCKED: the change set is wrong, not the code.
2. `node .dsh/base/dsb.mjs risk` - re-rank the affected modules by declared risk tier and attributes.
3. `node .dsh/base/dsb.mjs diff-hash` and `node .dsh/base/dsb.mjs receipt verify` - establish exactly what shipped. Exit 4 means the evidence is stale: regenerate before reasoning on it.
4. Build the hypothesis list from the timeline, then test the cheapest discriminating hypothesis first. Write down what each test would rule out before running it.

### E. Repair
1. Write the smallest change that removes the cause, inside the impacted modules only.
2. `node .dsh/base/dsb.mjs gate` on the impacted scope. Exit 2 stops the repair; exit 1 is a rule violation to fix, not to waive.
3. Add or extend a test that fails on the pre-repair code. A repair with no failing-before test is unverified.

### F. Recover and Learn
1. Remove mitigations in reverse order of application, one at a time, verifying the signal after each removal.
2. Confirm recovery against the original signal, not against a proxy metric. Declare the incident closed in the timeline with a UTC timestamp.
3. Run the postmortem within 5 working days, blameless: describe systems and decisions with the information available at the time; never name a person as the cause.
4. Answer explicitly: what made detection slow, and what made recovery slow. These two questions produce better action items than root cause alone.

### G. Security variant (additional, and it takes precedence)
1. Preserve evidence before remediating: snapshot logs, process state, artifact hashes and access records to an isolated location. Remediation destroys evidence; do it after capture, unless capture prolongs active exposure.
2. Rotate every credential that the compromised path could reach - not only the one observed in use. Invalidate sessions and tokens.
3. Assume the blast radius is wider than the first observation until evidence bounds it. Bound it with access logs and `impact`, not with optimism.
4. Do not communicate details on the compromised channel. Escalate to the human owner immediately; disclosure and legal notification are human decisions, never an agent decision.

### H. Communication cadence
| Severity | Update interval while unmitigated | Audience |
|---|---|---|
| critical | every 30 min | all stakeholders + owners |
| high | every 60 min | owners + requester |
| medium | at each phase transition | requester |
"No update" is itself an update: post the interval message stating what is being tried and what is not yet known. Silence is read as absence of work.

## Output contract
Incident file `docs/incidents/<YYYY-MM-DD>-<slug>.md`:
```
# Incident <slug>
Severity: <critical|high|medium|low>   Commander: <name>
Detected: <UTC>   Mitigated: <UTC>   Closed: <UTC>
Impact: <who and what, in user terms>
Blast radius: <module ids from dsb impact>

## Timeline
| UTC | Actor | Action or observation | Evidence |

## Mitigations
| UTC | Action | Rollback | Observed effect |

## Diagnosis
Hypotheses tested: <hypothesis -> test -> result>
Cause: <mechanism, not a person>

## Contributing factors
- <factor>

## Detection and recovery
Detection delay: <duration> - <why>
Recovery delay: <duration> - <why>

## Action items
| Item | Owner | Due | Verification | Strength |
|---|---|---|---|---|
| <item> | <name> | <YYYY-MM-DD> | <command or check id> | check id > fitness rule > skill step > prose |
```
The strongest action item is a new check id wired into `.dsh/base/catalog.json` `checks{}` and `riskChecks`. The weakest is "be more careful"; it is not an action item and must be rewritten or dropped.

## Stop conditions
Halt and ask the human when:
- The mitigation would destroy data, break a contract, or cannot be rolled back.
- Personal data or credentials may have been exposed: escalate before any remediation step that alters evidence.
- Severity is critical and no human commander has acknowledged within the first update interval.
- Two mitigations have failed and the next hypothesis requires a change to a `critical`-tier module.
- Disclosure, customer notification, or legal exposure is in question.
- Recovery cannot be verified against the original signal.

## Anti-patterns
| Failure mode | Correction |
|---|---|
| Diagnosing the cause while users are still affected. | Mitigate first with a reversible action; diagnose after the signal drops. |
| Applying three fixes at once to save time. | One change at a time, each with a rollback and an observation window. |
| Reconstructing the timeline afterwards from memory. | Write the timeline from the first signal; entries are cheap, recall is not. |
| Remediating a compromise before capturing evidence. | Snapshot logs and state first, unless capture prolongs active exposure. |
| Rotating only the credential seen in the logs. | Rotate everything the compromised path could reach; assume wider radius. |
| Waiving a `security` or `privacy` check to ship the fix. | Protected attributes are never waivable; fix or escalate to the owner. |
| Closing with an action item "be more careful with migrations". | Convert to a check id in the catalog with an owner, a date and a verification. |
| Going quiet while working hard. | Post the interval update; "no update" is an update. |
