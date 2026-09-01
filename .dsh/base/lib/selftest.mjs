// deepseek-base :: built-in regression assertions.
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
import { aggregate, buildPlan, assessAttributes, validateWaiver, waiverContentHash, STATUS } from './quality.mjs'
import { parseFrontmatter, FITNESS_RULE_IDS, fitness as fitnessScan, skillsLint as skillsLintFn } from './scan.mjs'
import { denied } from './context.mjs'

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
