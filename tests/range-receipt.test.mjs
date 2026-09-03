// A release review binds the commits being released, not the working tree.
// Range receipts are the close-out of the gap a real release exposed: a clean
// tree has no diff to bind, yet the tag carries exactly the commits that were
// reviewed. These tests pin both directions - range receipts validate on a clean
// tree, and die the moment HEAD moves.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir } from './helpers.mjs'

function repo () {
  const dir = tempDir('range')
  const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 't@e.invalid'])
  run(['config', 'user.name', 't'])
  fs.writeFileSync(path.join(dir, 'a.mjs'), 'export const a = 1\n')
  run(['add', '-A']); run(['commit', '-q', '-m', 'base'])
  const base = run(['rev-parse', 'HEAD']).stdout.trim()
  fs.writeFileSync(path.join(dir, 'a.mjs'), 'export const a = 2\n')
  fs.writeFileSync(path.join(dir, 'b.mjs'), 'export const b = 2\n')
  run(['add', '-A']); run(['commit', '-q', '-m', 'release work'])
  return { dir, run, base }
}

const payload = JSON.stringify({ taskId: 'REL-1', reviewer: 'me', verdict: 'ACCEPT', scope: 'the release' })
const RC = 'REQ-' + 'CALC-001'

test('a range receipt refuses a ref that does not resolve', () => {
  const { dir } = repo()
  try {
    const r = dsb(['receipt', 'write', '--base', 'not-a-ref'], { cwd: dir, input: payload })
    assert.equal(r.code, 3)
    assert.match(r.json.reason, /does not resolve/)
  } finally { rmDir(dir) }
})

test('a range receipt refuses an empty range', () => {
  const { dir, run } = repo()
  try {
    const head = run(['rev-parse', 'HEAD']).stdout.trim()
    const r = dsb(['receipt', 'write', '--base', head], { cwd: dir, input: payload })
    assert.equal(r.code, 3, 'an empty range is nothing reviewed')
    assert.match(r.json.reason, /empty range/)
  } finally { rmDir(dir) }
})

test('a range receipt validates on a clean tree and dies when HEAD moves', () => {
  const { dir, run, base } = repo()
  try {
    const w = dsb(['receipt', 'write', '--base', base], { cwd: dir, input: payload })
    assert.equal(w.code, 0, w.json && w.json.reason)
    assert.ok(w.json.receipt.range)
    assert.equal(w.json.receipt.range.base, base)

    const clean = dsb(['receipt', 'verify'], { cwd: dir })
    assert.equal(clean.code, 0, JSON.stringify(clean.json))
    assert.equal(clean.json.rangeMatching[0].kind, 'range')

    fs.writeFileSync(path.join(dir, 'c.mjs'), 'export const c = 3\n')
    run(['add', '-A']); run(['commit', '-q', '-m', 'the next thing'])
    const moved = dsb(['receipt', 'verify'], { cwd: dir })
    assert.equal(moved.code, 3, 'the receipt certified the previous HEAD, not this one')
    assert.equal(moved.json.degraded, true)
    assert.match(moved.json.reason, /no-change/)
  } finally { rmDir(dir) }
})

test('a working-tree receipt and a range receipt are different kinds of evidence', () => {
  const { dir, run, base } = repo()
  try {
    fs.writeFileSync(path.join(dir, 'a.mjs'), 'export const a = 3\n')
    const w = dsb(['receipt', 'write'], { cwd: dir, input: JSON.stringify({ taskId: 'WT-1', reviewer: 'me', verdict: 'ACCEPT', scope: 'tree' }) })
    assert.equal(w.code, 0)
    const v = dsb(['receipt', 'verify'], { cwd: dir })
    assert.equal(v.json.matching[0].kind, 'working-tree')

    dsb(['receipt', 'write', '--base', base], { cwd: dir, input: payload })
    const both = dsb(['receipt', 'verify'], { cwd: dir })
    assert.ok(both.json.matching.some(m => m.kind === 'working-tree'))
    assert.ok(both.json.rangeMatching.some(m => m.kind === 'range'))
  } finally { rmDir(dir) }
})

test('release is ready on a clean tree once a range receipt exists', () => {
  const { dir, base } = repo()
  try {
    // The release fixture needs a governed catalog for release to run.
    fs.mkdirSync(path.join(dir, 'docs', 'requirements'), { recursive: true })
    fs.mkdirSync(path.join(dir, '.dsh', 'base'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docs', 'requirements', 'PRODUCT-SPEC.md'), [
      '# spec', '', '### ' + RC + ' - one', '', 'WHEN the program runs, the system SHALL return one.', '',
      'Acceptance: the value is 1.', '', 'resilience security safety privacy reliability are in scope with tests.', '',
    ].join('\n'))
    fs.writeFileSync(path.join(dir, 'docs', 'requirements', 'PRODUCT-SPEC-CHANGELOG.md'), '# changelog\n')
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# c\n\n## Purpose\nfixture.\n\n## Boundaries\nnone.\n\n## Invariants\nhonesty.\n\n## Verification\nnode --test.\n')
    fs.writeFileSync(path.join(dir, 'release.test.mjs'), '// verifies ' + 'REQ-' + 'CALC-001' + '\nexport const t = 1\n')
    fs.writeFileSync(path.join(dir, 'progress.md'), '# progress.md\n')
    fs.writeFileSync(path.join(dir, '.dsh', 'base', 'catalog.json'), JSON.stringify({
      version: 1, global: [], ignored: [
        { path: '.dsh/**', reason: 'x' }, { path: 'progress.md', reason: 'm' },
        { path: 'docs/**', reason: 'prose' }, { path: 'AGENTS.md', reason: 'constitution' },
      ],
      riskChecks: { low: ['unit'] }, checks: { unit: { command: 'node --version', class: 'test', attributes: ['reliability'] } },
      modules: [{ id: 'core', paths: ['*.mjs'], riskTier: 'low' }],
      trace: { requirementDirs: ['docs/requirements'], testGlobs: ['**/*.test.mjs'], minCoverage: 1 },
    }, null, 2))
    const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
    run(['add', '-A']); run(['commit', '-q', '-m', 'govern'])

    assert.equal(dsb(['receipt', 'write', '--base', base], { cwd: dir, input: payload }).code, 0)
    const blocked = dsb(['release'], { cwd: dir })
    assert.equal(blocked.code, 2)
    assert.ok(blocked.json.blockers.includes('gate-fresh'), JSON.stringify(blocked.json.blockers))
    const g = dsb(['gate', '--baseline', base], { cwd: dir })
    assert.equal(g.code, 0, JSON.stringify(g.json))
    const r = dsb(['release'], { cwd: dir })
    assert.equal(r.code, 0, JSON.stringify(r.json.blockers))
    assert.equal(r.json.ready, true)
  } finally { rmDir(dir) }
})