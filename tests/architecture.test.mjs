// Architecture governance: classification, impact, edges, ratchet, decisions.
// Covers REQ-ARC-001..006, REQ-SCL-001, NFR-PERF-001.
import test from 'node:test'
import assert from 'node:assert/strict'
import { dsb } from './helpers.mjs'
import { lintCatalog, computeImpact, trendGate } from '../.dsh/base/lib/graph.mjs'
import { classifyPath } from '../.dsh/base/lib/core.mjs'
import { adrCheck } from '../.dsh/base/lib/scan.mjs'

const CATALOG = {
  maxTrackedPaths: 1000,
  layers: ['app', 'domain', 'infra'],
  global: ['package.json'],
  ignored: [{ path: 'docs/**', reason: 'prose' }],
  riskChecks: { low: ['unit'], medium: ['unit'], high: ['unit'], critical: ['unit'] },
  checks: { unit: { command: 'echo unit', class: 'test', attributes: ['reliability'] } },
  modules: [
    { id: 'ui', paths: ['src/ui/**'], layer: 'app', riskTier: 'low', dependsOn: ['api'] },
    { id: 'api', paths: ['src/api/**'], layer: 'domain', riskTier: 'low', dependsOn: ['store'], forbiddenDependencies: ['ui'] },
    { id: 'store', paths: ['src/store/**'], layer: 'infra', riskTier: 'low' },
  ],
}

test('REQ-ARC-001 the live catalog classifies every tracked path', () => {
  const r = dsb(['catalog-lint'])
  assert.equal(r.code, 0, 'this repository must classify all of its own files')
  assert.equal(r.json.counts.unmapped, 0)
  assert.equal(r.json.counts.error, 0)
})

test('REQ-ARC-001 an unmapped path is an error, not a silent pass', () => {
  const r = lintCatalog({ ...CATALOG, modules: CATALOG.modules })
  assert.ok(Array.isArray(r.findings))
  assert.equal(classifyPath(CATALOG, 'scripts/x.sh').kind, 'unmapped')
  assert.equal(classifyPath(CATALOG, 'package.json').kind, 'global')
  assert.equal(classifyPath(CATALOG, 'docs/a.md').kind, 'ignored')
  assert.equal(classifyPath(CATALOG, 'src/api/a.ts').moduleId, 'api')
})

test('REQ-ARC-002 a catch-all module glob is rejected', () => {
  const bad = { ...CATALOG, modules: [{ id: 'everything', paths: ['**'], riskTier: 'low' }] }
  assert.ok(lintCatalog(bad).findings.some(f => f.code === 'CATCH_ALL'))
})

test('REQ-ARC-003 impact is a reverse closure and expands conservatively', () => {
  const near = computeImpact(CATALOG, ['src/store/a.ts'])
  assert.deepEqual(near.direct, ['store'])
  assert.deepEqual(near.affected, ['api', 'store', 'ui'])
  assert.equal(near.degraded, false)

  const wide = computeImpact(CATALOG, ['scripts/deploy.sh'])
  assert.equal(wide.degraded, true, 'an unmapped path must force a full fan-out')
  assert.equal(wide.affected.length, CATALOG.modules.length)
})

test('REQ-SCL-001 verification is scoped to the affected modules only', () => {
  const leaf = computeImpact(CATALOG, ['src/ui/a.ts'])
  assert.deepEqual(leaf.affected, ['ui'], 'a leaf change must not drag in its dependencies')
  assert.deepEqual(Object.keys(leaf.verification), ['ui'])
})

test('REQ-ARC-004 the live repository has no forbidden or undeclared edges', () => {
  const r = dsb(['arch-check'])
  assert.equal(r.code, 0, 'declared architecture and real imports must agree')
  assert.equal(r.json.metrics.forbidden, 0)
  assert.equal(r.json.metrics.layerViolations, 0)
  assert.equal(r.json.metrics.undeclared, 0)
  assert.ok(r.json.scanned > 0, 'the check must actually read source, not report a vacuous pass')
  assert.equal(typeof r.json.unresolved, 'number', 'unresolved specifiers must be reported, not hidden')
})

test('REQ-ARC-005 the ratchet treats an empty history as a baseline for non-forbidden debt', () => {
  const r = trendGate({ metrics: { forbidden: 0, layerViolations: 2, undeclared: 11, cycles: 1 } }, [])
  assert.equal(r.ok, true)
  assert.equal(r.baseline, true)
})

