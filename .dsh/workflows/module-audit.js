// module-audit - one auditor agent per module, then de-duplication and ranking.
//
// WHAT IT DOES
//   Stage 1 (pipeline): one auditor agent per module id in args.modules. Each returns a
//     structured finding list bound to file:line, plus the quality-attribute gaps it saw.
//   Stage 2 (pipeline): the same item, de-duplicated and ranked inside its own module, with
//     every finding that carries no file and line dropped. A finding without a location is
//     an opinion.
//   Merge: pipeline stages have no barrier, so cross-module de-duplication cannot be a
//     stage. One final agent receives every surviving finding and produces the global
//     ranking and the repeated-pattern list.
//
// ARGS
//   {
//     "modules":   ["engine-core", "engine-scan"],   // required, catalog module ids
//     "focus":     "resilience and reliability",     // optional, default: all eight attributes
//     "maxFindings": 8                               // optional, per-module cap, default 10
//   }
//
// HOW TO INVOKE
//   Call the workflow tool with meta { name: "module-audit", description: ... } and paste the
//   body between the BEGIN and END markers below into the script parameter. Read the module
//   ids from .dsh/base/catalog.json first; an id that is not in the catalog wastes an agent.
//
// WHY THE WRAPPER EXISTS
//   The workflow tool takes a function BODY with top-level await and a final return. A file
//   containing that body would not parse (node .dsh/base/audit/check-syntax.mjs runs node --check on
//   every tracked .js file), so the body is wrapped in a function here. Do not copy the
//   wrapper line or the closing brace.

