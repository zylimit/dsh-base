// A corrupt gate-log line is an interception record that cannot be read.
// The audit must count it, not silently drop it - a log that loses lines
// silently is how a guard that crashed reads as a guard that never fired.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir } from './helpers.mjs'

function repo () {
  const dir = tempDir('gatelog')
  const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 't@e.invalid'])
  run(['config', 'user.name', 't'])
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 1\n')
  fs.mkdirSync(path.join(dir, '.dsh', 'base'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.dsh', 'base', 'catalog.json'), JSON.stringify({
    version: 1, global: [], ignored: [{ path: '.dsh/**', reason: 'x' }],
    riskChecks: { low: [] }, checks: {},
    modules: [{ id: 'core', paths: ['src/**'], riskTier: 'low' }],
  }, null, 2))
  run(['add', '-A']); run(['commit', '-q', '-m', 'fixture'])
  return { dir }
}

test('gate-audit counts corrupt gate-log lines instead of silently dropping them', () => {
  const { dir } = repo()
  try {
    fs.mkdirSync(path.join(dir, '.dsh', 'base', 'state'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.dsh', 'base', 'state', 'gate-log.jsonl'), '{ not json\n')
    const r = dsb(['gate-audit'], { cwd: dir })
    assert.equal(r.code, 0, JSON.stringify(r.json))
    assert.ok(r.json.corruptLines >= 1, JSON.stringify(r.json))
  } finally { rmDir(dir) }
})
