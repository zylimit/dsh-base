// requirement-trace-audit - per-requirement implementation and coverage verdicts.
//
// WHAT IT DOES
//   Stage 1 (pipeline): one agent per requirement id in args.requirements. Each finds the
//     code that implements the requirement and the tests that cover it, and returns a
//     structured verdict with evidence paths and the gaps it could not close.
//   Stage 2: one summarising agent turns the verdicts into a traceability report -
//     coverage counts, the unverified set, the orphaned set, and the next action per gap.
//
//   This complements "node .dsh/base/dsb.mjs trace", which decides mechanically whether an
//   id is cited by code and tests. trace answers whether a citation exists; this workflow
//   answers whether the citation is real - the test asserts the behaviour the requirement
//   states, not merely that the id appears in a comment.
//
// ARGS
//   {
//     "requirements": ["REQ-<AREA>-<NNN>", "NFR-<ATTR>-<NNN>"],   // required, real ids
//     "specPath":  "docs/requirements/PRODUCT-SPEC.md",            // optional, default this
//     "testGlobs": ["tests/**", "**/*.test.mjs"]                   // optional, default catalog trace.testGlobs
//   }
//
//   Literal requirement ids are deliberately absent from this file. "dsb trace" treats a
//   REQ/NFR/HAZ/THR id found outside the requirement directories and the documentation
//   globs (docs/**, .dsh/templates/**, .dsh/skills/**, *.md) as a dangling reference and
//   exits 1; .dsh/workflows/** is not a documentation glob. Pass the ids in args.
//
// HOW TO INVOKE
//   Paste the body between the BEGIN and END markers into the workflow tool's script
//   parameter. Get the id list from the spec, or from the ids array in the trace output.
//
// WHY THE WRAPPER EXISTS
//   The workflow tool takes a function BODY with top-level await and a final return; that
//   body alone would not parse under node --check, which scripts/check-syntax.mjs runs over
//   every tracked .js file. Do not copy the wrapper line or the closing brace.

async function requirementTraceAudit () {
  // ----------------------------- BEGIN SCRIPT BODY -----------------------------
  const requirements = Array.isArray(args.requirements) ? args.requirements.filter(r => typeof r === 'string' && r.length > 0) : []
  if (requirements.length === 0) {
    return { ok: false, error: 'args.requirements must be a non-empty array of requirement ids', audited: 0 }
  }
  const specPath = typeof args.specPath === 'string' && args.specPath ? args.specPath : 'docs/requirements/PRODUCT-SPEC.md'
  const testGlobs = Array.isArray(args.testGlobs) && args.testGlobs.length > 0 ? args.testGlobs : null

  const verdictSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['requirement', 'implemented', 'verified', 'evidence', 'gaps', 'confidence'],
    properties: {
      requirement: { type: 'string' },
      implemented: { type: 'string', enum: ['yes', 'partial', 'no', 'unknown'] },
      verified: { type: 'string', enum: ['yes', 'weak', 'no', 'unknown'] },
      evidence: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'tests', 'notes'],
        properties: {
          code: { type: 'array', items: { type: 'string' } },
          tests: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
      },
      gaps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'detail', 'nextAction'],
          properties: {
            kind: { type: 'string', enum: ['no-implementation', 'no-test', 'test-asserts-implementation', 'acceptance-not-covered', 'dangling-id', 'ambiguous-requirement'] },
            detail: { type: 'string' },
            nextAction: { type: 'string' },
          },
        },
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  }

  phase('Trace requirements')
  log('tracing ' + requirements.length + ' requirement id(s) against ' + specPath)

  const verdicts = await pipeline(requirements, async (prev, id) => agent(
    'You are tracing one requirement through a repository governed by the dsb engine.\n\n' +
    'Requirement id: ' + id + '\n' +
    'Specification: ' + specPath + '\n' +
    (testGlobs ? 'Test globs: ' + testGlobs.join(', ') + '\n' : 'Test globs: read trace.testGlobs from .dsh/base/catalog.json\n') +
    '\nProcedure, in order:\n' +
    '1. Read the requirement block in the specification. Record its normative sentence and its Given/When/Then acceptance criteria. If the block is missing, return implemented unknown with a dangling-id gap.\n' +
    '2. Search the repository for the id and for the behaviour it describes. The id may be absent from the code while the behaviour is present; search for both, and say which one you found.\n' +
    '3. List, as repository-relative paths with line numbers, the code that implements the behaviour. Empty list means implemented no.\n' +
    '4. List the tests that cover it. A test counts only when it would FAIL if the behaviour were removed. A test that asserts the implementation shape rather than the stated behaviour is recorded as verified weak with a test-asserts-implementation gap.\n' +
    '5. Check the acceptance criteria one by one. A criterion with no assertion anywhere is an acceptance-not-covered gap naming that criterion.\n' +
    '6. Every gap carries a nextAction that a fresh agent could execute without asking a question: a file to change or a test to add, named.\n' +
    '7. Do not modify any file. This is a read-and-report pass.',
    { schema: verdictSchema, label: 'trace ' + id },
  ))

  const found = verdicts.filter(Boolean)
  const lost = requirements.length - found.length
  log('verdicts: ' + found.length + ', lost children: ' + lost)

  phase('Summarise')
  const reportSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['coverage', 'unverified', 'unimplemented', 'weakTests', 'actions', 'summary'],
    properties: {
      coverage: {
        type: 'object',
        additionalProperties: false,
        required: ['requested', 'reported', 'implemented', 'verified'],
        properties: { requested: { type: 'number' }, reported: { type: 'number' }, implemented: { type: 'number' }, verified: { type: 'number' } },
      },
      unverified: { type: 'array', items: { type: 'string' } },
      unimplemented: { type: 'array', items: { type: 'string' } },
      weakTests: { type: 'array', items: { type: 'string' } },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['requirement', 'action', 'path', 'priority'],
          properties: {
            requirement: { type: 'string' },
            action: { type: 'string' },
            path: { type: 'string' },
            priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          },
        },
      },
      summary: { type: 'string' },
    },
  }

  const report = found.length === 0
    ? null
    : await agent(
      'Produce a traceability report from per-requirement verdicts. Work from the data; do not read the repository.\n\n' +
      'Requested ids: ' + requirements.length + ', verdicts returned: ' + found.length + ', children lost: ' + lost + '\n\n' +
      'Verdicts as JSON:\n' + JSON.stringify(found) + '\n\n' +
      'Procedure:\n' +
      '1. Count implemented (yes) and verified (yes) separately; partial and weak never count as covered.\n' +
      '2. List every id that is unverified, unimplemented, or covered only by a weak test.\n' +
      '3. Turn every gap into one action with the requirement id, the concrete next step, the file path it touches, and a priority: P0 when the id is unimplemented or has no test at all, P1 when the test is weak or a criterion is uncovered, P2 otherwise.\n' +
      '4. summary is at most six sentences. State the coverage number, the largest cluster of gaps, and what to fix first. Do not claim coverage the verdicts do not support, and name the lost children as unknown rather than as covered.',
      { schema: reportSchema, label: 'traceability report' },
    )

  return {
    ok: true,
    requested: requirements.length,
    reported: found.length,
    lost,
    verdicts: found,
    report,
  }
  // ------------------------------ END SCRIPT BODY ------------------------------
}
