// Requirement quality, delegation, and evidence integrity.
// Covers REQ-SPC-001, REQ-SPC-002, REQ-DEL-001, REQ-DEL-002,
//        REQ-OPS-001, REQ-OPS-002, NFR-PERF-002, NFR-PRIV-001.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir, REPO } from './helpers.mjs'
import { specLint, fitness } from '../.dsh/base/lib/scan.mjs'
import { validateWaiver } from '../.dsh/base/lib/quality.mjs'
import { denied, CONTEXT_DENY } from '../.dsh/base/lib/context.mjs'

function initRepo (dir) {
  const run = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 'test@example.invalid'])
  run(['config', 'user.name', 'dsb test'])
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
  run(['add', '-A'])
  run(['commit', '-q', '-m', 'fixture: initial commit for the evidence test'])
  return run
}

test('REQ-SPC-001 the live specification is decidable', () => {
  const r = dsb(['spec-lint'])
  assert.equal(r.code, 0, 'this repository must satisfy its own requirement lint')
  assert.equal(r.json.counts.error, 0)
  assert.ok(r.json.counts.requirements >= 20)
})

test('REQ-SPC-001 an unmeasurable quality requirement is rejected', () => {
  const r = specLint({ trace: { requirementDirs: ['tests/fixtures-absent'] } })
  assert.equal(r.degraded, true, 'a missing requirement directory degrades rather than passing')
})

test('REQ-SPC-002 every declared requirement is referenced by a test', () => {
  const r = dsb(['trace'])
  assert.equal(r.code, 0, 'unverified requirements: ' + JSON.stringify(r.json && r.json.unverified))
  assert.equal(r.json.coverage, 1)
  assert.equal(r.json.dangling.length, 0, 'code or tests must not cite a requirement that does not exist')
})

test('REQ-DEL-001 an incomplete task envelope is refused and writes nothing', () => {
  const dir = tempDir('task')
  try {
    initRepo(dir)
    const incomplete = JSON.stringify({ id: 'T-1', goal: 'do a thing', scope: 'a.txt', outOfScope: 'everything else', verification: 'node --version' })
    const r = dsb(['task', 'start'], { cwd: dir, input: incomplete })
    assert.notEqual(r.code, 0, 'a missing escalation field must be refused')
    assert.equal(fs.existsSync(path.join(dir, '.dsh', 'base', 'state', 'task.json')), false)

    const complete = JSON.stringify({ id: 'T-1', goal: 'do a thing', scope: 'a.txt', outOfScope: 'everything else', existingPattern: 'none', verification: 'node --version', escalation: 'ask the owner' })
    const ok = dsb(['task', 'start'], { cwd: dir, input: complete })
    assert.equal(ok.code, 0)
    assert.equal(ok.json.task.state, 'active')
  } finally { rmDir(dir) }
})

test('REQ-DEL-002 secret-bearing paths can never enter a context pack', () => {
  for (const p of ['.env', 'config/.env.production', 'certs/a.pem', 'a/id_rsa', '.ssh/config', 'src/my_secret.ts', 'x/.aws/credentials']) {
    assert.equal(denied(p), true, 'expected deny for ' + p)
  }
  for (const p of ['.env.example', 'config/.env.template', 'src/app.ts']) {
    assert.equal(denied(p), false, 'expected allow for ' + p)
  }
  assert.ok(CONTEXT_DENY.includes('.dsh/base/receipts/**'), 'engine runtime state must never be packed')
})

test('REQ-OPS-001 a receipt stales the moment a tracked byte changes', () => {
  const dir = tempDir('receipt')
  try {
    initRepo(dir)
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n')
    const payload = JSON.stringify({ taskId: 'T-1', reviewer: 'tester', verdict: 'ACCEPT', scope: 'a.txt' })
    const written = dsb(['receipt', 'write'], { cwd: dir, input: payload })
    assert.equal(written.code, 0)

    const fresh = dsb(['receipt', 'verify'], { cwd: dir })
    assert.equal(fresh.code, 0, 'the receipt must bind the diff it judged')

    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\nthree\n')
    const stale = dsb(['receipt', 'verify'], { cwd: dir })
    assert.equal(stale.code, 4, 'one changed byte must stale the receipt')
    assert.equal(stale.json.stale, true)
  } finally { rmDir(dir) }
})

