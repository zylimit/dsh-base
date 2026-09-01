// Project memory is what makes "clear the session and resume" safe. These tests
// pin the two properties that keep it usable as a project ages: the ledger can
// never fall behind the code, and recovery costs a fixed amount however long the
// history gets.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir } from './helpers.mjs'

function governedRepo (opts = {}) {
  const dir = tempDir('memory')
  const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 'test@example.invalid'])
  run(['config', 'user.name', 'memory test'])

  fs.mkdirSync(path.join(dir, 'src', 'api'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'api', 'index.mjs'), 'export const a = 1\n')
  fs.mkdirSync(path.join(dir, 'docs', 'requirements'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'docs', 'requirements', 'PRODUCT-SPEC.md'), '# spec\n')
  fs.writeFileSync(path.join(dir, 'docs', 'requirements', 'PRODUCT-SPEC-CHANGELOG.md'), '# changelog\n')

  const done = []
  for (let i = 0; i < (opts.doneEntries || 3); i++) {
    done.push('- 2026-01-0' + ((i % 9) + 1) + ' | #' + String(i).padStart(3, '0') + ' did a thing | evidence: dsb gate PASS exit 0')
  }
  fs.writeFileSync(path.join(dir, 'progress.md'), [
    '# progress.md', '',
    '## Pinned', '- Goal: keep the fixture honest', '',
    '## Decisions', '- 2026-01-01 | chose A over B | because C | ADR-0001', '',
    '## TODO', '- #001 P0 do the blocking thing', '- #002 P1 do the next thing', '- #003 P2 defer this (raise to P1 when X)', '',
    '## In progress', '- #001 | agent | blocked on: nothing', '',
    '## Done', ...done, '',
    '## Risks and assumptions', '- RISK something | trigger: x | mitigation: y', '',
    '## Notes', '- a note', '',
    '## Context index', '- spec: docs/requirements/PRODUCT-SPEC.md', '',
  ].join('\n'))

  fs.mkdirSync(path.join(dir, '.dsh', 'base'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.dsh', 'base', 'catalog.json'), JSON.stringify({
    version: 1,
    global: [], ignored: [
      { path: 'progress.md', reason: 'memory' },
      { path: 'progress.archive.md', reason: 'archived memory' },
      { path: 'docs/**', reason: 'prose' },
      { path: '.dsh/**', reason: 'vendored tooling' },
    ],
    riskChecks: { low: [] }, checks: {},
    modules: [{ id: 'api', paths: ['src/api/**'], riskTier: 'low' }],
    memory: opts.memory || undefined,
  }, null, 2))

  run(['add', '-A'])
  run(['commit', '-q', '-m', 'fixture: a governed repository with memory'])
  return { dir, run }
}

test('sync-check blocks a commit that moves code without the ledger', () => {
  const { dir, run } = governedRepo()
  try {
    fs.writeFileSync(path.join(dir, 'src', 'api', 'index.mjs'), 'export const a = 2\n')
    run(['add', '-A'])
    const bad = dsb(['sync-check', '--staged'], { cwd: dir })
    assert.equal(bad.code, 1, 'memory must not fall behind the code')
    assert.ok(bad.json.findings.some(f => f.code === 'MEMORY_BEHIND_CODE'))

    fs.appendFileSync(path.join(dir, 'progress.md'), '\n')
    run(['add', '-A'])
    const good = dsb(['sync-check', '--staged'], { cwd: dir })
    assert.equal(good.code, 0, JSON.stringify(good.json && good.json.findings))
  } finally { rmDir(dir) }
})

test('sync-check requires a changelog entry with a specification edit', () => {
  const { dir, run } = governedRepo()
  try {
    fs.writeFileSync(path.join(dir, 'docs', 'requirements', 'PRODUCT-SPEC.md'), '# spec\n\nREQ-X\n')
    run(['add', '-A'])
    const bad = dsb(['sync-check', '--staged'], { cwd: dir })
    assert.equal(bad.code, 1)
    assert.ok(bad.json.findings.some(f => f.code === 'SPEC_WITHOUT_CHANGELOG'))

    fs.appendFileSync(path.join(dir, 'docs', 'requirements', 'PRODUCT-SPEC-CHANGELOG.md'), '\n## 1.1\n- added REQ-X\n')
    run(['add', '-A'])
    assert.equal(dsb(['sync-check', '--staged'], { cwd: dir }).code, 0)
  } finally { rmDir(dir) }
})

