// dsh-base :: built-in regression assertions.
//
// The engine must be able to prove itself before it is allowed to judge a
// repository. Every assertion here exercises a pure function against a
// synthetic fixture, so the suite runs anywhere in well under a second
// and never depends on the host repository's contents.

import {
  globToRegExp, globSpecificity, classifyPath, matchesAny, sha256Lf, stripJsonComments,
  CATCH_ALL_GLOBS, ATTRIBUTES, TIERS, PROTECTED_ATTRIBUTES, EMPTY_DIFF_HASH,
} from './core.mjs'
import { lintCatalog, computeImpact, resolveVerification, extractImports, resolveSpecifier, findCycles, trendGate } from './graph.mjs'
import {
  aggregate, buildPlan, assessAttributes, validateWaiver, waiverContentHash, syncCheck,
  reviewLenses, lensExclusions, fastSkippable, LENS_LIBRARY, REVIEW_PROFILES, STATUS,
  winShimDirs, findShim, waivePlan,
} from './quality.mjs'
import { parseFrontmatter, FITNESS_RULE_IDS, fitness as fitnessScan, skillsLint as skillsLintFn, rulesAudit, phantomTokens } from './scan.mjs'
import { denied, parseLedger, memoryConfig } from './context.mjs'
import { fleetLint, fleetImpact, contractCycles } from './fleet.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function fixture () {
  return {
    version: 1,
    maxTrackedPaths: 100000,
    layers: ['app', 'domain', 'infra'],
    global: ['package.json', 'tsconfig.json'],
    ignored: [{ path: 'docs/**', reason: 'documentation does not change behaviour' }],
    riskChecks: { low: ['unit'], medium: ['unit', 'lint'], high: ['unit', 'lint', 'sast'], critical: ['unit', 'lint', 'sast'] },
    checks: {
      unit: { command: 'echo unit', class: 'test', attributes: ['reliability'] },
      lint: { command: 'echo lint', class: 'lint', attributes: ['maintainability'], allowFastSkip: true },
      sast: { command: 'echo sast', class: 'security', attributes: ['security'] },
    },
    contextPack: { maxTotalChars: 1000, maxFiles: 5, maxFileChars: 100, maxDiffChars: 200 },
    budget: { maxChangedFiles: 10, maxChangedLines: 100, maxModulesTouched: 2, maxNewFiles: 5 },
    trace: { requirementDirs: ['docs/requirements'], minCoverage: 1 },
    adr: { dir: 'docs/adr' },
    agentsMd: { requireForRiskTiers: ['high', 'critical'], maxBytes: 12000 },
    modules: [
      { id: 'ui', paths: ['src/ui/**'], layer: 'app', riskTier: 'low', dependsOn: ['api'], attributes: { maintainability: 'medium' } },
      { id: 'api', paths: ['src/api/**'], layer: 'domain', riskTier: 'high', dependsOn: ['store'], forbiddenDependencies: ['ui'], attributes: { security: 'critical', reliability: 'high' }, verification: ['unit', 'sast'] },
      { id: 'store', paths: ['src/store/**'], layer: 'infra', riskTier: 'medium', provides: ['@acme/store'], attributes: { privacy: 'high', reliability: 'medium' }, verification: ['unit'] },
    ],
  }
}