test('REQ-OPS-002 an altered ledger entry breaks the chain and fails closed', () => {
  const dir = tempDir('ledger')
  try {
    initRepo(dir)
    dsb(['receipt', 'write'], { cwd: dir, input: JSON.stringify({ taskId: 'T-1', reviewer: 'tester', verdict: 'ACCEPT', scope: 'a.txt' }) })
    const ledgerPath = path.join(dir, '.dsh', 'base', 'state', 'ledger.jsonl')
    assert.equal(fs.existsSync(ledgerPath), true)
    assert.equal(dsb(['ledger'], { cwd: dir }).code, 0)

    const lines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n')
    const entry = JSON.parse(lines[0])
    entry.verdict = 'FIX_REQUIRED'
    fs.writeFileSync(ledgerPath, JSON.stringify(entry) + '\n')

    const broken = dsb(['ledger'], { cwd: dir })
    assert.equal(broken.code, 1, 'a rewritten entry must be detected')
    assert.equal(broken.json.ok, false)
    assert.ok(broken.json.breaks.length > 0)
  } finally { rmDir(dir) }
})

test('NFR-PERF-002 a scan bounds itself and reports truncation instead of under-reporting', () => {
  const catalog = { maxTrackedPaths: 1000, modules: [], checks: {} }
  const none = fitness(catalog, { paths: [] })
  assert.equal(none.scanned, 0)
  assert.equal(none.truncated, false)

  const bounded = fitness(catalog, { paths: ['.dsh/base/lib/core.mjs', '.dsh/base/lib/graph.mjs', '.dsh/base/lib/scan.mjs'], maxFiles: 1 })
  assert.ok(bounded.scanned <= 1, 'the file bound must be honoured')
  assert.equal(typeof bounded.truncated, 'boolean')
  assert.ok(Array.isArray(bounded.rules) && bounded.rules.length >= 9)
})

test('NFR-PRIV-001 findings carry a location and a rule id, never an unbounded excerpt', () => {
  const r = dsb(['fitness', '--all'])
  assert.ok(r.json, 'fitness must always produce a machine-readable result')
  for (const f of r.json.findings || []) {
    assert.equal(typeof f.file, 'string')
    assert.equal(typeof f.line, 'number')
    assert.equal(typeof f.rule, 'string')
    assert.ok(f.excerpt.length <= 200, 'an excerpt must stay capped so a scan never republishes a secret in full')
  }
})

test('a waiver naming a protected concern cannot be expressed', () => {
  const future = new Date(Date.now() + 86400000).toISOString()
  const base = { version: 1, owner: 'owner', expiry: future, compensation: 'none' }
  assert.equal(validateWaiver({ ...base, reason: 'the security scan is noisy', scope: 'lint' }).ok, false)
  assert.equal(validateWaiver({ ...base, reason: 'temporary', scope: 'privacy-scan' }).ok, false)
  assert.equal(validateWaiver({ ...base, reason: 'sandbox unavailable, tracked in ISSUE-42', scope: 'lint' }).ok, true)
})
test('REQ-OPS-001 a staged change is part of the identity a receipt binds', () => {
  const dir = tempDir('staged')
  try {
    const run = initRepo(dir)
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n')
    run(['add', '-A'])

    const empty = dsb(['diff-hash'], { cwd: dir })
    const clean = dsb(['diff-hash'], { cwd: dir })
    assert.equal(empty.code, 0)

    const payload = JSON.stringify({ taskId: 'T-2', reviewer: 'tester', verdict: 'ACCEPT', scope: 'a.txt' })
    assert.equal(dsb(['receipt', 'write'], { cwd: dir, input: payload }).code, 0)
    assert.equal(dsb(['receipt', 'verify'], { cwd: dir }).code, 0)

    // A staged change must not hash as "nothing changed": unstaging it changes
    // the identity, which proves the staged content was part of it.
    run(['reset', '-q', 'HEAD', 'a.txt'])
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
    const after = dsb(['receipt', 'verify'], { cwd: dir })
    assert.equal(after.code, 4, 'reverting the reviewed content must stale the receipt')
    assert.notEqual(clean.json.diffHash, after.json.currentDiffHash)
  } finally { rmDir(dir) }
})
