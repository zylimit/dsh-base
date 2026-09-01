// Release readiness is where the engine's refusal to fake evidence pays off:
// the command never tags or pushes, it only proves the conditions a human signs
// on. These tests pin the conditions and the boundary.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir } from './helpers.mjs'

// Assembled, never written literally: this file is itself scanned by the outer
// repository's trace, and a literal id here would be a dangling reference.
const RC = 'REQ-' + 'CALC-001'

function repo () {
  const dir = tempDir('release')
  const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 't@e.invalid'])
  run(['config', 'user.name', 't'])
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'docs', 'requirements'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), '// implements ' + RC + '\nexport const a = 1\n')
  fs.writeFileSync(path.join(dir, 'src', 'a.test.mjs'), '// verifies ' + RC + '\nexport const t = 1\n')
  fs.writeFileSync(path.join(dir, 'docs', 'requirements', 'PRODUCT-SPEC.md'), [
    '# spec', '',
    '### ' + RC + ' - one', '',
    'WHEN the program runs, the system SHALL return one.', '',
    'Acceptance: the value is 1.', '',
    'resilience security safety privacy reliability are declared in scope with tests.', '',
  ].join('\n'))
  fs.writeFileSync(path.join(dir, 'docs', 'requirements', 'PRODUCT-SPEC-CHANGELOG.md'), '# changelog\n')
  fs.writeFileSync(path.join(dir, 'progress.md'), '# progress.md\n')
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
    '# constitution', '', '## Purpose', 'fixture.', '',
    '## Boundaries', 'none.', '', '## Invariants', 'honesty.', '',
    '## Verification', 'node --test.', '',
  ].join('\n'))
  fs.mkdirSync(path.join(dir, '.dsh', 'base'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.dsh', 'base', 'catalog.json'), JSON.stringify({
    version: 1,
    global: [], ignored: [{ path: '.dsh/**', reason: 'x' }, { path: 'progress.md', reason: 'm' }, { path: 'docs/**', reason: 'prose' }, { path: 'AGENTS.md', reason: 'constitution' }],
    riskChecks: { low: [] }, checks: {},
    modules: [{ id: 'core', paths: ['src/**'], riskTier: 'low' }],
    trace: { requirementDirs: ['docs/requirements'], testGlobs: ['**/*.test.mjs'], minCoverage: 1 },
  }, null, 2))
  run(['add', '-A'])
  run(['commit', '-q', '-m', 'fixture'])
  return { dir, run }
}

test('release is blocked while no fresh receipt binds the tree', () => {
  const { dir } = repo()
  try {
    fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), '// implements ' + RC + '\nexport const a = 2\n')
    fs.appendFileSync(path.join(dir, 'progress.md'), '\n')
    const r = dsb(['release'], { cwd: dir })
    assert.equal(r.code, 2)
    assert.equal(r.json.ready, false)
    assert.ok(r.json.blockers.includes('receipt-fresh'), JSON.stringify(r.json.blockers))
    assert.match(r.json.text, /never performs them/)
  } finally { rmDir(dir) }
})

test('release is ready once a fresh ACCEPT receipt exists and the gate passes', () => {
  const { dir } = repo()
  try {
    fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 2\n')
    fs.appendFileSync(path.join(dir, 'progress.md'), '\n')
    const w = dsb(['receipt', 'write'], { cwd: dir, input: JSON.stringify({ taskId: 'T-1', reviewer: 'me', verdict: 'ACCEPT', scope: 'src' }) })
    assert.equal(w.code, 0)
    const r = dsb(['release'], { cwd: dir })
    assert.equal(r.json.ready, true, JSON.stringify(r.json.blockers))
    assert.equal(r.code, 0)
  } finally { rmDir(dir) }
})

test('release never tags even when ready', () => {
  const { dir, run } = repo()
  try {
    fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 2\n')
    fs.appendFileSync(path.join(dir, 'progress.md'), '\n')
    dsb(['receipt', 'write'], { cwd: dir, input: JSON.stringify({ taskId: 'T-1', reviewer: 'me', verdict: 'ACCEPT', scope: 'src' }) })
    dsb(['release'], { cwd: dir })
    const tags = run(['tag', '--list']).stdout.trim()
    assert.equal(tags, '', 'the engine assembles evidence; tagging is a human act')
  } finally { rmDir(dir) }
})