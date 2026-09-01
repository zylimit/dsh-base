// The independent audit scripts and the properties they defend.
// Covers NFR-SEC-001, NFR-SEC-002, NFR-SAFE-001, NFR-MAINT-001.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, script, tempDir, rmDir, REPO } from './helpers.mjs'
import { lintCatalog } from '../.dsh/base/lib/graph.mjs'

test('NFR-SEC-001 the tracked tree contains no committed secret material', () => {
  const r = script('scan-secrets.mjs')
  assert.equal(r.code, 0, JSON.stringify(r.json && r.json.findings))
  assert.equal(r.json.ok, true)
  assert.ok(r.json.scanned > 0, 'the audit must actually read files')
})

test('NFR-SEC-002 a check claiming a protected attribute cannot opt into fast-skip', () => {
  const catalog = {
    modules: [{ id: 'a', paths: ['src/a/**'], riskTier: 'low' }],
    checks: { sast: { command: 'echo x', class: 'security', attributes: ['security'], allowFastSkip: true } },
    riskChecks: {},
  }
  assert.ok(lintCatalog(catalog).findings.some(f => f.code === 'PROTECTED_FAST_SKIP'))
})

test('NFR-SEC-002 the live catalog declares no bypass for a protected attribute', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(REPO, '.dsh', 'base', 'catalog.json'), 'utf8'))
  for (const [id, def] of Object.entries(catalog.checks || {})) {
    const isProtected = ['security', 'safety', 'privacy'].some(a => (def.attributes || []).includes(a)) ||
      ['security', 'safety', 'privacy'].includes(def.class)
    if (isProtected) assert.notEqual(def.allowFastSkip, true, 'check ' + id + ' must not be fast-skippable')
  }
})

test('NFR-SAFE-001 read-only subcommands leave the working tree untouched', () => {
  const dir = tempDir('readonly')
  try {
    const run = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true })
    run(['init', '-q', '-b', 'main'])
    run(['config', 'user.email', 'test@example.invalid'])
    run(['config', 'user.name', 'dsb test'])
    fs.mkdirSync(path.join(dir, 'src', 'a'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'src', 'a', 'index.mjs'), 'export const a = 1\n')
    fs.mkdirSync(path.join(dir, '.dsh', 'base'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.dsh', 'base', 'catalog.json'), JSON.stringify({
      version: 1,
      global: [], ignored: [{ path: '.dsh/**', reason: 'engine configuration' }],
      riskChecks: { low: [] }, checks: {},
      modules: [{ id: 'a', paths: ['src/a/**'], riskTier: 'low' }],
    }))
    run(['add', '-A'])
    run(['commit', '-q', '-m', 'fixture: a minimal governed repository'])

    const before = run(['status', '--porcelain']).stdout
    for (const cmd of [['doctor'], ['catalog-lint'], ['impact'], ['arch-check'], ['attributes'], ['risk']]) {
      dsb(cmd, { cwd: dir })
    }
    const after = run(['status', '--porcelain']).stdout
    const newEntries = after.split(/\r?\n/).filter(l => l.trim() && !before.includes(l.trim()))
    for (const entry of newEntries) {
      const p = entry.slice(3).trim().replace(/^"|"$/g, '')
      assert.ok(
        p.startsWith('.dsh/base/state/') || p.startsWith('.dsh/base/evidence/') ||
        p.startsWith('.dsh/base/receipts/') || p.startsWith('.dsh/base/waivers/') ||
        p.startsWith('.dsh/base/trend/'),
        'a read-only subcommand wrote outside the engine runtime directories: ' + p)
      assert.ok(!entry.startsWith(' M') && !entry.startsWith('M '), 'no tracked file may be modified: ' + entry)
    }
  } finally { rmDir(dir) }
})

test('NFR-MAINT-001 the engine has zero runtime dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
  assert.deepEqual(pkg.dependencies, {})
  assert.deepEqual(pkg.devDependencies, {})
})

test('NFR-MAINT-001 the engine imports only Node builtins and its own siblings', () => {
  const libDir = path.join(REPO, '.dsh', 'base', 'lib')
  const files = fs.readdirSync(libDir).filter(f => f.endsWith('.mjs'))
    .map(f => path.join(libDir, f))
    .concat([path.join(REPO, '.dsh', 'base', 'dsb.mjs'), path.join(REPO, '.dsh', 'base', 'install.mjs')])
  const re = /^\s*import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      const spec = m[1]
      const ok = spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../')
      assert.ok(ok, file + ' imports a third-party module: ' + spec)
    }
  }
})

test('NFR-MAINT-001 the audit scripts do not import the engine they audit', () => {
  const dir = path.join(REPO, '.dsh', 'base', 'audit')
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.mjs'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8')
    assert.equal(/\.dsh\/base\/lib/.test(text), false, f + ' must stay independent of the engine')
  }
})

test('the integrity manifest matches the distributed surface', () => {
  const r = script('manifest.mjs', ['--check'])
  assert.ok(r.json, 'the manifest check must always produce a machine-readable result')
  if (r.code !== 0) {
    assert.fail('manifest drift: ' + JSON.stringify({ changed: r.json.changed, added: r.json.added, removed: r.json.removed }))
  }
})
