// The review gate is the strongest measured lever in agentic coding, and the
// easiest to turn into theatre. These tests pin the properties that stop it:
// a verdict cannot be reached without looking, a located finding is required,
// and one lens finding an error is not outvoted by lenses that found nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir } from './helpers.mjs'

function repo () {
  const dir = tempDir('review')
  const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 't@e.invalid'])
  run(['config', 'user.name', 't'])
  fs.mkdirSync(path.join(dir, 'src', 'api'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'api', 'a.mjs'), 'export const a = 1\n')
  fs.writeFileSync(path.join(dir, 'progress.md'), '# progress.md\n')
  fs.mkdirSync(path.join(dir, '.dsh', 'base'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.dsh', 'base', 'catalog.json'), JSON.stringify({
    version: 1,
    global: [], ignored: [{ path: '.dsh/**', reason: 'tooling' }, { path: 'progress.md', reason: 'memory' }],
    riskChecks: { low: [] }, checks: {},
    modules: [{ id: 'api', paths: ['src/api/**'], riskTier: 'low' }],
    review: { lenses: ['security', 'correctness'] },
  }, null, 2))
  run(['add', '-A'])
  run(['commit', '-q', '-m', 'fixture'])
  fs.writeFileSync(path.join(dir, 'src', 'api', 'a.mjs'), 'export const a = 2\n')
  return { dir, run }
}

const blue = JSON.stringify({ claims: [{ claim: 'the change is confined to src/api', evidence: 'dsb impact -> affected [api], exit 0' }] })
const clean = JSON.stringify({ findings: [] })

test('a review cannot open against an empty tree', () => {
  const dir = tempDir('review-empty')
  try {
    const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
    run(['init', '-q', '-b', 'main'])
    run(['config', 'user.email', 't@e.invalid']); run(['config', 'user.name', 't'])
    fs.mkdirSync(path.join(dir, '.dsh', 'base'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.dsh', 'base', 'catalog.json'), JSON.stringify({
      version: 1, global: [], ignored: [{ path: '.dsh/**', reason: 'x' }], riskChecks: {}, checks: {},
      modules: [{ id: 'a', paths: ['src/**'], riskTier: 'low' }],
    }))
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'src', 'x.mjs'), 'export const x = 1\n')
    run(['add', '-A']); run(['commit', '-q', '-m', 'c'])
    const r = dsb(['review', 'start'], { cwd: dir })
    assert.equal(r.code, 3, 'there is nothing under review')
  } finally { rmDir(dir) }
})

test('no verdict is possible until every required lens has actually reported', () => {
  const { dir } = repo()
  try {
    assert.equal(dsb(['review', 'start'], { cwd: dir }).code, 0)

    const early = dsb(['review', 'verdict'], { cwd: dir })
    assert.notEqual(early.code, 0)
    assert.ok(early.json.blockers.some(b => /blue/.test(b)))
    assert.ok(early.json.blockers.some(b => /never reported/.test(b)))

    dsb(['review', 'blue'], { cwd: dir, input: blue })
    dsb(['review', 'lens', 'security'], { cwd: dir, input: clean })

    const partial = dsb(['review', 'verdict'], { cwd: dir })
    assert.notEqual(partial.code, 0, 'one lens is not a review')
    assert.ok(partial.json.blockers.join(' ').includes('correctness'))
  } finally { rmDir(dir) }
})

test('blue must carry evidence, not assertions', () => {
  const { dir } = repo()
  try {
    dsb(['review', 'start'], { cwd: dir })
    const r = dsb(['review', 'blue'], { cwd: dir, input: JSON.stringify({ claims: [{ claim: 'it works' }] }) })
    assert.notEqual(r.code, 0)
    assert.match(r.json.reason, /no evidence/)
  } finally { rmDir(dir) }
})

test('a finding with no location and no reproduction is not a finding', () => {
  const { dir } = repo()
  try {
    dsb(['review', 'start'], { cwd: dir })
    const r = dsb(['review', 'lens', 'security'], { cwd: dir, input: JSON.stringify({
      findings: [{ severity: 'error', summary: 'feels insecure' }],
    }) })
    assert.notEqual(r.code, 0)
    assert.match(r.json.reason, /neither a file:line location nor a reproduction/)
  } finally { rmDir(dir) }
})

