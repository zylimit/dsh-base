// Corrupt runtime state is quarantined: moved aside with a timestamp and
// recorded, never silently rebuilt and never silently kept. The engine
// continues from the default state and risk reports the quarantine.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir } from './helpers.mjs'

function repo () {
  const dir = tempDir('quarantine')
  const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 't@e.invalid'])
  run(['config', 'user.name', 't'])
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 1\n')
  fs.mkdirSync(path.join(dir, '.dsh', 'base'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.dsh', 'base', 'catalog.json'), JSON.stringify({
    version: 1, global: [], ignored: [{ path: '.dsh/**', reason: 'x' }],
    riskChecks: { low: ['unit'] }, checks: { unit: { command: 'node --version', class: 'test' } },
    modules: [{ id: 'core', paths: ['src/**'], riskTier: 'low' }],
  }, null, 2))
  run(['add', '-A']); run(['commit', '-q', '-m', 'fixture'])
  return { dir }
}

test('a corrupt task envelope is quarantined, never silently dropped or rebuilt', () => {
  const { dir } = repo()
  try {
    fs.mkdirSync(path.join(dir, '.dsh', 'base', 'state'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.dsh', 'base', 'state', 'task.json'), '{ this is not json')
    const r = dsb(['task', 'status'], { cwd: dir })
    assert.equal(r.code, 0, JSON.stringify(r.json))
    const q = fs.readFileSync(path.join(dir, '.dsh', 'base', 'state', 'quarantine.jsonl'), 'utf8')
    assert.match(q, /corrupt task state/)
    const leftovers = fs.readdirSync(path.join(dir, '.dsh', 'base', 'state')).filter(f => f.startsWith('task.json.corrupt-'))
    assert.equal(leftovers.length, 1, 'the corrupt file is moved aside, not deleted')
    assert.equal(fs.existsSync(path.join(dir, '.dsh', 'base', 'state', 'task.json')), false)
  } finally { rmDir(dir) }
})

test('a corrupt fast-mode window is quarantined and treated as closed', () => {
  const { dir } = repo()
  try {
    fs.mkdirSync(path.join(dir, '.dsh', 'base', 'state'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.dsh', 'base', 'state', 'fast-mode.json'), 'not-json')
    const r = dsb(['fast', 'status'], { cwd: dir })
    assert.equal(r.code, 0, JSON.stringify(r.json))
    assert.equal(r.json.active, false, 'a corrupt window cannot keep skipping checks')
    const q = fs.readFileSync(path.join(dir, '.dsh', 'base', 'state', 'quarantine.jsonl'), 'utf8')
    assert.match(q, /corrupt fast-mode/)
  } finally { rmDir(dir) }
})

test('risk reports quarantined state', () => {
  const { dir } = repo()
  try {
    fs.mkdirSync(path.join(dir, '.dsh', 'base', 'state'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.dsh', 'base', 'state', 'task.json'), 'broken')
    const r = dsb(['risk'], { cwd: dir })
    assert.equal(r.code, 0, JSON.stringify(r.json))
    assert.ok((r.json.findings || []).some(f => f.code === 'QUARANTINED_STATE'), JSON.stringify(r.json.findings))
  } finally { rmDir(dir) }
})
