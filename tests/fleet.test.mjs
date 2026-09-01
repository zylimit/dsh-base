// The fleet layer governs what no single repository can see: the contracts
// between them. These tests pin the findings that distinguish a healthy fleet
// from a distributed monolith.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir, REPO } from './helpers.mjs'

function fleetFixture (mutate) {
  const dir = tempDir('fleet')
  const manifest = {
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
  }
  if (mutate) mutate(manifest)
  for (const repo of manifest.repos) {
    const p = path.join(dir, repo.path)
    fs.mkdirSync(p, { recursive: true })
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: p, windowsHide: true })
  }
  fs.writeFileSync(path.join(dir, 'fleet.json'), JSON.stringify(manifest, null, 2))
  return dir
}

const fleet = (dir, args) => dsb(['fleet', ...args], { cwd: dir })

test('fleet lint accepts a consistent manifest', () => {
  const dir = fleetFixture()
  try {
    const r = fleet(dir, ['lint'])
    assert.equal(r.code, 0, JSON.stringify(r.json && r.json.findings))
    assert.equal(r.json.counts.repos, 3)
    assert.equal(r.json.counts.contracts, 2)
  } finally { rmDir(dir) }
})

test('fleet lint refuses a dependency on a contract nobody publishes', () => {
  const dir = fleetFixture(m => { m.repos[2].consumes.push({ contract: 'ghost.api', version: '1.0' }) })
  try {
    const r = fleet(dir, ['lint'])
    assert.equal(r.code, 1)
    assert.ok(r.json.findings.some(f => f.code === 'DANGLING_CONSUME'))
  } finally { rmDir(dir) }
})

test('fleet lint refuses a deprecation with no sunset date', () => {
  const dir = fleetFixture(m => { m.repos[0].provides[0].status = 'deprecated' })
  try {
    const r = fleet(dir, ['lint'])
    assert.equal(r.code, 1)
    assert.ok(r.json.findings.some(f => f.code === 'DEPRECATED_WITHOUT_SUNSET'),
      'a deprecation nobody has to act on is permanent')
  } finally { rmDir(dir) }
})

test('fleet lint reports a contract cycle as a release-coupling smell', () => {
  const dir = fleetFixture(m => { m.repos[1].consumes.push({ contract: 'orders.api', version: '2.0' }) })
  try {
    const r = fleet(dir, ['lint'])
    assert.ok(r.json.findings.some(f => f.code === 'CONTRACT_CYCLE'),
      'services in a contract cycle cannot be released independently')
  } finally { rmDir(dir) }
})

test('fleet impact states the coordination cost of a breaking change', () => {
  const dir = fleetFixture()
  try {
    const r = fleet(dir, ['impact', 'billing.events'])
    assert.equal(r.code, 0)
    assert.equal(r.json.provider, 'billing')
    assert.deepEqual(r.json.directConsumers, ['orders'])
    assert.deepEqual(r.json.transitiveConsumers, ['web'])
    assert.equal(r.json.coordinationCost, 3)
    assert.match(r.json.advice, /coordinated release/)
  } finally { rmDir(dir) }
})

test('fleet impact on an unknown contract degrades and lists what exists', () => {
  const dir = fleetFixture()
  try {
    const r = fleet(dir, ['impact', 'nope.api'])
    assert.equal(r.code, 3, 'an unknown contract is a degraded answer, never a clean one')
    assert.ok(r.json.known.includes('orders.api'))
  } finally { rmDir(dir) }
})

test('fleet status reports a repository without the scaffold rather than passing it', () => {
  const dir = fleetFixture()
  try {
    const r = fleet(dir, ['status'])
    assert.equal(r.code, 1, 'a bare repository is not a healthy one')
    assert.equal(r.json.rows.length, 3)
    assert.ok(r.json.rows.every(x => x.exists))
    assert.ok(r.json.rows.every(x => x.installed === false))
    assert.deepEqual(r.json.problems.sort(), ['billing', 'orders', 'web'])
  } finally { rmDir(dir) }
})

test('every fleet command degrades without a manifest', () => {
  const dir = tempDir('nofleet')
  try {
    for (const sub of [['lint'], ['status'], ['recap'], ['impact', 'x']]) {
      const r = fleet(dir, sub)
      assert.equal(r.code, 3, 'fleet ' + sub[0] + ' must not report success with no manifest')
      assert.equal(r.json.degraded, true)
    }
  } finally { rmDir(dir) }
})

test('cochange measures coupling and refuses to conclude from a thin history', () => {
  const r = dsb(['cochange'], { cwd: REPO })
  assert.ok(r.json, 'cochange must always produce a machine-readable result')
  assert.equal(typeof r.json.analysed, 'number')
  assert.equal(typeof r.json.sweeping, 'number')
  for (const f of r.json.findings) {
    assert.ok(['LOW_CONFIDENCE', 'BOUNDARY_SUSPECT', 'HIGH_COUPLING', 'ACCEPTED_COUPLING'].includes(f.code), f.code)
  }
  // An accepted coupling carries its reason and never fails the command.
  const accepted = r.json.findings.filter(f => f.code === 'ACCEPTED_COUPLING')
  for (const f of accepted) assert.match(f.message, /accepted: \S/)
})
