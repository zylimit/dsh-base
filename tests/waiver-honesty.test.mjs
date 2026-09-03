// A waiver pre-declares a skip. It never rewrites an executed result: once a
// check has run, its FAIL/BLOCKED is an immutable ledger fact, and a protected
// check runs no matter what a waiver says. These tests pin both directions.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir } from './helpers.mjs'

const CHECKS = {
  unit: { command: 'node --version', class: 'test', attributes: ['reliability'] },
  flaky: { command: 'node fail.mjs', class: 'test', attributes: ['maintainability'] },
  sast: { command: 'node fail.mjs', class: 'security', attributes: ['security'] },
}

function repo (checks, planChecks) {
  const dir = tempDir('waiver')
  const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 't@e.invalid'])
  run(['config', 'user.name', 't'])
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 1\n')
  fs.writeFileSync(path.join(dir, 'fail.mjs'), 'process.exit(1)\n')
  fs.mkdirSync(path.join(dir, '.dsh', 'base'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.dsh', 'base', 'catalog.json'), JSON.stringify({
    version: 1, global: [], ignored: [{ path: '.dsh/**', reason: 'x' }],
    riskChecks: { low: planChecks }, checks,
    modules: [{ id: 'core', paths: ['src/**'], riskTier: 'low' }],
  }, null, 2))
  run(['add', '-A']); run(['commit', '-q', '-m', 'fixture'])
  return { dir }
}

function waiver (dir, scope, reason) {
  fs.mkdirSync(path.join(dir, '.dsh', 'base', 'waivers'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.dsh', 'base', 'waivers', scope + '.json'), JSON.stringify({
    version: 1, owner: 'test', reason, scope, expiry: '2099-01-01T00:00:00.000Z', compensation: 're-run weekly',
  }))
}

test('a valid waiver pre-declares a skip: the check never executes and the gate passes', () => {
  const { dir } = repo(CHECKS, ['unit', 'flaky'])
  try {
    waiver(dir, 'flaky', 'flaky upstream tool')
    fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 2\n')
    const r = dsb(['gate'], { cwd: dir })
    assert.equal(r.code, 0, JSON.stringify(r.json))
    const flaky = r.json.results.find(x => x.id === 'flaky')
    assert.equal(flaky.status, 'SKIPPED')
    assert.match(flaky.reason, /waiver:flaky/)
    assert.ok(!('evidence' in flaky), 'a pre-declared skip must not execute the command')
    assert.ok((r.json.waivers || []).some(w => w.check === 'flaky'))
  } finally { rmDir(dir) }
})

test('a protected check runs despite a waiver and its failure fails the gate', () => {
  const { dir } = repo(CHECKS, ['unit', 'flaky', 'sast'])
  try {
    waiver(dir, 'sast', 'transient environment')
    fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 2\n')
    const r = dsb(['gate'], { cwd: dir })
    assert.equal(r.code, 2)
    const sast = r.json.results.find(x => x.id === 'sast')
    assert.equal(sast.status, 'FAIL')
    assert.equal(r.json.gate, 'FAIL')
    assert.ok(!(r.json.waivers || []).some(w => w.check === 'sast'))
    assert.ok((r.json.waiversBlocked || []).includes('sast'), JSON.stringify(r.json.waiversBlocked))
  } finally { rmDir(dir) }
})

test('a corrupt waiver file is quarantined and the check it might have excused runs anyway', () => {
  const { dir } = repo(CHECKS, ['unit', 'flaky'])
  try {
    fs.mkdirSync(path.join(dir, '.dsh', 'base', 'waivers'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.dsh', 'base', 'waivers', 'flaky.json'), '{ not json')
    fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 2\n')
    const r = dsb(['gate'], { cwd: dir })
    assert.equal(r.code, 2, 'no waiver applies, so the failing check runs and fails: ' + JSON.stringify(r.json))
    assert.equal(r.json.results.find(x => x.id === 'flaky').status, 'FAIL')
    const q = fs.readFileSync(path.join(dir, '.dsh', 'base', 'state', 'quarantine.jsonl'), 'utf8')
    assert.match(q, /unreadable waiver/)
    const leftovers = fs.readdirSync(path.join(dir, '.dsh', 'base', 'waivers')).filter(f => f.startsWith('flaky.json.corrupt-'))
    assert.equal(leftovers.length, 1, 'the corrupt waiver is moved aside, not deleted')
  } finally { rmDir(dir) }
})

test('a waiver never masks an executed failure elsewhere', () => {
  const { dir } = repo({ ...CHECKS, unit: { command: 'node fail.mjs', class: 'test', attributes: ['reliability'] } }, ['unit', 'flaky', 'sast'])
  try {
    waiver(dir, 'flaky', 'flaky upstream tool')
    fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 2\n')
    const r = dsb(['gate'], { cwd: dir })
    assert.equal(r.code, 2)
    assert.equal(r.json.gate, 'FAIL')
    assert.equal(r.json.results.find(x => x.id === 'flaky').status, 'SKIPPED')
    assert.equal(r.json.results.find(x => x.id === 'unit').status, 'FAIL')
  } finally { rmDir(dir) }
})