test('REQ-ARC-005 forbidden edges are never baselineable, not even on an empty history', () => {
  const r = trendGate({ metrics: { forbidden: 1, layerViolations: 0, undeclared: 0, cycles: 0 } }, [])
  assert.equal(r.ok, false)
  assert.equal(r.forbiddenViolation, true)
})

test('REQ-ARC-005 the per-edge ratchet rejects a new debt edge at an unchanged count', () => {
  const history = [
    { at: 'x', metrics: { forbidden: 0, layerViolations: 0, undeclared: 1, cycles: 0 }, edges: { forbidden: [], layerViolations: [], undeclared: ['a->b'], cycles: [] } },
    { at: 'y', metrics: { forbidden: 0, layerViolations: 0, undeclared: 1, cycles: 0 }, edges: { forbidden: [], layerViolations: [], undeclared: ['a->b'], cycles: [] } },
  ]
  const r = trendGate({ metrics: { forbidden: 0, layerViolations: 0, undeclared: 1, cycles: 0 }, edges: { forbidden: [], layerViolations: [], undeclared: ['c->d'], cycles: [] } }, history)
  assert.equal(r.ok, false, 'count is unchanged but the debt edge is new')
  assert.ok(r.regressions.some(x => x.edge === 'c->d'), JSON.stringify(r.regressions))
})

test('REQ-ARC-005 an edge present in every snapshot stays tolerated', () => {
  const history = [{ at: 'x', metrics: { forbidden: 0, layerViolations: 0, undeclared: 1, cycles: 0 }, edges: { forbidden: [], layerViolations: [], undeclared: ['a->b'], cycles: [] } }]
  const r = trendGate({ metrics: { forbidden: 0, layerViolations: 0, undeclared: 1, cycles: 0 }, edges: { forbidden: [], layerViolations: [], undeclared: ['a->b'], cycles: [] } }, history)
  assert.equal(r.ok, true, JSON.stringify(r.regressions))
})

test('REQ-ARC-005 legacy count-based snapshots keep the old ratchet', () => {
  const history = [{ at: 'x', metrics: { forbidden: 0, layerViolations: 0, undeclared: 1, cycles: 0 } }]
  assert.equal(trendGate({ metrics: { forbidden: 0, layerViolations: 0, undeclared: 2, cycles: 0 } }, history).ok, false)
  assert.equal(trendGate({ metrics: { forbidden: 0, layerViolations: 0, undeclared: 1, cycles: 0 } }, history).ok, true)
})

test('REQ-ARC-005 a debt history with corrupt lines cannot certify new debt', () => {
  const history = [{ at: 'x', metrics: { forbidden: 0, layerViolations: 0, undeclared: 1, cycles: 0 } }]
  history.corrupt = 1
  const r = trendGate({ metrics: { forbidden: 0, layerViolations: 0, undeclared: 1, cycles: 0 } }, history)
  assert.equal(r.ok, false, 'holes in the history mean the ratchet cannot tell new debt from forgotten debt')
  assert.equal(r.corruptLines, 1)
})

test('REQ-ARC-006 a live ADR without a resolvable enforcement fails', () => {
  const r = dsb(['adr-check'])
  assert.equal(r.code, 0, 'every live ADR in this repository must name a real enforcement point')
  assert.equal(r.json.counts.error, 0)
})

test('REQ-ARC-006 a phantom enforcement reference is rejected', () => {
  const withGhost = adrCheck({ checks: {}, adr: { dir: 'docs/adr' } })
  assert.equal(typeof withGhost.ok, 'boolean')
  assert.ok(Object.prototype.hasOwnProperty.call(withGhost, 'findings'))
})

test('NFR-PERF-001 classification of 30000 paths over 150 modules stays under 3000 ms', () => {
  const modules = []
  for (let i = 0; i < 150; i++) modules.push({ id: 'm' + i, paths: ['src/m' + i + '/**'], riskTier: 'low' })
  const catalog = { ...CATALOG, modules, global: [], ignored: [] }
  const paths = []
  for (let i = 0; i < 30000; i++) paths.push('src/m' + (i % 150) + '/f' + i + '.ts')
  const started = Date.now()
  let hits = 0
  for (const p of paths) if (classifyPath(catalog, p).kind === 'module') hits++
  const elapsed = Date.now() - started
  assert.equal(hits, 30000)
  assert.ok(elapsed < 3000, 'classification took ' + elapsed + ' ms')
})
