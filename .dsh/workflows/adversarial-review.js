// adversarial-review - Blue states the evidence, Red attacks from named lenses, Judge rules.
//
// WHAT IT DOES
//   Stage 1 (sequential): a Blue agent states what it verified about args.scope and how,
//     with a command and an exit code or a file:line behind every claim, and lists what it
//     could not verify. Blue runs first because Red attacks Blue's claims.
//   Stage 2 (parallel): one Red agent per lens in args.lenses - security, privacy,
//     resilience, reliability, safety, correctness, operability by default. Each returns
//     concrete attacks; a finding without a file:line or a reproduction path is discarded
//     by construction.
//   Stage 3 (sequential): a Judge agent weighs Blue evidence against Red findings and
//     returns exactly one verdict: ACCEPT, FIX_REQUIRED or NEEDS_MORE_EVIDENCE.
//
//   parallel() is a barrier and is normally avoided, but the Judge cannot start before every
//   lens has reported, so the barrier is the contract rather than a cost.
//
// ARGS
//   {
//     "scope":    "services/refund/**, the diff in review-pack 2026-02-11",  // required
//     "packPath": ".dsh/base/state/review/<pack>.md",                        // optional
//     "lenses":   ["security", "resilience"],                                // optional subset
//     "taskId":   "refund-idempotency"                                       // optional, for the report
//   }
//
// HOW TO INVOKE
//   Run "node .dsh/base/dsb.mjs review-pack" first and pass the written path as packPath: a
//   self-selected diff is where reviewers skip files. Then paste the body between the BEGIN
//   and END markers into the workflow tool's script parameter. The verdict is advice for the
//   reviewing agent; only "dsb receipt write" records a verdict as evidence, and it binds to
//   the current diff hash.
//
// WHY THE WRAPPER EXISTS
//   The workflow tool takes a function BODY with top-level await and a final return; that
//   body alone would not parse under node --check, which scripts/check-syntax.mjs runs over
//   every tracked .js file. Do not copy the wrapper line or the closing brace.