async function moduleAudit () {
  // ----------------------------- BEGIN SCRIPT BODY -----------------------------
  const ATTRIBUTES = ['security', 'safety', 'privacy', 'resilience', 'reliability', 'availability', 'performance', 'maintainability']
  const modules = Array.isArray(args.modules) ? args.modules.filter(m => typeof m === 'string' && m.length > 0) : []
  if (modules.length === 0) {
    return { ok: false, error: 'args.modules must be a non-empty array of catalog module ids', audited: 0 }
  }
  const focus = typeof args.focus === 'string' && args.focus ? args.focus : 'all eight quality attributes'
  const maxFindings = typeof args.maxFindings === 'number' ? args.maxFindings : 10

  const findingProperties = {
    severity: { type: 'string', enum: ['critical', 'major', 'minor', 'nit'] },
    category: { type: 'string', enum: ATTRIBUTES },
    file: { type: 'string' },
    line: { type: 'number' },
    summary: { type: 'string' },
    recommendation: { type: 'string' },
  }
  const auditSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['module', 'riskTier', 'findings', 'attributeGaps', 'confidence'],
    properties: {
      module: { type: 'string' },
      riskTier: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'minimal', 'none'] },
      findings: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['severity', 'category', 'file', 'line', 'summary', 'recommendation'], properties: findingProperties },
      },
      attributeGaps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['attribute', 'declaredTier', 'why'],
          properties: {
            attribute: { type: 'string', enum: ATTRIBUTES },
            declaredTier: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'minimal', 'none'] },
            why: { type: 'string' },
          },
        },
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  }

  phase('Audit modules')
  log('auditing ' + modules.length + ' module(s), focus: ' + focus)

  const audited = await pipeline(
    modules,
    async (prev, moduleId) => agent(
      'You are auditing one module of a repository governed by the dsb engine.\n\n' +
      'Module id: ' + moduleId + '\n' +
      'Focus: ' + focus + '\n\n' +
      'Procedure, in order:\n' +
      '1. Read .dsh/base/catalog.json and find the entry whose id is this module. Record its paths, layer, riskTier, attributes and verification list.\n' +
      '2. Read the AGENTS.md in the module directory if one exists; its Invariants are the contract you audit against.\n' +
      '3. Read the module source. Use grep and glob to target the read; never read generated output or lockfiles.\n' +
      '4. Report only defects you can point at. Every finding carries the repository-relative file path and the line number of the code that is wrong.\n' +
      '5. Report an attributeGap for every attribute the module declares at critical or high whose verification list contains no check claiming it, and for every attribute the code clearly needs that the catalog does not declare.\n' +
      '6. Cap the list at ' + maxFindings + ' findings, highest severity first. Do not pad.\n\n' +
      'Severity: critical = data loss, security, privacy or safety breach; major = a stated invariant or requirement is unmet, or a failure mode is unhandled; minor = maintainability; nit = style.\n' +
      'Set confidence to low when you could not read every path the module declares, and say so in a finding.',
      { schema: auditSchema, label: 'audit ' + moduleId },
    ),
    async (report, moduleId) => {
      if (!report) return null
      return agent(
        'De-duplicate and rank one module audit, then verify that every finding is real.\n\n' +
        'Module id: ' + moduleId + '\n' +
        'Audit result as JSON:\n' + JSON.stringify(report) + '\n\n' +
        'Procedure:\n' +
        '1. Open each cited file at the cited line. Drop any finding whose location does not exist, or whose code does not show the defect described. Dropping a wrong finding is the point of this stage.\n' +
        '2. Merge findings that describe the same defect at the same location; keep the highest severity and the clearest recommendation.\n' +
        '3. Rank the survivors: severity first, then blast radius (how many callers reach the defect).\n' +
        '4. Return the same structure. Lower confidence when you dropped more than half the findings.',
        { schema: auditSchema, label: 'verify ' + moduleId },
      )
    },
  )

  const reports = audited.filter(Boolean)
  const lost = modules.length - reports.length
  const allFindings = reports.flatMap(r => r.findings.map(f => ({ module: r.module, ...f })))
  log('surviving findings: ' + allFindings.length + ', modules lost: ' + lost)

  phase('Merge and rank')
  const mergeSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['ranked', 'repeatedPatterns', 'attributeGaps', 'summary'],
    properties: {
      ranked: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rank', 'severity', 'category', 'module', 'file', 'line', 'summary', 'recommendation'],
          properties: { rank: { type: 'number' }, module: { type: 'string' }, ...findingProperties },
        },
      },
      repeatedPatterns: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['pattern', 'modules', 'mechanism'],
          properties: {
            pattern: { type: 'string' },
            modules: { type: 'array', items: { type: 'string' } },
            mechanism: { type: 'string' },
          },
        },
      },
      attributeGaps: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
    },
  }

  const merged = allFindings.length === 0
    ? null
    : await agent(
      'Merge the audits of several modules into one ranked list. Do not read the repository; work from the data.\n\n' +
      'Findings as JSON:\n' + JSON.stringify(allFindings) + '\n\n' +
      'Attribute gaps as JSON:\n' + JSON.stringify(reports.map(r => ({ module: r.module, gaps: r.attributeGaps }))) + '\n\n' +
      'Procedure:\n' +
      '1. Collapse findings that are the same defect reached from several modules into one entry that lists every module.\n' +
      '2. Rank globally: critical before major before minor before nit; within a severity, prefer the finding whose module has the higher riskTier.\n' +
      '3. Set rank to the 1-based position.\n' +
      '4. In repeatedPatterns, list every defect shape that appears in two or more modules, and for each name the strongest mechanism that would stop it returning: a new check id in catalog.checks, a fitness rule in .dsh/base/fitness-rules.json, a step in a skill, or prose. Prefer the strongest one available.\n' +
      '5. attributeGaps is one line per module and attribute that is declared at a blocking tier with no claiming check.\n' +
      '6. summary is at most five sentences and states what a maintainer should do first.',
      { schema: mergeSchema, label: 'merge and rank' },
    )

  return {
    ok: true,
    modulesRequested: modules.length,
    modulesReported: reports.length,
    modulesLost: lost,
    findingCount: allFindings.length,
    perModule: reports.map(r => ({ module: r.module, riskTier: r.riskTier, findings: r.findings.length, confidence: r.confidence })),
    merged,
  }
  // ------------------------------ END SCRIPT BODY ------------------------------
}
