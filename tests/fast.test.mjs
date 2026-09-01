// Fast mode is the feature most likely to hollow out the whole system, so its
// limits are tested rather than trusted: it must expire, refuse the protected
// floor, skip only what was marked in advance, and leave a debt that blocks
// completion until it is repaid.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir } from './helpers.mjs'
import { fastSkippable } from '../.dsh/base/lib/quality.mjs'

function repo () {
  const dir = tempDir('fast')
  const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 't@e.invalid'])
  run(['config', 'user.name', 't'])
  fs.mkdirSync(path.join(dir, 'src', 'api'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'api', 'a.mjs'), 'export const a = 1\n')
  fs.writeFileSync(path.join(dir, 'progress.md'), '# progress.md\n\n## Done\n- seed\n')
  fs.mkdirSync(path.join(dir, '.dsh', 'base'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.dsh', 'base', 'catalog.json'), JSON.stringify({
    version: 1,
    global: [], ignored: [{ path: '.dsh/**', reason: 'tooling' }, { path: 'progress.md', reason: 'memory' }],
    riskChecks: { low: ['slow', 'guard'] },
    checks: {
      slow: { command: 'node -e "process.exit(0)"', class: 'test', attributes: ['reliability'], allowFastSkip: true },
      guard: { command: 'node -e "process.exit(0)"', class: 'security', attributes: ['security'] },
    },
    modules: [{ id: 'api', paths: ['src/api/**'], riskTier: 'low' }],
  }, null, 2))
  run(['add', '-A'])
  run(['commit', '-q', '-m', 'fixture'])
  return { dir, run }
}

test('fast mode refuses to open without a reason', () => {
  const { dir } = repo()
  try {
    const r = dsb(['fast', 'on', '--minutes', '30'], { cwd: dir })
    assert.notEqual(r.code, 0, 'an undated, unexplained loan is never repaid')
    assert.match(r.json.reason, /requires a reason/)
  } finally { rmDir(dir) }
})

test('fast mode opens with an expiry and lists exactly what it will skip', () => {
  const { dir } = repo()
  try {
    const r = dsb(['fast', 'on', '--minutes', '45', '--reason', 'demo at 15:00'], { cwd: dir })
    assert.equal(r.code, 0)
    assert.equal(r.json.record.reason, 'demo at 15:00')
    assert.ok(new Date(r.json.record.until) > new Date())
    assert.deepEqual(r.json.skippable, ['slow'], 'only the check marked in advance, never the protected one')
  } finally { rmDir(dir) }
})

test('a protected check is never skippable however it is configured', () => {
  const catalog = {
    checks: {
      a: { command: 'x', class: 'lint', attributes: ['maintainability'], allowFastSkip: true },
      b: { command: 'x', class: 'security', attributes: ['security'], allowFastSkip: true },
      c: { command: 'x', class: 'test', attributes: ['privacy'], allowFastSkip: true },
      d: { command: 'x', class: 'safety', allowFastSkip: true },
    },
  }
  assert.deepEqual(fastSkippable(catalog), ['a'],
    'security, privacy and safety stay out of reach even when a catalog asks for them')
})

test('a fast gate records what it did not run and cannot close a task', () => {
  const { dir, run } = repo()
  try {
    dsb(['fast', 'on', '--minutes', '30', '--reason', 'release window'], { cwd: dir })
    fs.writeFileSync(path.join(dir, 'src', 'api', 'a.mjs'), 'export const a = 2\n')

    const g = dsb(['gate'], { cwd: dir })
    assert.equal(g.code, 0, 'the gate still passes on what it did run')
    assert.equal(g.json.fastMode, true, 'the record is stamped')
    assert.deepEqual(g.json.skippedByFastMode, ['slow'])
    const guard = g.json.results.find(x => x.id === 'guard')
    assert.equal(guard.status, 'PASS', 'the protected check ran')
    const slow = g.json.results.find(x => x.id === 'slow')
    assert.equal(slow.status, 'SKIPPED')
    assert.equal(slow.reason, 'fast-mode', 'a skip is recorded with its reason, never as a pass')

    const risk = dsb(['risk'], { cwd: dir })
    assert.equal(risk.code, 1)
    assert.ok(risk.json.findings.some(f => f.code === 'FAST_MODE_DEBT'),
      'the debt must be impossible to forget')

    const envelope = JSON.stringify({ id: 'T-1', goal: 'g', scope: 's', outOfScope: 'o', existingPattern: 'p', verification: 'v', escalation: 'e' })
    dsb(['task', 'start'], { cwd: dir, input: envelope })
    const done = dsb(['task', 'complete'], { cwd: dir })
    assert.notEqual(done.code, 0)
    assert.ok((done.json.blockers || []).some(b => /fast mode/.test(b)),
      'a loan against evidence cannot close a task')
  } finally { rmDir(dir) }
})

test('closing fast mode and re-running the gate repays the debt', () => {
  const { dir } = repo()
  try {
    dsb(['fast', 'on', '--minutes', '30', '--reason', 'release window'], { cwd: dir })
    fs.writeFileSync(path.join(dir, 'src', 'api', 'a.mjs'), 'export const a = 2\n')
    dsb(['gate'], { cwd: dir })

    assert.equal(dsb(['fast', 'off'], { cwd: dir }).code, 0)
    const g = dsb(['gate'], { cwd: dir })
    assert.equal(g.json.fastMode, false)
    assert.deepEqual(g.json.skippedByFastMode, [])
    assert.equal(g.json.results.find(x => x.id === 'slow').status, 'PASS')

    const risk = dsb(['risk'], { cwd: dir })
    assert.equal(risk.json.findings.some(f => f.code === 'FAST_MODE_DEBT'), false)
  } finally { rmDir(dir) }
})

test('an expired window stops applying without anyone turning it off', () => {
  const { dir } = repo()
  try {
    dsb(['fast', 'on', '--minutes', '30', '--reason', 'x'], { cwd: dir })
    const p = path.join(dir, '.dsh', 'base', 'state', 'fast-mode.json')
    const rec = JSON.parse(fs.readFileSync(p, 'utf8'))
    rec.until = new Date(Date.now() - 60000).toISOString()
    fs.writeFileSync(p, JSON.stringify(rec))

    const s = dsb(['fast', 'status'], { cwd: dir })
    assert.equal(s.json.active, false)
    assert.equal(s.json.expired, true)

    fs.writeFileSync(path.join(dir, 'src', 'api', 'a.mjs'), 'export const a = 3\n')
    const g = dsb(['gate'], { cwd: dir })
    assert.equal(g.json.fastMode, false, 'an expired window must not still be relaxing the gate')
    assert.equal(g.json.results.find(x => x.id === 'slow').status, 'PASS')
  } finally { rmDir(dir) }
})
