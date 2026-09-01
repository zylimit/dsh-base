// The installer is the only component every adopting repository runs, and it runs
// once, unattended, across many trees. Its failure modes are silent: a file
// overwritten, a file missed, another project's requirements seeded as if they
// were yours. These tests pin the policy.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { tempDir, rmDir, REPO } from './helpers.mjs'

function install (targets, flags = []) {
  const args = [path.join(REPO, 'scripts', 'install.mjs'), ...targets, ...flags]
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', windowsHide: true })
  let json = null
  const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop()
  if (line) { try { json = JSON.parse(line) } catch { json = null } }
  return { code: r.status, json, stderr: r.stderr || '' }
}

function initRepo (dir) {
  const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 'test@example.invalid'])
  run(['config', 'user.name', 'installer test'])
  return run
}

const listFiles = (dir) => {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else out.push(path.relative(dir, full).split(path.sep).join('/'))
    }
  }
  walk(dir)
  return out
}

test('the installer never ships the scaffold own requirements or decisions', () => {
  const dir = tempDir('inst-exclude')
  try {
    initRepo(dir)
    assert.equal(install([dir]).code, 0)
    const files = listFiles(dir)
    assert.equal(files.some(f => f.startsWith('docs/requirements/')), false,
      'installing our specification would make spec-lint pass on a spec nobody in that project wrote')
    assert.equal(files.some(f => /^docs\/adr\/ADR-/.test(f)), false,
      'installing our decisions would seed another project architecture history')
    assert.ok(files.includes('docs/adr/README.md'), 'the ADR contract itself is reference material and is installed')
    assert.ok(files.includes('docs/OPERATING-MODEL.md'))
    assert.ok(files.includes('.dsh/base/dsb.mjs'))
    assert.ok(files.includes('.dsh/base/catalog.example.json'))
    assert.equal(files.includes('.dsh/base/catalog.json'), false, 'governance stays off until the adopter enables it')
  } finally { rmDir(dir) }
})

test('project memory is seeded from the template, never from our ledger', () => {
  const dir = tempDir('inst-seed')
  try {
    initRepo(dir)
    assert.equal(install([dir]).code, 0)
    const seeded = fs.readFileSync(path.join(dir, 'progress.md'), 'utf8')
    const ours = fs.readFileSync(path.join(REPO, 'progress.md'), 'utf8')
    assert.notEqual(seeded, ours, 'a new project must not inherit our Done entries and TODO ids')
  } finally { rmDir(dir) }
})

test('a second install changes nothing', () => {
  const dir = tempDir('inst-idem')
  try {
    initRepo(dir)
    const first = install([dir])
    assert.equal(first.code, 0)
    assert.ok(first.json.results[0].copied > 50)

    const second = install([dir])
    assert.equal(second.code, 0)
    const r = second.json.results[0]
    assert.equal(r.copied, 0, 'a repeat install must copy nothing')
    assert.deepEqual(r.staged, [], 'a repeat install must stage nothing')
    assert.ok(r.unchanged > 50)
  } finally { rmDir(dir) }
})

test('line-ending style alone never counts as a difference', () => {
  const dir = tempDir('inst-crlf')
  try {
    initRepo(dir)
    assert.equal(install([dir]).code, 0)
    const target = path.join(dir, '.dsh', 'base', 'lib', 'core.mjs')
    const text = fs.readFileSync(target, 'utf8')
    fs.writeFileSync(target, text.replace(/(?<!\r)\n/g, '\r\n'))
    const again = install([dir])
    assert.deepEqual(again.json.results[0].staged, [],
      'a CRLF checkout would otherwise stage every managed file on every batch install')
  } finally { rmDir(dir) }
})

test('a modified managed file is staged for review, never overwritten', () => {
  const dir = tempDir('inst-stage')
  try {
    initRepo(dir)
    assert.equal(install([dir]).code, 0)
    const target = path.join(dir, '.dsh', 'skills', 'test-strategy', 'SKILL.md')
    fs.writeFileSync(target, '---\nname: test-strategy\ndescription: Use when the project edited this skill.\n---\n\nlocal edit\n')
    const again = install([dir])
    assert.deepEqual(again.json.results[0].staged, ['.dsh/skills/test-strategy/SKILL.md'])
    assert.match(fs.readFileSync(target, 'utf8'), /local edit/, 'the project edit must survive')
    assert.equal(fs.existsSync(target + '.deepseek-base-new'), true, 'the update must be available beside it')
  } finally { rmDir(dir) }
})

test('a project file that already exists is kept', () => {
  const dir = tempDir('inst-kept')
  try {
    initRepo(dir)
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# our own constitution\n')
    fs.writeFileSync(path.join(dir, 'progress.md'), '# our own memory\n')
    const r = install([dir])
    assert.equal(r.code, 0)
    assert.ok(r.json.results[0].kept.includes('AGENTS.md'))
    assert.ok(r.json.results[0].kept.includes('progress.md'))
    assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /our own constitution/)
  } finally { rmDir(dir) }
})

test('a dry run writes nothing', () => {
  const dir = tempDir('inst-dry')
  try {
    initRepo(dir)
    const r = install([dir], ['--dry-run'])
    assert.equal(r.code, 0)
    assert.equal(r.json.dryRun, true)
    assert.ok(r.json.results[0].copied > 50, 'it must still report what it would do')
    assert.equal(listFiles(dir).length, 0, 'and write none of it')
  } finally { rmDir(dir) }
})

test('a missing git repository is reported, and hooks are skipped rather than faked', () => {
  const dir = tempDir('inst-nogit')
  try {
    const r = install([dir], ['--hooks'])
    assert.equal(r.code, 0)
    const w = r.json.results[0].warnings.join(' | ')
    assert.match(w, /not a git repository/)
    assert.match(w, /hooks skipped/)
  } finally { rmDir(dir) }
})

test('one bad target does not stop the batch, and the run reports failure', () => {
  const good = tempDir('inst-batch-good')
  try {
    initRepo(good)
    const r = install([good, REPO])
    assert.equal(r.code, 1, 'a batch with a rejected target must not exit 0')
    assert.equal(r.json.results.length, 2)
    const self = r.json.results.find(x => path.resolve(x.target) === path.resolve(REPO))
    assert.equal(self.ok, false)
    assert.match(self.errors.join(' '), /into itself/)
    assert.equal(r.json.results.find(x => path.resolve(x.target) === path.resolve(good)).ok, true,
      'the healthy target must still be installed')
  } finally { rmDir(good) }
})

test('an unknown option fails loudly instead of being treated as a target', () => {
  const r = install([], ['--not-an-option'])
  assert.equal(r.code, 2)
})
