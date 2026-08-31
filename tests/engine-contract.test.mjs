// Engine contract: exit codes, degradation, and the four check states.
// Covers REQ-GOV-001, REQ-GOV-002, REQ-GOV-003, REQ-GOV-004,
//        NFR-RES-001, NFR-REL-001, NFR-AVAIL-001.
import test from 'node:test'
import assert from 'node:assert/strict'
import { dsb, tempDir, rmDir } from './helpers.mjs'
import { aggregate, runCheck, STATUS } from '../.dsh/base/lib/quality.mjs'

test('REQ-GOV-001 governance is silent when no catalog is present', () => {
  const dir = tempDir('nocatalog')
  try {
    const r = dsb(['catalog-lint'], { cwd: dir })
    assert.equal(r.code, 3, 'a missing catalog must degrade, not pass')
    assert.equal(r.json.degraded, true)
    assert.ok(String(r.json.reason).length > 0, 'degradation must state a reason')
  } finally { rmDir(dir) }
})

test('REQ-GOV-002 a degraded capability never exits 0', () => {
  const dir = tempDir('nogit')
  try {
    for (const cmd of ['catalog-lint', 'impact', 'gate', 'arch-check', 'trace']) {
      const r = dsb([cmd], { cwd: dir })
      assert.notEqual(r.code, 0, cmd + ' must not report success outside a governed repository')
    }
  } finally { rmDir(dir) }
})

test('REQ-GOV-003 a check with no command is BLOCKED, never PASS', () => {
  const r = runCheck('undefined-check', undefined, {})
  assert.equal(r.status, STATUS.BLOCKED)
  assert.equal(r.reason, 'check-undefined-or-empty-command')
})

test('REQ-GOV-003 a check whose executable is absent is BLOCKED, never PASS', () => {
  const r = runCheck('ghost', { command: 'dsb-definitely-not-a-real-binary-9f2a --version' }, {})
  assert.equal(r.status, STATUS.BLOCKED)
  assert.match(r.reason, /^command-missing:/)
})

test('REQ-GOV-004 an empty verification plan is BLOCKED', () => {
  assert.equal(aggregate([], { empty: true }).gate, STATUS.BLOCKED)
})

test('REQ-GOV-004 aggregation order is FAIL, then BLOCKED, then all-skipped', () => {
  assert.equal(aggregate([{ status: 'PASS' }, { status: 'FAIL' }, { status: 'BLOCKED' }], { empty: false }).gate, 'FAIL')
  assert.equal(aggregate([{ status: 'PASS' }, { status: 'BLOCKED' }], { empty: false }).gate, 'BLOCKED')
  assert.equal(aggregate([{ status: 'SKIPPED' }], { empty: false }).gate, 'BLOCKED')
  assert.equal(aggregate([{ status: 'PASS' }, { status: 'SKIPPED' }], { empty: false }).gate, 'PASS')
})

test('NFR-RES-001 every degraded path answers quickly and marks itself degraded', () => {
  const dir = tempDir('degraded')
  try {
    const started = Date.now()
    const r = dsb(['impact'], { cwd: dir })
    assert.ok(Date.now() - started < 10000, 'a degraded answer must still be produced promptly')
    assert.equal(r.code, 3)
    assert.equal(r.json.degraded, true)
  } finally { rmDir(dir) }
})

test('NFR-REL-001 the engine self-test passes with zero failures', () => {
  const r = dsb(['selftest'])
  assert.equal(r.code, 0)
  assert.equal(r.json.failed, 0)
  assert.ok(r.json.total >= 50, 'the self-test must actually cover the engine, not merely exist')
})

test('NFR-AVAIL-001 doctor always exits 0 so diagnosis never blocks work', () => {
  const r = dsb(['doctor'])
  assert.equal(r.code, 0)
  assert.ok(Array.isArray(r.json.checks) && r.json.checks.length > 0)
})

test('an unknown subcommand degrades instead of crashing', () => {
  const r = dsb(['not-a-subcommand'])
  assert.equal(r.code, 3)
  assert.equal(r.json.ok, false)
})