async function adversarialReview () {
  // ----------------------------- BEGIN SCRIPT BODY -----------------------------
  const DEFAULT_LENSES = ['security', 'privacy', 'resilience', 'reliability', 'safety', 'correctness', 'operability']
  const LENS_BRIEF = {
    security: 'Authentication and authorization on every new path, input validation at the trust boundary, output encoding at the sink, secret handling, injection sinks, transport verification, dependency provenance.',
    privacy: 'Personal data entering logs, exports, third-party calls or caches; retention beyond the stated period; a deletion path that misses replicas, indexes or backups; an identifier used as a join key across purposes.',
    resilience: 'Missing timeout, unbounded retry, no backoff or jitter, no circuit breaker, unbounded queue or cache, no bulkhead, behaviour when the dependency is slow rather than down, recovery after a restart mid-operation.',
    reliability: 'Wrong or missing results under expected conditions: idempotency, ordering, partial writes, concurrent callers, clock assumptions, error swallowing, tests that pass without the behaviour.',
    safety: 'What this change can move, energize, dispense, dispatch, publish, delete or bill; the safe state on every failure path; an interlock that can be bypassed by a new entry point; a guard removed by the diff.',
    correctness: 'The stated requirement versus the implemented behaviour, acceptance criteria not asserted anywhere, edge values, off-by-one boundaries, unrequested scope in the diff.',
    operability: 'Can an on-call engineer see this failing, and act? Signals, log content, alert thresholds, runbook steps, rollback path, configuration that requires a deploy to change.',
  }
  const scope = typeof args.scope === 'string' && args.scope ? args.scope : ''
  if (!scope) return { ok: false, error: 'args.scope is required: name the paths and the diff under review' }
  const packPath = typeof args.packPath === 'string' && args.packPath ? args.packPath : null
  const taskId = typeof args.taskId === 'string' && args.taskId ? args.taskId : 'unnamed-task'
  const requested = Array.isArray(args.lenses) && args.lenses.length > 0 ? args.lenses : DEFAULT_LENSES
  const lenses = requested.filter(l => typeof l === 'string' && LENS_BRIEF[l])
  if (lenses.length === 0) return { ok: false, error: 'no known lens requested; known lenses: ' + DEFAULT_LENSES.join(', ') }

  const context = 'Scope under review: ' + scope + '\n' +
    (packPath ? 'Evidence pack: ' + packPath + ' (review that pack; do not assemble your own diff view)\n' : 'No evidence pack was supplied; run node .dsh/base/dsb.mjs review-pack yourself and review its output\n') +
    'Task id: ' + taskId + '\n'

  phase('Blue - state the evidence')
  const blueSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['claims', 'unverified', 'gateStatus'],
    properties: {
      claims: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['claim', 'evidence', 'kind'],
          properties: {
            claim: { type: 'string' },
            evidence: { type: 'string' },
            kind: { type: 'string', enum: ['command-exit', 'file-line', 'test-id', 'none'] },
          },
        },
      },
      unverified: { type: 'array', items: { type: 'string' } },
      gateStatus: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED', 'BLOCKED_BY_ATTRIBUTES', 'NOT_RUN'] },
    },
  }
  const blue = await agent(
    'You are Blue in an adversarial review. State only what you verified, and how.\n\n' + context +
    '\nProcedure:\n' +
    '1. Run node .dsh/base/dsb.mjs gate and node .dsh/base/dsb.mjs fitness --all. Record the gate status literally. BLOCKED means a check never ran; it is not a pass, and SKIPPED covers nothing.\n' +
    '2. For every behaviour claim, give the command and its exit code, or a file path with a line number, or a test id. A claim with kind none goes in unverified instead.\n' +
    '3. List everything you could not verify and why. An empty unverified list is itself a finding against you: name at least what the executed checks do not prove.\n' +
    '4. Do not modify any file.',
    { schema: blueSchema, label: 'blue' },
  )

  phase('Red - attack')
  const redSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['lens', 'findings', 'checkedClean'],
    properties: {
      lens: { type: 'string' },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['severity', 'file', 'line', 'reproduction', 'impact', 'requiredFix'],
          properties: {
            severity: { type: 'string', enum: ['critical', 'major', 'minor', 'nit'] },
            file: { type: 'string' },
            line: { type: 'number' },
            reproduction: { type: 'string' },
            impact: { type: 'string' },
            requiredFix: { type: 'string' },
          },
        },
      },
      checkedClean: { type: 'array', items: { type: 'string' } },
    },
  }
  const redResults = await parallel(lenses.map(lens => () => agent(
    'You are Red in an adversarial review, attacking from one lens only.\n\n' + context +
    '\nLens: ' + lens + '\n' + LENS_BRIEF[lens] + '\n\n' +
    'Blue claims, as JSON:\n' + JSON.stringify(blue) + '\n\n' +
    'Procedure:\n' +
    '1. Attack the claims first: for each, ask what it does NOT prove, and whether the evidence would still hold under the failure this lens owns.\n' +
    '2. Audit the deletions in the diff. A removed test, guard, validation, interlock or log line is a finding unless the change also retires what it protected, in writing.\n' +
    '3. Every finding names a repository-relative file and a line number, plus a reproduction: a command, an input, or an ordered sequence of events. When the defect is an absence rather than a line, cite the nearest artifact and set line to 0, and put the absent thing in reproduction.\n' +
    '4. Speculation without a location is not a finding. Discard it rather than lowering its severity.\n' +
    '5. checkedClean lists what you examined and found sound; an empty list means you did not look.\n' +
    '6. Do not modify any file.',
    { schema: redSchema, label: 'red ' + lens },
  )))
  const reds = redResults.filter(Boolean)
  const lostLenses = lenses.length - reds.length
  const allFindings = reds.flatMap(r => r.findings.map(f => ({ lens: r.lens, ...f })))
  log('red findings: ' + allFindings.length + ' from ' + reds.length + '/' + lenses.length + ' lens(es)')

  phase('Judge - one verdict')
  const judgeSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'findings', 'missingEvidence', 'rationale'],
    properties: {
      verdict: { type: 'string', enum: ['ACCEPT', 'FIX_REQUIRED', 'NEEDS_MORE_EVIDENCE'] },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['severity', 'lens', 'file', 'line', 'finding', 'reproduction', 'requiredFix'],
          properties: {
            severity: { type: 'string', enum: ['critical', 'major', 'minor', 'nit'] },
            lens: { type: 'string' },
            file: { type: 'string' },
            line: { type: 'number' },
            finding: { type: 'string' },
            reproduction: { type: 'string' },
            requiredFix: { type: 'string' },
          },
        },
      },
      missingEvidence: { type: 'array', items: { type: 'string' } },
      rationale: { type: 'string' },
    },
  }
  const judge = await agent(
    'You are the Judge in an adversarial review. Return exactly one verdict.\n\n' + context +
    '\nBlue, as JSON:\n' + JSON.stringify(blue) + '\n\n' +
    'Red findings, as JSON:\n' + JSON.stringify(allFindings) + '\n' +
    'Lenses that returned nothing at all: ' + lostLenses + '\n\n' +
    'Rules:\n' +
    '1. FIX_REQUIRED when any unresolved finding is major or critical, or when Blue reports gateStatus FAIL, BLOCKED, BLOCKED_BY_ATTRIBUTES or NOT_RUN. A failing or blocked gate ends the review; do not weigh code quality against it.\n' +
    '2. NEEDS_MORE_EVIDENCE when the claim cannot be judged from what you were given. Then missingEvidence names the exact command or artifact that would settle it - never a general request for more detail.\n' +
    '3. ACCEPT only when no unresolved finding is major or above AND Blue gateStatus is PASS. Counter-evidence outranks confirming evidence: one credible major finding reopens the verdict even when every check passed.\n' +
    '4. Keep every finding you carry forward: severity, lens, file, line, reproduction, required fix. Drop a Red finding only by explaining in rationale why its location or reproduction does not hold.\n' +
    '5. A lens that returned nothing is unreviewed, not clean. Say so in rationale.\n' +
    '6. rationale is at most eight sentences.',
    { schema: judgeSchema, label: 'judge' },
  )

  return {
    ok: true,
    taskId,
    scope,
    lensesRequested: lenses,
    lensesReported: reds.map(r => r.lens),
    lensesLost: lostLenses,
    blue,
    redFindingCount: allFindings.length,
    judge,
    note: 'A verdict here is advice. Only node .dsh/base/dsb.mjs receipt write records a review as evidence, and it stales on the next byte of change.',
  }
  // ------------------------------ END SCRIPT BODY ------------------------------
}