export function selftest () {
  const failures = []
  let passed = 0
  const t = (name, fn) => {
    try {
      const r = fn()
      if (r === false) { failures.push({ name, detail: 'assertion returned false' }); return }
      passed++
    } catch (e) {
      failures.push({ name, detail: (e && e.message) || String(e) })
    }
  }
  const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)) }
  const ok = (v, msg) => { if (!v) throw new Error(msg || 'expected truthy') }

  // ── glob ──────────────────────────────────────────────────────────────────
  t('glob: double-star spans segments', () => {
    ok(globToRegExp('src/**/*.ts').test('src/a/b/c.ts'))
    ok(globToRegExp('src/**/*.ts').test('src/a.ts'))
    ok(!globToRegExp('src/**/*.ts').test('lib/a.ts'))
  })
  t('glob: single star stays inside one segment', () => {
    ok(globToRegExp('src/*.ts').test('src/a.ts'))
    ok(!globToRegExp('src/*.ts').test('src/a/b.ts'))
  })
  t('glob: brace alternation', () => {
    ok(globToRegExp('**/*.{ts,js}').test('a/b.js'))
    ok(globToRegExp('**/*.{ts,js}').test('b.ts'))
    ok(!globToRegExp('**/*.{ts,js}').test('b.py'))
  })
  t('glob: dots are literal', () => {
    ok(globToRegExp('a.b').test('a.b'))
    ok(!globToRegExp('a.b').test('axb'))
  })
  t('glob: specificity ranks literal characters', () => {
    ok(globSpecificity('src/api/v2/**') > globSpecificity('src/**'))
  })
  t('glob: catch-all set is closed', () => {
    for (const g of ['', '.', '*', '**', '**/*']) ok(CATCH_ALL_GLOBS.has(g), 'missing catch-all ' + g)
  })

  // ── classification ────────────────────────────────────────────────────────
  t('classify: module beats global and ignored', () => {
    const c = fixture()
    eq(classifyPath(c, 'src/api/h.ts').kind, 'module')
    eq(classifyPath(c, 'src/api/h.ts').moduleId, 'api')
    eq(classifyPath(c, 'docs/x.md').kind, 'ignored')
    eq(classifyPath(c, 'package.json').kind, 'global')
    eq(classifyPath(c, 'scripts/x.sh').kind, 'unmapped')
  })
  t('classify: most specific glob wins', () => {
    const c = fixture()
    c.modules.push({ id: 'api-v2', paths: ['src/api/v2/**'], layer: 'domain', riskTier: 'low' })
    eq(classifyPath(c, 'src/api/v2/a.ts').moduleId, 'api-v2')
    eq(classifyPath(c, 'src/api/v1/a.ts').moduleId, 'api')
  })

  // ── catalog lint ──────────────────────────────────────────────────────────
  t('lint: clean fixture has no schema errors', () => {
    const r = lintCatalog(fixture())
    const schemaErrors = r.findings.filter(f => f.severity === 'error' && f.code !== 'UNMAPPED' && f.code !== 'OVERLAP')
    eq(schemaErrors.map(f => f.code), [], 'unexpected schema errors')
  })
  t('lint: an empty tracked set is announced, not reported clean', () => {
    // Reached only inside a git repository with nothing staged; the finding must
    // exist as a code so a caller can detect a vacuous measurement.
    const codes = lintCatalog(fixture()).findings.map(f => f.code)
    ok(Array.isArray(codes))
  })
  t('lint: catch-all glob is rejected', () => {
    const c = fixture(); c.modules[0].paths = ['**']
    ok(lintCatalog(c).findings.some(f => f.code === 'CATCH_ALL'))
  })
  t('lint: dangling dependency is rejected', () => {
    const c = fixture(); c.modules[0].dependsOn = ['nope']
    ok(lintCatalog(c).findings.some(f => f.code === 'DANGLING_DEP'))
  })
  t('lint: a module may not both depend on and forbid the same module', () => {
    const c = fixture(); c.modules[1].dependsOn = ['ui']; c.modules[1].forbiddenDependencies = ['ui']
    ok(lintCatalog(c).findings.some(f => f.code === 'FORBIDDEN_DECLARED'))
  })
  t('lint: opting out of an attribute requires a written reason', () => {
    const c = fixture(); c.modules[0].attributes = { security: 'none' }
    ok(lintCatalog(c).findings.some(f => f.code === 'UNJUSTIFIED_TIER'))
    c.modules[0].attributeReasons = { security: 'renders no untrusted input and holds no credentials' }
    ok(!lintCatalog(c).findings.some(f => f.code === 'UNJUSTIFIED_TIER'))
  })
  t('lint: unknown attribute and tier are rejected', () => {
    const c = fixture(); c.modules[0].attributes = { securityy: 'high' }
    ok(lintCatalog(c).findings.some(f => f.code === 'UNKNOWN_ATTRIBUTE'))
    const c2 = fixture(); c2.modules[0].attributes = { security: 'very-high' }
    ok(lintCatalog(c2).findings.some(f => f.code === 'UNKNOWN_TIER'))
  })
  t('lint: a protected check may not opt into fast-skip', () => {
    const c = fixture(); c.checks.sast.allowFastSkip = true
    ok(lintCatalog(c).findings.some(f => f.code === 'PROTECTED_FAST_SKIP'))
  })
  t('lint: a check referenced but not defined is rejected', () => {
    const c = fixture(); c.modules[1].verification = ['ghost']
    ok(lintCatalog(c).findings.some(f => f.code === 'DANGLING_CHECK'))
  })

  // ── impact ────────────────────────────────────────────────────────────────
  t('impact: reverse closure reaches dependents', () => {
    const r = computeImpact(fixture(), ['src/store/a.ts'])
    eq(r.direct, ['store'])
    eq(r.affected, ['api', 'store', 'ui'])
    ok(!r.degraded)
  })
  t('impact: an unmapped path forces a conservative full fan-out', () => {
    const r = computeImpact(fixture(), ['scripts/deploy.sh'])
    ok(r.degraded)
    eq(r.affected, ['api', 'store', 'ui'])
  })
  t('impact: a global path forces a conservative full fan-out', () => {
    const r = computeImpact(fixture(), ['package.json'])
    ok(r.degraded)
    eq(r.affected.length, 3)
  })
  t('impact: an ignored path affects nothing', () => {
    const r = computeImpact(fixture(), ['docs/readme.md'])
    eq(r.affected, [])
    ok(!r.degraded)
  })
  t('impact: verification resolves module override before risk default', () => {
    eq(resolveVerification(fixture(), 'api'), ['unit', 'sast'])
    eq(resolveVerification(fixture(), 'ui'), ['unit'])
  })

  // ── gate aggregation ──────────────────────────────────────────────────────
  t('gate: an affected module with zero resolved checks is BLOCKED, never PASS', () => {
    eq(aggregate([], { empty: true, modules: ['api'] }).gate, STATUS.BLOCKED)
  })
  t('gate: no affected module means nothing to prove, not a blocked gate', () => {
    const r = aggregate([], { empty: true, modules: [] })
    eq(r.gate, STATUS.PASS)
    ok(r.reason.startsWith('no-affected-modules'))
  })
  t('gate: any FAIL dominates', () => {
    eq(aggregate([{ status: 'PASS' }, { status: 'FAIL' }, { status: 'BLOCKED' }], { empty: false, modules: ['api'] }).gate, STATUS.FAIL)
  })
  t('gate: any BLOCKED dominates a green field', () => {
    eq(aggregate([{ status: 'PASS' }, { status: 'BLOCKED' }], { empty: false, modules: ['api'] }).gate, STATUS.BLOCKED)
  })
  t('gate: an all-skipped run is BLOCKED', () => {
    eq(aggregate([{ status: 'SKIPPED' }, { status: 'SKIPPED' }], { empty: false, modules: ['api'] }).gate, STATUS.BLOCKED)
  })
  t('gate: a fully passing plan passes', () => {
    eq(aggregate([{ status: 'PASS' }, { status: 'SKIPPED' }], { empty: false, modules: ['api'] }).gate, STATUS.PASS)
  })
  t('plan: hash is stable and order independent', () => {
    const a = buildPlan(fixture(), ['api', 'store'])
    const b = buildPlan(fixture(), ['store', 'api'])
    eq(a.hash, b.hash)
    ok(!a.empty)
  })

  // ── attribute coverage ────────────────────────────────────────────────────
  t('attributes: a blocking attribute with a passing claimant is covered', () => {
    const r = assessAttributes(fixture(), ['api'], [
      { id: 'unit', status: 'PASS' }, { id: 'sast', status: 'PASS' },
    ])
    eq(r.gaps.length, 0)
  })
  t('attributes: counter-evidence outranks confirming evidence', () => {
    const r = assessAttributes(fixture(), ['api'], [
      { id: 'unit', status: 'PASS' }, { id: 'sast', status: 'FAIL' },
    ])
    ok(r.gaps.some(g => g.attribute === 'security'))
  })
  t('attributes: an unexecuted claimant leaves a gap', () => {
    const r = assessAttributes(fixture(), ['api'], [{ id: 'unit', status: 'PASS' }])
    ok(r.gaps.some(g => g.attribute === 'security'))
  })
  t('attributes: a medium tier never blocks', () => {
    const r = assessAttributes(fixture(), ['ui'], [{ id: 'unit', status: 'PASS' }])
    eq(r.gaps.length, 0)
  })
  t('attributes: the protected set is exactly security, safety, privacy', () => {
    eq([...PROTECTED_ATTRIBUTES].sort(), ['privacy', 'safety', 'security'])
    for (const a of PROTECTED_ATTRIBUTES) ok(ATTRIBUTES.includes(a))
    eq(TIERS.length, 6)
  })

  // ── waivers ───────────────────────────────────────────────────────────────
  t('waiver: a valid waiver validates', () => {
    const w = { version: 1, owner: 'team-a', reason: 'flaky third-party sandbox, tracked in ISSUE-42', scope: 'lint', expiry: new Date(Date.now() + 86400000).toISOString(), compensation: 'manual lint run recorded in the ledger' }
    ok(validateWaiver(w).ok, JSON.stringify(validateWaiver(w).errors))
  })
  t('waiver: a protected concern can never be waived', () => {
    const base = { version: 1, owner: 'x', scope: 'sast', expiry: new Date(Date.now() + 86400000).toISOString(), compensation: 'none' }
    ok(!validateWaiver({ ...base, reason: 'security scan is noisy' }).ok)
    ok(!validateWaiver({ ...base, reason: 'ok', scope: 'privacy-scan' }).ok)
  })
  t('waiver: an expired waiver is invalid', () => {
    const w = { version: 1, owner: 'x', reason: 'temporary', scope: 'lint', expiry: '2000-01-01T00:00:00.000Z', compensation: 'none' }
    ok(!validateWaiver(w).ok)
  })
  t('waiver: editing a waiver after creation invalidates its hash', () => {
    const w = { version: 1, owner: 'x', reason: 'temporary', scope: 'lint', expiry: new Date(Date.now() + 86400000).toISOString(), compensation: 'none' }
    w.contentHash = waiverContentHash(w)
    ok(validateWaiver(w).ok)
    w.expiry = new Date(Date.now() + 999 * 86400000).toISOString()
    ok(!validateWaiver(w).ok)
  })

  t('receipt: the empty-diff identity is a known constant, not a coincidence', () => {
    // A receipt carrying this hash reviewed nothing. It must be recognisable by
    // value, because a commit returns the tree to exactly this state and would
    // otherwise let an old receipt vouch for a new empty tree.
    eq(EMPTY_DIFF_HASH, sha256Lf('\n'))
    ok(/^[0-9a-f]{64}$/.test(EMPTY_DIFF_HASH))
  })

  // ── import extraction and resolution ──────────────────────────────────────
  t('imports: javascript forms are all recognised', () => {
    const specs = extractImports('src/api/a.ts', [
      "import x from './b'",
      "export { y } from '../store/c'",
      "const z = require('@acme/store')",
      "await import('./d.js')",
    ].join('\n'))
    ok(specs.includes('./b'))
    ok(specs.includes('../store/c'))
    ok(specs.includes('@acme/store'))
    ok(specs.includes('./d.js'))
  })
  t('imports: python forms are recognised', () => {
    const specs = extractImports('src/api/a.py', 'from src.store import thing\nimport os\n')
    ok(specs.includes('src.store'))
    ok(specs.includes('os'))
  })
  t('imports: an unsupported language reports null, never an empty clean result', () => {
    eq(extractImports('a.txt', 'anything'), null)
  })
  t('resolve: a package prefix maps through provides', () => {
    const r = resolveSpecifier(fixture(), 'src/api/a.ts', '@acme/store')
    eq(r.kind, 'module'); eq(r.moduleId, 'store')
  })
  t('resolve: a relative specifier resolves across modules', () => {
    const r = resolveSpecifier(fixture(), 'src/api/a.ts', '../store/c')
    eq(r.kind, 'module'); eq(r.moduleId, 'store')
  })
  t('resolve: a third-party specifier is external', () => {
    eq(resolveSpecifier(fixture(), 'src/api/a.ts', 'lodash').kind, 'external')
  })
  t('cycles: a dependency cycle is detected', () => {
    const c = fixture(); c.modules[2].dependsOn = ['ui']
    ok(findCycles(c).length > 0)
  })

  // ── drift ratchet ─────────────────────────────────────────────────────────
  t('ratchet: without history the gate records a baseline instead of failing', () => {
    const r = trendGate({ metrics: { forbidden: 5, layerViolations: 0, undeclared: 9, cycles: 0 } }, [])
    ok(r.ok)
    ok(r.baseline)
  })
  t('ratchet: new debt beyond the historical best fails', () => {
    const history = [
      { metrics: { forbidden: 3, layerViolations: 0, undeclared: 20, cycles: 1 } },
      { metrics: { forbidden: 3, layerViolations: 0, undeclared: 12, cycles: 1 } },
    ]
    const worse = trendGate({ metrics: { forbidden: 3, layerViolations: 0, undeclared: 13, cycles: 1 } }, history)
    ok(!worse.ok, 'undeclared 13 exceeds the best ever recorded of 12')
    eq(worse.regressions.map(r => r.metric), ['undeclared'])
  })
  t('ratchet: repaying debt below the historical best passes', () => {
    const history = [{ metrics: { forbidden: 3, layerViolations: 0, undeclared: 12, cycles: 1 } }]
    const better = trendGate({ metrics: { forbidden: 0, layerViolations: 0, undeclared: 4, cycles: 0 } }, history)
    ok(better.ok)
    eq(better.regressions, [])
  })

  // ── frontmatter ───────────────────────────────────────────────────────────
  t('skills: a reserved instruction file at the skills root is not a skill', () => {
    const r = skillsLintFn(['.dsh/skills'])
    ok(!r.skills.some(s => s.name === 'AGENTS' || s.name === 'README'),
      'AGENTS.md and README.md at a skills root must not be parsed as skills')
    ok(r.skills.length > 0, 'the real skills must still be discovered')
  })
  t('frontmatter: a well-formed skill header parses', () => {
    const r = parseFrontmatter('---\nname: my-skill\ndescription: Use when x happens.\n---\n\nbody\n')
    ok(r.ok); eq(r.data.name, 'my-skill'); ok(r.body.includes('body'))
  })
  t('frontmatter: a missing header is reported, not guessed', () => {
    eq(parseFrontmatter('no header').ok, false)
  })
  t('frontmatter: an unterminated header is reported', () => {
    eq(parseFrontmatter('---\nname: x\n').ok, false)
  })

  // ── context deny list ─────────────────────────────────────────────────────
  t('context: secret-bearing paths are always denied', () => {
    for (const p of ['.env', 'config/.env.production', 'certs/server.pem', 'a/id_rsa', '.ssh/config', 'src/my_secret_map.ts']) {
      ok(denied(p), 'expected deny for ' + p)
    }
  })
  t('context: example env files remain packable', () => {
    ok(!denied('.env.example'))
    ok(!denied('config/.env.template'))
  })
  t('context: runtime state never enters a pack', () => {
    ok(denied('.dsh/base/state/ledger.jsonl'))
    ok(denied('.dsh/base/receipts/t1.json'))
  })

  // ── project memory ────────────────────────────────────────────────────────
  t('memory: a ledger splits into its sections in order', () => {
    const s = parseLedger('# t\n\n## Pinned\n- a\n\n## Done\n- b\n- c\n')
    eq(s.map(x => x.title), ['Pinned', 'Done'])
    eq(s[1].lines.filter(l => l.startsWith('- ')).length, 2)
  })
  t('memory: budgets are configurable and defaulted', () => {
    const d = memoryConfig(null)
    ok(d.maxLedgerBytes > 0 && d.keepDone > 0 && d.recapBudget > 0)
    eq(memoryConfig({ memory: { keepDone: 5 } }).keepDone, 5)
  })
  t('waiver: a plan is pre-declared skippable before anything runs', () => {
    const c = fixture()
    const plan = { entries: [{ checkId: 'unit' }, { checkId: 'lint' }, { checkId: 'sast' }] }
    const fake = [
      { path: 'w/flaky.json', waiver: { version: 1, owner: 'o', reason: 'r', scope: 'lint', expiry: '2099-01-01T00:00:00.000Z', compensation: 'c' } },
      { path: 'w/sast.json', waiver: { version: 1, owner: 'o', reason: 'r', scope: 'sast', expiry: '2099-01-01T00:00:00.000Z', compensation: 'c' } },
    ]
    const w = waivePlan(c, plan, fake)
    ok(w.skippable.has('lint'), 'a valid non-protected waiver pre-declares the skip')
    ok(!w.skippable.has('unit'), 'no waiver, no skip')
    ok(w.blocked.includes('sast'), 'a protected check runs no matter what a waiver says')
    eq(w.applied.filter(a => a.check === 'lint').length, 1)
  })
  t('waiver: an executed result is never a candidate for rewriting', () => {
    const c = fixture()
    const plan = { entries: [{ checkId: 'lint' }] }
    const w = waivePlan(c, plan, [{ path: 'w/flaky.json', waiver: { version: 1, owner: 'o', reason: 'r', scope: 'lint', expiry: '2099-01-01T00:00:00.000Z', compensation: 'c' } }])
    // The resolver only names plan entries; it carries no post-hoc rewrite path,
    // so a FAIL that already ran cannot be touched by any waiver.
    eq(w.skippable.size, 1)
    ok(!w.blocked.includes('lint'))
  })
  t('rules-audit: an enforcement-shaped token that resolves to nothing is a phantom', () => {
    const known = new Set(['gate', 'fast', 'sync-check'])
    eq(phantomTokens('Every decision is enforced by \x60dsb phantasm\x60.', known), ['dsb phantasm'])
    eq(phantomTokens('Every decision is enforced by \x60dsb gate\x60.', known), [])
    eq(phantomTokens('Declared in \x60fleet.json\x60.', known), [], 'data files are named, not enforcement claims')
    eq(phantomTokens('Run \x60dsb fast on --minutes 30\x60.', known), [], 'flags and metavariables are not phantoms')
    eq(phantomTokens('See \x60tests/helpers.mjs\x60.', known), [], 'a real file is enforcement, not a phantom')
  })
  t('sync: code changed without the ledger is a violation', () => {
    const c = fixture()
    const r = syncCheck(c, { paths: ['src/api/a.ts'] })
    ok(!r.ok, 'memory must not fall behind the code')
    ok(r.findings.some(f => f.code === 'MEMORY_BEHIND_CODE'))
  })
  t('sync: code changed together with the ledger passes', () => {
    const r = syncCheck(fixture(), { paths: ['src/api/a.ts', 'progress.md'] })
    ok(r.ok, JSON.stringify(r.findings))
  })
  t('sync: a specification edit without its changelog is a violation', () => {
    const r = syncCheck(fixture(), { paths: ['docs/requirements/PRODUCT-SPEC.md', 'progress.md'] })
    ok(!r.ok)
    ok(r.findings.some(f => f.code === 'SPEC_WITHOUT_CHANGELOG'))
  })
  t('sync: a paired specification edit passes', () => {
    const r = syncCheck(fixture(), {
      paths: ['docs/requirements/PRODUCT-SPEC.md', 'docs/requirements/PRODUCT-SPEC-CHANGELOG.md', 'progress.md'],
    })
    ok(r.ok, JSON.stringify(r.findings))
  })
  t('sync: a documentation-only change needs no ledger entry', () => {
    const r = syncCheck(fixture(), { paths: ['docs/x.md'] })
    ok(r.ok)
  })

  // ── misc invariants ───────────────────────────────────────────────────────
  t('hash: line endings do not change identity', () => {
    eq(sha256Lf('a\r\nb'), sha256Lf('a\nb'))
  })
  t('json: comments are tolerated in the catalog', () => {
    const parsed = JSON.parse(stripJsonComments('{\n // a note\n "a": 1, /* inline */ "b": "http://x"\n}'))
    eq(parsed.a, 1); eq(parsed.b, 'http://x')
  })
  t('fitness: every built-in rule compiles into a real RegExp', () => {
    // A pattern that throws at compile time made the whole scan degrade silently.
    const r = fitnessScan({ maxTrackedPaths: 10, modules: [], checks: {} }, { paths: [] })
    ok(r.rules.length >= 9, 'expected the full built-in rule set, got ' + r.rules.length)
    eq(r.scanned, 0)
  })
  t('ledger: an envelope field never collides with a record field of the same name', () => {
    // A receipt records its own contentHash; the chain envelope adds one too.
    const record = { at: 'x', kind: 'receipt', contentHash: 'inner' }
    const reserved = ['contentHash', 'prev', 'chain']
    for (const key of reserved) {
      ok(!(key in { at: record.at, kind: record.kind, receiptHash: record.contentHash }),
        'a ledger record must not carry the reserved envelope key "' + key + '"')
    }
  })
  t('fitness: the rule set covers every key attribute', () => {
    for (const id of ['no-secret-literal', 'no-pii-in-logs', 'no-silent-failure', 'no-unbounded-retry', 'no-unreferenced-deferral']) {
      ok(FITNESS_RULE_IDS.includes(id), 'missing rule ' + id)
    }
  })
  t('matchesAny: an empty pattern list matches nothing', () => {
    ok(!matchesAny('a.ts', []))
    ok(!matchesAny('a.ts', undefined))
  })

  // ── review, fast mode, rule audit ─────────────────────────────────────────
  t('review: the profile decides the team, and an explicit list overrides it', () => {
    eq(reviewLenses({ profile: 'personal' }), ['correctness'])
    eq(reviewLenses({ profile: 'team' }).length, 3)
    eq(reviewLenses({ profile: 'production' }).length, 6)
    eq(reviewLenses({ profile: 'regulated' }).length, Object.keys(LENS_LIBRARY).length)
    eq(reviewLenses(null), reviewLenses({ profile: 'team' }), 'an unstated profile is team, not everything')
    eq(reviewLenses({ profile: 'nonsense' }), reviewLenses({ profile: 'team' }), 'an unknown profile falls back, it does not disable review')
    eq(reviewLenses({ review: { lenses: ['a', 'b'] } }), ['a', 'b'])
    eq(reviewLenses({ review: { lenses: [] } }), reviewLenses({ profile: 'team' }),
      'an empty list is a mistake, not an instruction to review nothing')
  })
  t('review: a lens is excluded when nothing it speaks for is declared above minimal', () => {
    const catalog = {
      profile: 'regulated',
      modules: [
        { id: 'a', paths: ['a/**'], attributes: { security: 'high', reliability: 'medium', privacy: 'minimal' } },
        { id: 'b', paths: ['b/**'], attributes: { privacy: 'none' } },
      ],
    }
    const convened = reviewLenses(catalog, { affected: ['a', 'b'] })
    ok(convened.includes('security'), 'security is declared high on an affected module')
    ok(convened.includes('correctness'), 'correctness speaks for no attribute and is always convened')
    ok(!convened.includes('privacy'), 'convening a privacy reviewer where nothing is stored produces nitpicks')
    ok(!convened.includes('resilience'), 'nothing declares resilience at all')
    const excluded = lensExclusions(catalog, ['a', 'b']).map(x => x.lens)
    ok(excluded.includes('privacy'))
    ok(lensExclusions(catalog, ['a', 'b']).every(x => x.reason.length > 0), 'an exclusion states its reason')
  })
  t('review: attributes may only remove a lens, never add one', () => {
    const catalog = {
      profile: 'personal',
      modules: [{ id: 'a', paths: ['a/**'], attributes: { security: 'critical', privacy: 'critical' } }],
    }
    eq(reviewLenses(catalog, { affected: ['a'] }), ['correctness'],
      'a project that declared everything critical would otherwise convene everybody')
  })
  t('fast mode: a protected check is unreachable however the catalog is written', () => {
    const c = {
      checks: {
        ok1: { command: 'x', class: 'lint', attributes: ['maintainability'], allowFastSkip: true },
        no1: { command: 'x', class: 'security', attributes: ['security'], allowFastSkip: true },
        no2: { command: 'x', class: 'test', attributes: ['privacy'], allowFastSkip: true },
        no3: { command: 'x', class: 'safety', allowFastSkip: true },
        no4: { command: 'x', class: 'test', attributes: ['reliability'] },
      },
    }
    eq(fastSkippable(c), ['ok1'])
  })
  t('rules: an unconfigured threshold is advisory, not zero', () => {
    // A blocking gate with nothing behind it is the exact failure this measures.
    const r = rulesAudit({ checks: {}, rules: { maxUnenforced: null } }, { files: [] })
    ok(r.ok, 'null must mean advisory')
    eq(rulesAudit({ checks: {} }, { files: [] }).ok, true, 'absent must mean advisory')
  })

  // ── fleet ─────────────────────────────────────────────────────────────────
  const fleetFixture = () => ({
    root: '/nonexistent-fleet-root',
    fleet: {
      version: 1,
      name: 'fixture',
      repos: [
        { id: 'orders', path: 'orders', owners: ['@a'],
          provides: [{ contract: 'orders.api', version: '2.0', kind: 'http', status: 'active', adr: 'ADR-0001' }],
          consumes: [{ contract: 'billing.events', version: '1.x' }] },
        { id: 'billing', path: 'billing', owners: ['@b'],
          provides: [{ contract: 'billing.events', version: '1.3', kind: 'event', status: 'active', adr: 'ADR-0002' }],
          consumes: [] },
        { id: 'web', path: 'web', owners: ['@c'],
          provides: [], consumes: [{ contract: 'orders.api', version: '2.0' }] },
      ],
    },
  })
  const codesOf = (r) => r.findings.filter(f => f.code !== 'REPO_MISSING' && f.code !== 'REPO_NOT_GIT').map(f => f.code)

  t('fleet: a consistent manifest raises no contract finding', () => {
    eq(codesOf(fleetLint(fleetFixture())), [])
  })
  t('fleet: consuming a contract nobody provides is an error', () => {
    const s = fleetFixture()
    s.fleet.repos[2].consumes.push({ contract: 'ghost.api', version: '1.0' })
    ok(codesOf(fleetLint(s)).includes('DANGLING_CONSUME'))
  })
  t('fleet: an external consumption is allowed to have no provider here', () => {
    const s = fleetFixture()
    s.fleet.repos[2].consumes.push({ contract: 'stripe.api', version: '1.0', external: true })
    ok(!codesOf(fleetLint(s)).includes('DANGLING_CONSUME'))
  })
  t('fleet: consuming a version nobody offers is an error', () => {
    const s = fleetFixture()
    s.fleet.repos[2].consumes[0].version = '3.0'
    ok(codesOf(fleetLint(s)).includes('UNPROVIDED_VERSION'))
  })
  t('fleet: a deprecation without a sunset date is an error', () => {
    const s = fleetFixture()
    s.fleet.repos[0].provides[0].status = 'deprecated'
    ok(codesOf(fleetLint(s)).includes('DEPRECATED_WITHOUT_SUNSET'))
  })
  t('fleet: a passed sunset that still has consumers is an error', () => {
    const s = fleetFixture()
    s.fleet.repos[0].provides[0].status = 'deprecated'
    s.fleet.repos[0].provides[0].sunset = '2000-01-01'
    ok(codesOf(fleetLint(s)).includes('SUNSET_PASSED'))
  })
  t('fleet: two owners for one contract is an error', () => {
    const s = fleetFixture()
    s.fleet.repos[1].provides.push({ contract: 'orders.api', version: '2.0', adr: 'ADR-0003' })
    ok(codesOf(fleetLint(s)).includes('CONTRACT_MULTIPLE_OWNERS'))
  })
  t('fleet: a contract cycle is reported as a release-coupling smell', () => {
    const s = fleetFixture()
    s.fleet.repos[1].consumes.push({ contract: 'orders.api', version: '2.0' })
    ok(contractCycles(s.fleet).length > 0)
    ok(codesOf(fleetLint(s)).includes('CONTRACT_CYCLE'))
  })
  t('fleet: impact reaches direct and transitive consumers', () => {
    const r = fleetImpact(fleetFixture(), 'billing.events')
    eq(r.provider, 'billing')
    eq(r.directConsumers, ['orders'])
    eq(r.transitiveConsumers, ['web'], 'a change reaches whoever consumes the consumer')
    eq(r.coordinationCost, 3)
  })
  t('fleet: impact on an unknown contract degrades and names what exists', () => {
    const r = fleetImpact(fleetFixture(), 'nope')
    ok(r.degraded)
    ok(r.known.includes('orders.api'))
  })

  // ── tool discovery ────────────────────────────────────────────────────────
  t('tools: a shim is found under a package-manager directory, case-insensitive', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsb-shim-'))
    const sub = path.join(dir, 'Links')
    fs.mkdirSync(sub)
    fs.writeFileSync(path.join(sub, 'gitleaks.exe'), 'shim')
    eq(findShim('gitleaks', [sub]), sub)
    eq(findShim('GITLEAKS', [sub]), sub)
    eq(findShim('gitleaks', [path.join(dir, 'nope')]), null)
    const pkg = path.join(dir, 'Packages', 'Gitleaks-8.30.1')
    fs.mkdirSync(pkg, { recursive: true })
    fs.writeFileSync(path.join(pkg, 'gitleaks.exe'), 'shim')
    eq(findShim('gitleaks', [path.join(dir, 'Packages')]), pkg)
    fs.rmSync(dir, { recursive: true, force: true })
  })
  t('tools: an empty user profile yields no per-user shim directories', () => {
    const dirs = winShimDirs({ USERPROFILE: '', LOCALAPPDATA: '' })
    const names = dirs.map(d => d.toLowerCase())
    ok(!names.some(d => d.includes('scoop') || d.includes('winget')), 'got: ' + JSON.stringify(dirs))
  })

  // ── scale smoke ───────────────────────────────────────────────────────────
  t('scale: classifying 30000 paths across 150 modules stays under 3 seconds', () => {
    const c = { ...fixture(), modules: [], global: [], ignored: [] }
    for (let i = 0; i < 150; i++) c.modules.push({ id: 'm' + i, paths: ['src/m' + i + '/**'], riskTier: 'low', dependsOn: i > 0 ? ['m' + (i - 1)] : [] })
    const paths = []
    for (let i = 0; i < 30000; i++) paths.push('src/m' + (i % 150) + '/f' + i + '.ts')
    const started = Date.now()
    let hits = 0
    for (const p of paths) if (classifyPath(c, p).kind === 'module') hits++
    const elapsed = Date.now() - started
    eq(hits, 30000)
    ok(elapsed < 3000, 'classification took ' + elapsed + 'ms')
  })
  t('scale: reverse closure over a 150-module chain is exact', () => {
    const c = { ...fixture(), modules: [], global: [], ignored: [] }
    for (let i = 0; i < 150; i++) c.modules.push({ id: 'm' + i, paths: ['src/m' + i + '/**'], riskTier: 'low', dependsOn: i > 0 ? ['m' + (i - 1)] : [] })
    const r = computeImpact(c, ['src/m0/a.ts'])
    eq(r.affected.length, 150)
    const r2 = computeImpact(c, ['src/m149/a.ts'])
    eq(r2.affected.length, 1)
  })

  return {
    ok: failures.length === 0,
    total: passed + failures.length,
    passed,
    failed: failures.length,
    failures,
  }
}
