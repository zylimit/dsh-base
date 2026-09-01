// The stage model exists because spending a security review on code that does
// not work yet is theatre. These tests pin the order and the two exits that
// keep a review finite: escalation after the round limit, and the backlog for
// findings a human decides to carry.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir } from './helpers.mjs'

function repo (profile = 'production', attrs = { security: 'high', reliability: 'medium', performance: 'low', maintainability: 'low' }) {
  const dir = tempDir('stages')
  const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 't@e.invalid'])
  run(['config', 'user.name', 't'])
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 1\n')
  fs.writeFileSync(path.join(dir, 'progress.md'), '# progress.md\n')
  fs.mkdirSync(path.join(dir, '.dsh', 'base'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.dsh', 'base', 'catalog.json'), JSON.stringify({
    version: 1,
    global: [], ignored: [{ path: '.dsh/**', reason: 'x' }, { path: 'progress.md', reason: 'm' }],
    riskChecks: { low: [] }, checks: {},
    modules: [{ id: 'core', paths: ['src/**'], riskTier: 'low', attributes: attrs }],
    review: { profile },
  }, null, 2))
  run(['add', '-A'])
  run(['commit', '-q', '-m', 'fixture'])
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 2\n')
  return { dir }
}

const blue = JSON.stringify({ claims: [{ claim: 'scoped', evidence: 'dsb impact, exit 0' }] })
const clean = JSON.stringify({ findings: [] })

test('a stage-3 lens is refused while stage 1 has not reported', () => {
  const { dir } = repo('production', { security: 'high', reliability: 'medium', performance: 'low', maintainability: 'low' })
  try {
    dsb(['review', 'start'], { cwd: dir })
    dsb(['review', 'blue'], { cwd: dir, input: blue })
    const r = dsb(['review', 'lens', 'security'], { cwd: dir, input: clean })
    assert.equal(r.code, 1)
    assert.equal(r.json.stageGated, true)
    assert.equal(r.json.stage, 3)
    assert.equal(r.json.currentStage, 1)
    assert.match(r.json.reason, /stage 1/)
  } finally { rmDir(dir) }
})

test('the stages advance in order and the receipt waits for the last one', () => {
  const { dir } = repo('production', { security: 'high', reliability: 'medium', performance: 'low', maintainability: 'low' })
  try {
    dsb(['review', 'start'], { cwd: dir })
    dsb(['review', 'blue'], { cwd: dir, input: blue })
    // Stage 1: code. correctness + architecture.
    dsb(['review', 'lens', 'correctness'], { cwd: dir, input: clean })
    dsb(['review', 'lens', 'architecture'], { cwd: dir, input: clean })
    const s1 = dsb(['review', 'verdict'], { cwd: dir })
    assert.equal(s1.json.ok, false, 'the verdict names what is missing next, it does not pretend to advance')
    assert.ok(s1.json.blockers.some(b => /stage 2/.test(b) && /testing/.test(b)))

    // Stage 2: functional. testing + performance.
    dsb(['review', 'lens', 'testing'], { cwd: dir, input: clean })
    dsb(['review', 'lens', 'performance'], { cwd: dir, input: clean })
    const s2 = dsb(['review', 'verdict'], { cwd: dir })
    assert.equal(s2.json.ok, false)
    assert.ok(s2.json.blockers.some(b => /stage 3/.test(b) && /security/.test(b)))

    // Stage 3: trust. security + reliability.
    dsb(['review', 'lens', 'security'], { cwd: dir, input: clean })
    dsb(['review', 'lens', 'reliability'], { cwd: dir, input: clean })
    const s3 = dsb(['review', 'verdict'], { cwd: dir })
    assert.equal(s3.json.isFinal, true)
    assert.equal(s3.json.verdict, 'ACCEPT')
    assert.ok(s3.json.receipt, 'the receipt is written only when the last stage passes')
  } finally { rmDir(dir) }
})

test('a stage-1 failure blocks the whole review without anyone paying for stage 3', () => {
  const { dir } = repo('production', { security: 'high' })
  try {
    dsb(['review', 'start'], { cwd: dir })
    dsb(['review', 'blue'], { cwd: dir, input: blue })
    dsb(['review', 'lens', 'correctness'], { cwd: dir, input: JSON.stringify({
      findings: [{ severity: 'error', location: 'src/a.mjs:1', summary: 'wrong result' }],
    }) })
    // The fixture convenes no stage-2 lens, so the stage counter skips the
    // empty stage; what matters is that the error dominates and no receipt is
    // written, not which stage number the empty set was given.
    const v = dsb(['review', 'verdict'], { cwd: dir })
    assert.equal(v.json.verdict, 'FIX_REQUIRED')
    assert.ok(v.json.stage >= 1)
    assert.equal(v.json.receipt, null, 'a stage-1 error means nobody ever pays for stage 3')
  } finally { rmDir(dir) }
})

test('a finding can be carried as a dated backlog entry - except a protected one', () => {
  const { dir } = repo('personal')
  try {
    dsb(['review', 'start'], { cwd: dir })
    dsb(['review', 'blue'], { cwd: dir, input: blue })

    const okAdd = dsb(['review', 'backlog', 'add'], { cwd: dir, input: JSON.stringify({
      owner: 'me', expiry: new Date(Date.now() + 86400000 * 30).toISOString(),
      summary: 'the minus glyph renders as a hyphen on one platform; cosmetics, not correctness',
      lens: 'maintainability', location: 'src/ui/render.mjs:12',
    }) })
    assert.equal(okAdd.code, 0)
    assert.equal(okAdd.json.count, 1)

    const badAdd = dsb(['review', 'backlog', 'add'], { cwd: dir, input: JSON.stringify({
      owner: 'me', expiry: new Date(Date.now() + 86400000).toISOString(),
      summary: 'security: the window lacks a CSP',
      lens: 'security',
    }) })
    assert.equal(badAdd.code, 1)
    assert.match(badAdd.json.reason, /cannot be backlogged/)

    const list = dsb(['review', 'backlog', 'list'], { cwd: dir })
    assert.equal(list.json.count, 1, 'the protected finding was not silently dropped; it was refused')
    assert.match(list.json.entries[0].summary, /minus glyph/)
  } finally { rmDir(dir) }
})

test('an expired backlog entry is reported as expired, not hidden', () => {
  const { dir } = repo('personal')
  try {
    dsb(['review', 'start'], { cwd: dir })
    dsb(['review', 'backlog', 'add'], { cwd: dir, input: JSON.stringify({
      owner: 'me', expiry: new Date(Date.now() + 86400000).toISOString(),
      summary: 'paint color', lens: 'maintainability',
    }) })
    const p = path.join(dir, '.dsh', 'base', 'state', 'review', 'session.json')
    const s = JSON.parse(fs.readFileSync(p, 'utf8'))
    s.backlog[0].expiry = new Date(Date.now() - 1000).toISOString()
    fs.writeFileSync(p, JSON.stringify(s))
    const list = dsb(['review', 'backlog', 'list'], { cwd: dir })
    assert.equal(list.json.expired, 1)
  } finally { rmDir(dir) }
})