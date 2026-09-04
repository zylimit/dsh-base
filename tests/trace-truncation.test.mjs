// A truncated tracked-file list is a bad measurement: trace must fail it,
// not report coverage over the files it happened to see.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir } from './helpers.mjs'

function repo () {
  const dir = tempDir('trunc')
  const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 't@e.invalid'])
  run(['config', 'user.name', 't'])
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'docs', 'requirements'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), '// implements ' + 'REQ-' + 'CALC-001' + '\nexport const a = 1\n')
  fs.writeFileSync(path.join(dir, 'src', 'a.test.mjs'), '// verifies ' + 'REQ-' + 'CALC-001' + '\nexport const t = 1\n')
  fs.writeFileSync(path.join(dir, 'src', 'b.mjs'), 'export const b = 1\n')
  fs.writeFileSync(path.join(dir, 'docs', 'requirements', 'PRODUCT-SPEC.md'), '# spec\n\n### ' + 'REQ-' + 'CALC-001' + ' - one\n\nWHEN the program runs, the system SHALL return one.\n\nAcceptance: the value is 1.\n\nresilience security safety privacy reliability are declared in scope with tests.\n')
  fs.mkdirSync(path.join(dir, '.dsh', 'base'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.dsh', 'base', 'catalog.json'), JSON.stringify({
    version: 1, maxTrackedPaths: 2, global: [], ignored: [{ path: '.dsh/**', reason: 'x' }, { path: 'docs/**', reason: 'prose' }],
    riskChecks: { low: [] }, checks: {},
    modules: [{ id: 'core', paths: ['src/**'], riskTier: 'low' }],
    trace: { requirementDirs: ['docs/requirements'], testGlobs: ['**/*.test.mjs'], minCoverage: 1 },
  }, null, 2))
  run(['add', '-A']); run(['commit', '-q', '-m', 'fixture'])
  return { dir }
}

test('trace fails a truncated file list instead of covering what it happened to see', () => {
  const { dir } = repo()
  try {
    const r = dsb(['trace'], { cwd: dir })
    assert.notEqual(r.code, 0, 'a truncated measurement must not read as a pass: ' + JSON.stringify(r.json))
    assert.equal(r.json.truncated, true)
    assert.equal(r.json.ok, false)
  } finally { rmDir(dir) }
})
