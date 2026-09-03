// The review team scales with the stakes, and the loop stops when the same
// change keeps being rejected. Both exist because a personal calculator that
// spent seven rounds under a five-lens review taught us what happens without
// them.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir } from './helpers.mjs'

function repo (reviewConfig, modules = [{ id: 'core', paths: ['src/**'], riskTier: 'low' }]) {
  const dir = tempDir('team')
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
    global: [], ignored: [{ path: '.dsh/**', reason: 'x' }, { path: 'progress.md', reason: 'memory' }],
    riskChecks: { low: [] }, checks: {},
    modules,
    review: reviewConfig,
  }, null, 2))
  run(['add', '-A'])
  run(['commit', '-q', '-m', 'fixture'])
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 2\n')
  return { dir, run }
}

test('the profile picks the team: personal convenes one lens', () => {
  const { dir } = repo({ profile: 'personal' })
  try {
    const r = dsb(['review', 'start'], { cwd: dir })
    assert.deepEqual(r.json.session.requiredLenses, ['correctness'],
      'a personal tool under a five-lens review is how you get seven rounds on a calculator')
    assert.deepEqual(r.json.session.excludedLenses, [])
  } finally { rmDir(dir) }
})

test('an explicit lens list overrides the profile entirely', () => {
  const { dir } = repo({ profile: 'personal', lenses: ['security', 'privacy'] })
  try {
    const r = dsb(['review', 'start'], { cwd: dir })
    assert.deepEqual(r.json.session.requiredLenses, ['security', 'privacy'])
  } finally { rmDir(dir) }
})

test('a lens is dropped when nothing affected declares its attribute', () => {
  const { dir } = repo(
    { profile: 'production' },
    [{ id: 'core', paths: ['src/**'], riskTier: 'low', attributes: { security: 'high', privacy: 'minimal' } }],
  )
  try {
    const r = dsb(['review', 'start'], { cwd: dir })
    assert.equal(r.json.session.requiredLenses.includes('security'), true, 'security is declared high')
    assert.equal(r.json.session.requiredLenses.includes('privacy'), false,
      'convening a privacy reviewer where nothing is stored produces nitpicks')
    assert.equal(r.json.session.requiredLenses.includes('correctness'), true,
      'correctness has no attribute and is the floor of every review')
    // privacy is not in the production profile at all, so it is simply absent
    // rather than listed as an exclusion; an exclusion describes a drop.
    const ex = r.json.session.excludedLenses.find(x => x.lens === 'privacy')
    assert.equal(ex, undefined, 'profile-non-members are absent, not excluded')
  } finally { rmDir(dir) }
})

test('a critical-risk module raises the review floor above the configured profile', () => {
  const { dir } = repo(
    { profile: 'personal' },
    [{ id: 'core', paths: ['src/**'], riskTier: 'critical', attributes: { maintainability: 'high', security: 'high' } }])
  try {
    const r = dsb(['review', 'start'], { cwd: dir })
    assert.deepEqual(r.json.session.requiredLenses, ['correctness', 'architecture', 'security'],
      'risk raises the floor to production; attributes only shrink from there')
  } finally { rmDir(dir) }
})

test('a high-risk module raises a personal review to the team floor', () => {
  const { dir } = repo(
    { profile: 'personal' },
    [{ id: 'core', paths: ['src/**'], riskTier: 'high', attributes: { maintainability: 'high' } }])
  try {
    const r = dsb(['review', 'start'], { cwd: dir })
    assert.deepEqual(r.json.session.requiredLenses, ['correctness', 'architecture'])
  } finally { rmDir(dir) }
})

test('declaring everything critical cannot convene a bigger team than the profile', () => {
  const { dir } = repo(
    { profile: 'personal' },
    [{ id: 'core', paths: ['src/**'], riskTier: 'low', attributes: { security: 'critical', privacy: 'critical', resilience: 'critical' } }],
  )
  try {
    const r = dsb(['review', 'start'], { cwd: dir })
    assert.deepEqual(r.json.session.requiredLenses, ['correctness'],
      'attributes can only shrink the team, never grow it')
  } finally { rmDir(dir) }
})

test('the third consecutive rejection escalates instead of opening another round', () => {
  const { dir } = repo({ profile: 'personal', maxRounds: 3 })
  try {
    // Seed two prior rejections of this exact diff, as a real loop would leave them.
    const d = dsb(['diff-hash'], { cwd: dir }).json.diffHash
    const p = path.join(dir, '.dsh', 'base', 'state', 'review', 'session.json')
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify({
      version: 1, diffHash: d, baseCommit: null, startedAt: new Date().toISOString(),
      scope: '', packPath: null, requiredLenses: ['correctness'], excludedLenses: [],
      lineage: [
        { at: new Date().toISOString(), diffHash: d, errors: 1 },
        { at: new Date().toISOString(), diffHash: d, errors: 1 },
      ],
      blue: null, lenses: {}, verdict: null,
    }))

    assert.equal(dsb(['review', 'start'], { cwd: dir }).code, 0)
    const lineage = dsb(['review', 'status'], { cwd: dir }).json.session.lineage
    assert.equal(lineage.length, 2, 'the previous rejections carried forward')

    dsb(['review', 'blue'], { cwd: dir, input: JSON.stringify({ claims: [{ claim: 'the change is scoped', evidence: 'dsb impact, exit 0' }] }) })
    dsb(['review', 'lens', 'correctness'], { cwd: dir, input: JSON.stringify({
      findings: [{ severity: 'error', location: 'src/a.mjs:1', summary: 'still wrong' }],
    }) })
    const v = dsb(['review', 'verdict'], { cwd: dir })
    assert.equal(v.json.verdict, 'FIX_REQUIRED')
    assert.equal(v.json.round, 3)
    assert.equal(v.json.escalate, true, 'the loop must stop and ask a human which is wrong: the change or the bar')
    assert.match(v.json.advice, /Stop\./)
  } finally { rmDir(dir) }
})

test('a first rejection does not escalate', () => {
  const { dir } = repo({ profile: 'personal', maxRounds: 3 })
  try {
    dsb(['review', 'start'], { cwd: dir })
    dsb(['review', 'blue'], { cwd: dir, input: JSON.stringify({ claims: [{ claim: 'c', evidence: 'e' }] }) })
    dsb(['review', 'lens', 'correctness'], { cwd: dir, input: JSON.stringify({
      findings: [{ severity: 'error', location: 'src/a.mjs:1', summary: 'x' }],
    }) })
    const v = dsb(['review', 'verdict'], { cwd: dir })
    assert.equal(v.json.round, 1)
    assert.equal(v.json.escalate, false)
  } finally { rmDir(dir) }
})