test('recap stays inside its budget however long the history is', () => {
  const { dir } = governedRepo({ doneEntries: 400 })
  try {
    const r = dsb(['recap', '--budget', '4000'], { cwd: dir })
    assert.equal(r.code, 0)
    assert.ok(r.json.chars <= 4000 + 200, 'recap was ' + r.json.chars + ' chars against a 4000 budget')
    assert.match(r.json.text, /## Position/)
    assert.match(r.json.text, /## Pinned/)
    // Cost must not scale with the number of Done entries.
    assert.equal(r.json.text.split('did a thing').length - 1 <= 6, true, 'recap must quote a bounded number of Done entries')
  } finally { rmDir(dir) }
})

test('recap reports a P1 item and does not mistake prose for a priority', () => {
  const { dir } = governedRepo()
  try {
    const r = dsb(['recap'], { cwd: dir })
    assert.match(r.json.text, /#002 P1 do the next thing/)
    assert.equal(/#003 P2 defer this/.test(r.json.text.split('## Recent decisions')[0]), false,
      'a P2 entry that merely mentions P1 in its condition must not be listed as P1')
  } finally { rmDir(dir) }
})

test('archive moves the oldest entries and loses none of them', () => {
  const { dir } = governedRepo({ doneEntries: 60, memory: { keepDone: 10, keepNotes: 5 } })
  try {
    const before = fs.readFileSync(path.join(dir, 'progress.md'), 'utf8')
    const beforeCount = before.split('\n').filter(l => l.includes('did a thing')).length
    assert.equal(beforeCount, 60)

    const dry = dsb(['archive'], { cwd: dir })
    assert.equal(dry.code, 0)
    assert.equal(dry.json.applied, false)
    assert.equal(dry.json.moved, 50)
    assert.equal(fs.readFileSync(path.join(dir, 'progress.md'), 'utf8'), before, 'a dry run writes nothing')

    const applied = dsb(['archive', '--apply'], { cwd: dir })
    assert.equal(applied.code, 0)
    assert.equal(applied.json.applied, true)

    const live = fs.readFileSync(path.join(dir, 'progress.md'), 'utf8')
    const archived = fs.readFileSync(path.join(dir, 'progress.archive.md'), 'utf8')
    assert.equal(live.split('\n').filter(l => l.includes('did a thing')).length, 10)
    assert.equal(archived.split('\n').filter(l => l.includes('did a thing')).length, 50,
      'history moves, it never disappears')
    assert.match(live, /progress\.archive\.md/, 'the live ledger points at the archive')
    // Everything still readable somewhere.
    for (let i = 0; i < 60; i++) {
      const id = '#' + String(i).padStart(3, '0')
      assert.ok(live.includes(id) || archived.includes(id), 'entry ' + id + ' was lost')
    }
  } finally { rmDir(dir) }
})

test('archive is a no-op while the ledger is inside its budget', () => {
  const { dir } = governedRepo({ doneEntries: 3 })
  try {
    const r = dsb(['archive', '--apply'], { cwd: dir })
    assert.equal(r.code, 0)
    assert.equal(r.json.moved, 0)
    assert.equal(fs.existsSync(path.join(dir, 'progress.archive.md')), false)
  } finally { rmDir(dir) }
})

test('init isolates the tool, keeps memory tracked, and is idempotent', () => {
  const { dir } = governedRepo()
  try {
    const first = dsb(['init'], { cwd: dir })
    assert.equal(first.code, 0)
    assert.equal(first.json.mode, 'private')

    const ignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')
    assert.match(ignore, /^\.dsh\/$/m, 'the tool is isolated')
    assert.equal(/^progress\.md$/m.test(ignore), false,
      'project memory must stay tracked: it is what another machine resumes from')
    assert.equal(/^AGENTS\.md$/m.test(ignore), false, 'the constitution is not ignored by default')

    const hooks = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: dir, encoding: 'utf8' })
    assert.equal(hooks.stdout.trim(), '.dsh/base/githooks')

    const second = dsb(['init'], { cwd: dir })
    assert.equal(second.code, 0)
    assert.equal(second.json.isolation.already, true, 'a second init adds nothing')
    assert.equal(second.json.hooks.already, true)
    assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), ignore, 'and rewrites nothing')
  } finally { rmDir(dir) }
})

test('init --ignore-constitution also isolates AGENTS.md', () => {
  const { dir } = governedRepo()
  try {
    assert.equal(dsb(['init', '--ignore-constitution'], { cwd: dir }).code, 0)
    const ignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')
    assert.match(ignore, /^AGENTS\.md$/m)
    assert.equal(/^progress\.md$/m.test(ignore), false)
  } finally { rmDir(dir) }
})

test('init --exclude-file leaves no trace in the repository', () => {
  const { dir } = governedRepo()
  try {
    assert.equal(dsb(['init', '--exclude-file'], { cwd: dir }).code, 0)
    assert.equal(fs.existsSync(path.join(dir, '.gitignore')), false, 'nothing was added to a committed file')
    const exclude = fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8')
    assert.match(exclude, /^\.dsh\/$/m)
  } finally { rmDir(dir) }
})
