// Catalog discovery exists so a human corrects a proposal instead of
// transcribing facts the repository already contains. Its failure mode is noise:
// a proposal system whose output is wrong teaches its user to ignore every
// proposal, including the true ones. These tests pin precision.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir } from './helpers.mjs'

function projectFixture () {
  const dir = tempDir('discover')
  const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 't@e.invalid'])
  run(['config', 'user.name', 't'])

  const write = (rel, text) => {
    const p = path.join(dir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, text)
  }

  // Production code that genuinely handles credentials: two distinct terms.
  write('src/auth/login.js', "import { verify } from '../store/db.js'\nexport const login = (password, jwt) => verify(password, jwt)\n")
  write('src/auth/session.js', "export const session = (token) => ({ token })\n")
  write('src/store/db.js', 'export const verify = () => true\n')
  write('src/store/index.js', "export * from './db.js'\n")
  write('src/ui/app.js', "import { login } from '../auth/login.js'\nexport const app = login\n")
  write('src/ui/view.js', 'export const view = () => null\n')

  // A test that merely mentions a sensitive word, and prose that discusses one.
  write('tests/auth.test.js', "// billing and payment fixtures for the refund path\nexport const fixture = 1\n")
  write('docs/spec.md', '# spec\n\nThe system stores personal data such as email and address.\n')
  write('package.json', JSON.stringify({ name: 'fixture', scripts: { test: 'node --test', lint: 'eslint .' } }, null, 2))
  write('README.md', '# fixture\n')

  run(['add', '-A'])
  run(['commit', '-q', '-m', 'fixture: a small project'])
  return dir
}

test('discovery proposes modules from the real tree and leaves nothing unmapped', () => {
  const dir = projectFixture()
  try {
    const r = dsb(['catalog', 'discover'], { cwd: dir })
    assert.equal(r.code, 0)
    assert.equal(r.json.stillUnmappedCount, 0,
      'a draft that leaves paths unmapped fails the very lint it exists to satisfy')
    const ids = r.json.draft.modules.map(m => m.id).sort()
    assert.ok(ids.includes('auth') && ids.includes('store') && ids.includes('ui'), JSON.stringify(ids))
  } finally { rmDir(dir) }
})

test('discovery turns real import edges into declared dependencies', () => {
  const dir = projectFixture()
  try {
    const r = dsb(['catalog', 'discover'], { cwd: dir })
    const byId = Object.fromEntries(r.json.draft.modules.map(m => [m.id, m]))
    assert.deepEqual(byId.auth.dependsOn, ['store'], 'auth imports store')
    assert.deepEqual(byId.ui.dependsOn, ['auth'], 'ui imports auth')
    assert.deepEqual(byId.store.dependsOn, [], 'store imports nobody')
  } finally { rmDir(dir) }
})

test('discovery detects the project real check commands', () => {
  const dir = projectFixture()
  try {
    const r = dsb(['catalog', 'discover'], { cwd: dir })
    const ids = r.json.detectedCommands.map(c => c.id).sort()
    assert.deepEqual(ids, ['lint', 'unit'])
    assert.match(r.json.draft.checks.unit.command, /npm run test/,
      'the detected command is the project own script, not one the engine invented')
  } finally { rmDir(dir) }
})

test('discovery proposes attributes only from production source, never from tests or prose', () => {
  const dir = projectFixture()
  try {
    const r = dsb(['catalog', 'discover'], { cwd: dir })
    const p = r.json.attributeProposals
    assert.ok(p.auth && p.auth.security, 'two credential terms across two source files is a real signal')
    assert.equal(p.auth.security.proposedTier, 'high', 'a keyword never proposes a blocking critical tier')
    assert.ok(p.auth.security.evidence.length > 0, 'a proposal without evidence is a guess')

    assert.equal(p.tests, undefined,
      'a test fixture mentioning billing must not make the test module security-critical')
    assert.equal(p.docs, undefined,
      'a specification discussing personal data is talking about it, not handling it')
  } finally { rmDir(dir) }
})

test('discovery refuses to decide what it cannot read', () => {
  const dir = projectFixture()
  try {
    const r = dsb(['catalog', 'discover'], { cwd: dir })
    const fields = r.json.needsDecision.map(d => d.field)
    for (const f of ['modules[].riskTier', 'modules[].attributes', 'modules[].forbiddenDependencies', 'layers']) {
      assert.ok(fields.includes(f), 'missing decision prompt for ' + f)
    }
    for (const m of r.json.draft.modules) {
      assert.equal(m.attributes, undefined, 'no attribute may be asserted by the engine')
      assert.equal(m.forbiddenDependencies, undefined, 'a prohibition is a commitment, never an observation')
    }
  } finally { rmDir(dir) }
})

test('a discovered draft passes catalog-lint without hand editing', () => {
  const dir = projectFixture()
  try {
    assert.equal(dsb(['catalog', 'discover', '--write'], { cwd: dir }).code, 0)
    spawnSync('git', ['add', '-A'], { cwd: dir, windowsHide: true })
    const lint = dsb(['catalog-lint'], { cwd: dir })
    assert.equal(lint.code, 0, JSON.stringify(lint.json && lint.json.findings))
    assert.equal(lint.json.counts.unmapped, 0)
  } finally { rmDir(dir) }
})

test('discovery degrades on an empty repository instead of inventing a map', () => {
  const dir = tempDir('discover-empty')
  try {
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, windowsHide: true })
    const r = dsb(['catalog', 'discover'], { cwd: dir })
    assert.equal(r.code, 3)
    assert.equal(r.json.degraded, true)
  } finally { rmDir(dir) }
})
test('a catalog change still fans out after discovery', () => {
  const dir = projectFixture()
  try {
    assert.equal(dsb(['catalog', 'discover', '--write'], { cwd: dir }).code, 0)
    spawnSync('git', ['add', '-A'], { cwd: dir, windowsHide: true })
    const r = dsb(['impact', '--paths', '.dsh/base/catalog.json'], { cwd: dir })
    assert.equal(r.code, 0)
    assert.equal(r.json.degraded, true,
      'the catalog rewrites the rules, so a change to it must expand to every module')
    assert.ok(r.json.affected.length >= 3)
  } finally { rmDir(dir) }
})