test('one lens finding an error is not outvoted by lenses that found nothing', () => {
  const { dir } = repo()
  try {
    dsb(['review', 'start'], { cwd: dir })
    dsb(['review', 'blue'], { cwd: dir, input: blue })
    dsb(['review', 'lens', 'security'], { cwd: dir, input: JSON.stringify({
      findings: [{ severity: 'error', location: 'src/api/a.mjs:1', summary: 'value is unvalidated' }],
    }) })
    dsb(['review', 'lens', 'correctness'], { cwd: dir, input: clean })

    const v = dsb(['review', 'verdict'], { cwd: dir })
    assert.equal(v.code, 2)
    assert.equal(v.json.verdict, 'FIX_REQUIRED')
    assert.equal(v.json.errorCount, 1)
    assert.equal(v.json.receipt, null, 'a rejected review writes no accepting receipt')
  } finally { rmDir(dir) }
})

test('a lens that cannot conclude produces NEEDS_MORE_EVIDENCE, not an accept', () => {
  const { dir } = repo()
  try {
    dsb(['review', 'start'], { cwd: dir })
    dsb(['review', 'blue'], { cwd: dir, input: blue })
    dsb(['review', 'lens', 'security'], { cwd: dir, input: JSON.stringify({ findings: [], unable: true, unableReason: 'no threat model exists' }) })
    dsb(['review', 'lens', 'correctness'], { cwd: dir, input: clean })

    const v = dsb(['review', 'verdict'], { cwd: dir })
    assert.equal(v.json.verdict, 'NEEDS_MORE_EVIDENCE')
    assert.deepEqual(v.json.unableLenses, ['security'])
    assert.equal(v.json.receipt, null)
  } finally { rmDir(dir) }
})

test('a clean review accepts and writes a receipt recording its lens coverage', () => {
  const { dir } = repo()
  try {
    dsb(['review', 'start'], { cwd: dir })
    dsb(['review', 'blue'], { cwd: dir, input: blue })
    dsb(['review', 'lens', 'security'], { cwd: dir, input: clean })
    dsb(['review', 'lens', 'correctness'], { cwd: dir, input: clean })

    const v = dsb(['review', 'verdict'], { cwd: dir })
    assert.equal(v.code, 0)
    assert.equal(v.json.verdict, 'ACCEPT')
    assert.deepEqual(v.json.receipt.lenses, ['security', 'correctness'])

    const verify = dsb(['receipt', 'verify'], { cwd: dir })
    assert.equal(verify.code, 0)
    assert.deepEqual(verify.json.matching[0].lenses, ['security', 'correctness'])
  } finally { rmDir(dir) }
})

test('a review goes stale the moment the tree it judged changes', () => {
  const { dir } = repo()
  try {
    dsb(['review', 'start'], { cwd: dir })
    dsb(['review', 'blue'], { cwd: dir, input: blue })
    fs.writeFileSync(path.join(dir, 'src', 'api', 'a.mjs'), 'export const a = 3\n')

    const r = dsb(['review', 'lens', 'security'], { cwd: dir, input: clean })
    assert.equal(r.code, 4, 'evidence about a tree that no longer exists is not evidence')
    assert.match(r.json.reason, /changed since this review opened/)
  } finally { rmDir(dir) }
})

test('a receipt without lens coverage cannot close a task', () => {
  const { dir } = repo()
  try {
    const envelope = JSON.stringify({ id: 'T-1', goal: 'g', scope: 's', outOfScope: 'o', existingPattern: 'p', verification: 'v', escalation: 'e' })
    dsb(['task', 'start'], { cwd: dir, input: envelope })
    dsb(['receipt', 'write'], { cwd: dir, input: JSON.stringify({ taskId: 'T-1', reviewer: 'me', verdict: 'ACCEPT', scope: 's' }) })
    const done = dsb(['task', 'complete'], { cwd: dir })
    assert.notEqual(done.code, 0)
    assert.ok((done.json.blockers || []).some(b => /lens coverage/.test(b)),
      'consensus reached without structured disagreement measures worse than three lenses that disagree')
  } finally { rmDir(dir) }
})
