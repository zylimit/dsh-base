#!/usr/bin/env node
// Golden-baseline ruler: pins the full stdout-JSON + exit-code contract of
// every subcommand across a matrix of repo states, then replays and diffs.
// Normalization is field-name-keyed, never blanket: timestamps and environment
// facts are masked, digests and counts stay verbatim - a re-record would most
// easily hide a change behind them.
//   node tests/golden-baseline.mjs --record | --check | --mutate
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const DSB = path.join(REPO, '.dsh', 'base', 'dsb.mjs')
const BASELINE = path.join(HERE, 'golden', 'baseline.json')
const MUTANTS = path.join(HERE, 'golden', 'MUTANTS.json')
const RC = 'REQ-' + 'GOLDEN-001'

function gitEnv () {
  return {
    ...process.env,
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00+00:00',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00+00:00',
    GIT_AUTHOR_NAME: 'golden', GIT_AUTHOR_EMAIL: 'g@e.invalid',
    GIT_COMMITTER_NAME: 'golden', GIT_COMMITTER_EMAIL: 'g@e.invalid',
  }
}

function tmpDir (name) {
  // realpath once: macOS serves /var as a symlink to /private/var, and git
  // reports the canonical path. The fixture and the mask must share one
  // spelling or a canonical-path detail becomes platform drift.
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsb-golden-' + name + '-')))
}

function gitInit (dir) {
  const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', env: gitEnv(), windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  return run
}

function catalogJson (over = {}) {
  return JSON.stringify({
    version: 1,
    global: [],
    ignored: [
      { path: '.dsh/**', reason: 'x' }, { path: 'progress.md', reason: 'memory' },
      { path: 'docs/**', reason: 'prose' }, { path: 'AGENTS.md', reason: 'constitution' },
    ],
    riskChecks: { low: ['unit'] },
    checks: { unit: { command: 'node --version', class: 'test', attributes: ['reliability'] } },
    modules: [
      { id: 'core', paths: ['src/core/**'], layer: 'domain', riskTier: 'low', dependsOn: ['store'], attributes: { reliability: 'low' } },
      { id: 'store', paths: ['src/store/**'], layer: 'domain', riskTier: 'low' },
      { id: 'api', paths: ['src/api/**'], layer: 'app', riskTier: 'low', dependsOn: ['core'] },
    ],
    trace: { requirementDirs: ['docs/requirements'], testGlobs: ['**/*.test.mjs'], minCoverage: 1 },
    adr: { dir: 'docs/adr' },
    ...over,
  }, null, 2)
}

const AGENTS_MD = [
  '# constitution', '', '## Purpose', 'golden fixture.', '',
  '## Boundaries', 'none.', '', '## Invariants', 'honesty.', '',
  '## Verification', 'Run \x60dsb gate\x60.', '',
  '## Rules', '',
  '- A real reference: \x60dsb gate\x60 exists.',
  '- A phantom reference: \x60.dsh/base/audit/ghost.mjs\x60 does not.',
  '- A phantom script name: \x60ghost.mjs\x60 does not exist.',
].join('\n')

function seedGoverned (dir, run) {
  for (const d of ['src/core', 'src/store', 'src/api', 'docs/requirements', 'docs/adr', '.dsh/base']) {
    fs.mkdirSync(path.join(dir, d), { recursive: true })
  }
  fs.writeFileSync(path.join(dir, 'src', 'core', 'a.mjs'), '// implements ' + RC + '\nexport const a = 1\n')
  fs.writeFileSync(path.join(dir, 'src', 'core', 'a.test.mjs'), '// verifies ' + RC + '\nexport const t = 1\n')
  fs.writeFileSync(path.join(dir, 'src', 'store', 's.mjs'), 'export const s = 1\n')
  fs.writeFileSync(path.join(dir, 'src', 'api', 'p.mjs'), 'export const p = 1\n')
  fs.writeFileSync(path.join(dir, 'docs', 'requirements', 'PRODUCT-SPEC.md'), '# spec\n\n### ' + RC + ' - one\n\nWHEN the program runs, the system SHALL return one.\n\nAcceptance: the value is 1.\n')
  fs.writeFileSync(path.join(dir, 'docs', 'requirements', 'PRODUCT-SPEC-CHANGELOG.md'), '# changelog\n')
  fs.writeFileSync(path.join(dir, 'docs', 'adr', '0001-start.md'), '# ADR 1 - start\n\nEnforced-by: selftest\n')
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), AGENTS_MD)
  fs.writeFileSync(path.join(dir, 'progress.md'), '# progress.md\n\n## Pinned\n\n## Done\n')
  fs.writeFileSync(path.join(dir, '.dsh', 'base', 'catalog.json'), catalogJson())
  run(['add', '-A']); run(['commit', '-q', '-m', 'fixture'])
  return dir
}

const S1_COMMANDS = [
  ['selftest'], ['doctor'], ['catalog-lint'], ['impact'], ['budget'], ['recap'], ['release'],
]
const S2_COMMANDS = [
  ['selftest'], ['doctor'], ['catalog-lint'], ['impact'], ['arch-check'], ['attributes'],
  ['adr-check'], ['rules-audit'], ['dod'], ['fast', 'status'], ['budget'], ['trace'],
  ['spec-lint'], ['spec', '--all'], ['task', 'status'], ['diff-hash'], ['recap'],
  ['invariants'], ['sync-check'], ['risk'], ['release'], ['gate', '--dry-run'],
  ['audit', 'scan-secrets.mjs'], ['audit', 'check-syntax.mjs'],
]
const S3_COMMANDS = [
  ['impact'], ['budget'], ['task', 'status'], ['gate', '--dry-run'],
  ['spec', '--paths', 'src/core/a.mjs'], ['sync-check'], ['risk'],
]
const S4_COMMANDS = [
  ['catalog-lint'], ['trace'], ['arch-check'], ['adr-check'], ['rules-audit'],
  ['attributes'], ['task', 'status'], ['risk'],
]

function scenarios () {
  const out = {}

  const nongit = tmpDir('nongit')
  out.nonGit = { dir: nongit, commands: S1_COMMANDS }

  const clean = tmpDir('clean')
  const runC = gitInit(clean)
  seedGoverned(clean, runC)
  out.governedClean = { dir: clean, commands: S2_COMMANDS }

  const dirty = tmpDir('dirty')
  const runD = gitInit(dirty)
  seedGoverned(dirty, runD)
  fs.appendFileSync(path.join(dirty, 'src', 'core', 'a.mjs'), '// a change under review\n')
  fs.appendFileSync(path.join(dirty, 'progress.md'), '\n## Done\n\n- entry\n')
  out.governedDirty = { dir: dirty, commands: S3_COMMANDS }

  const debt = tmpDir('debt')
  const runE = gitInit(debt)
  seedGoverned(debt, runE)
  fs.writeFileSync(path.join(debt, 'stray.txt'), 'tracked by nobody\n')
  fs.writeFileSync(path.join(debt, '.dsh', 'base', 'catalog.json'), catalogJson({
    modules: [
      { id: 'core', paths: ['src/**'], layer: 'domain', riskTier: 'low', dependsOn: ['missing'], attributes: { reliability: 'low' } },
      { id: 'api', paths: ['src/api/**'], layer: 'app', riskTier: 'low', dependsOn: ['core'] },
    ],
  }))
  fs.mkdirSync(path.join(debt, '.dsh', 'base', 'state'), { recursive: true })
  fs.writeFileSync(path.join(debt, '.dsh', 'base', 'state', 'task.json'), '{ corrupt')
  runE(['add', '-A']); runE(['commit', '-q', '-m', 'debt'])
  out.governedDebt = { dir: debt, commands: S4_COMMANDS }

  return out
}

// ── normalization (field-name-keyed; digests and counts verbatim) ──────────

const TS_KEYS = /(^|_)(at|createdAt|completedAt|startedAt|endedAt|until|durationMs|elapsed|timestamp)(_|$)/i
const ENV_KEYS = /^(node|platform|root|headCommit|baseCommit|version|arch|homedir|user|tmpdir|os|renamedTo|packPath|evidence)$/i

function normalize (value, key, fixtureDir) {
  if (value === null || value === undefined) return value
  if (typeof value === 'number') return TS_KEYS.test(String(key || '')) ? '<NUM>' : value
  if (typeof value === 'string') {
    if (TS_KEYS.test(String(key || ''))) return '<TS>'
    if (ENV_KEYS.test(String(key || ''))) return '<ENV>'
    return value
      .split(fixtureDir).join('<FIXTURE>')
      .replace(/node v?\d+\.\d+\.\d+/gi, 'node <VER>')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<ISO>')
      // The fixture requirement id is an artifact of the fixture, not of the
      // engine; echoing it into the baseline would also trip the host repo's
      // own trace scan (tests/** is a test glob).
      .split(RC).join('<REQ>')
  }
  if (Array.isArray(value)) return value.map(v => normalize(v, key, fixtureDir))
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = normalize(v, k, fixtureDir)
    return out
  }
  return value
}

// ── execution ───────────────────────────────────────────────────────────────

function runCommand (dir, cmd) {
  const args = cmd[0] === 'audit'
    ? [path.join(REPO, '.dsh', 'base', 'audit', cmd[1])]
    : [DSB, ...cmd]
  const r = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', env: gitEnv(), windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  let json = null
  try { json = JSON.parse(r.stdout) } catch { json = { unparsed: String(r.stdout).slice(0, 200) } }
  return { exit: r.status === null ? -1 : r.status, json }
}

function collect (scn) {
  const rows = []
  for (const cmd of scn.commands) {
    const r = runCommand(scn.dir, cmd)
    rows.push({ cmd: cmd.join(' '), exit: r.exit, json: normalize(r.json, null, scn.dir) })
  }
  return rows
}

function firstDiff (a, b, p = '$') {
  if (typeof a !== typeof b) return p + ' type ' + typeof a + ' vs ' + typeof b
  if (a === null || b === null || typeof a !== 'object') return a === b ? null : p + ' ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)
  if (Array.isArray(a)) {
    if (a.length !== b.length) return p + ' length ' + a.length + ' vs ' + b.length
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], p + '[' + i + ']'); if (d) return d }
    return null
  }
  for (const k of Object.keys(a)) if (!(k in b)) return p + '.' + k + ' missing'
  for (const k of Object.keys(b)) if (!(k in a)) return p + '.' + k + ' added'
  for (const k of Object.keys(a)) { const d = firstDiff(a[k], b[k], p + '.' + k); if (d) return d }
  return null
}

function checkAgainst (baseline) {
  const scn = scenarios()
  const drift = []
  for (const [name, rows] of Object.entries(baseline.scenarios)) {
    const now = collect(scn[name])
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i], b = now[i]
      if (!b) { drift.push({ scenario: name, cmd: a.cmd, issue: 'command missing from run' }); continue }
      if (a.exit !== b.exit) { drift.push({ scenario: name, cmd: a.cmd, issue: 'exit ' + a.exit + ' vs ' + b.exit }); continue }
      const d = firstDiff(a.json, b.json)
      if (d) drift.push({ scenario: name, cmd: a.cmd, issue: d })
    }
  }
  return { ok: drift.length === 0, drift }
}

function loadBaseline () {
  return JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
}

// ── mutation mode ───────────────────────────────────────────────────────────

function mutate () {
  const mutants = JSON.parse(fs.readFileSync(MUTANTS, 'utf8'))
  // Every applied mutation is backed up in memory and restored on process exit,
  // so even a hard crash cannot leave a mutant inside the engine.
  const backups = new Map()
  process.on('exit', () => {
    for (const [file, original] of backups) {
      try { fs.writeFileSync(file, original) } catch { /* best effort */ }
    }
  })
  // Only the mutant's own target must be clean: untracked new files elsewhere
  // are none of our business, and a mutation must never clobber someone's
  // uncommitted edit to the file it rewrites.
  const dirtyTracked = new Set([
    ...spawnSync('git', ['diff', '--name-only'], { cwd: REPO, encoding: 'utf8', windowsHide: true }).stdout.trim().split(/\r?\n/).filter(Boolean),
    ...spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: REPO, encoding: 'utf8', windowsHide: true }).stdout.trim().split(/\r?\n/).filter(Boolean),
  ])
  for (const m of mutants) {
    if (dirtyTracked.has(m.file)) {
      process.stderr.write('mutate: ' + m.file + ' has uncommitted edits; refusing to clobber them\n')
      process.exit(2)
    }
  }
  const baseline = loadBaseline()
  const results = []
  for (const m of mutants) {
    const file = path.join(REPO, m.file)
    const original = fs.readFileSync(file, 'utf8')
    if (!original.includes(m.find)) { results.push({ name: m.name, outcome: 'not-applied', note: 'find string missing' }); continue }
    const mutated = original.replace(m.find, m.replace)
    backups.set(file, original)
    fs.writeFileSync(file, mutated)
    let killed = false
    let issue = ''
    try {
      const c = checkAgainst(baseline)
      killed = !c.ok
      issue = c.drift[0] ? c.drift[0].scenario + '/' + c.drift[0].cmd + ': ' + c.drift[0].issue : ''
    } finally {
      fs.writeFileSync(file, original)
      backups.delete(file)
    }
    results.push({ name: m.name, outcome: killed ? 'killed' : 'SURVIVED', issue })
  }
  const killed = results.filter(r => r.outcome === 'killed').length
  const applied = results.filter(r => r.outcome !== 'not-applied').length
  process.stdout.write(JSON.stringify({ command: 'golden-mutate', ok: killed === applied, killRate: applied ? killed + '/' + applied : 'n/a', results }) + '\n')
  process.exit(killed === applied ? 0 : 1)
}

// ── main ────────────────────────────────────────────────────────────────────

const mode = process.argv.includes('--mutate') ? 'mutate'
  : process.argv.includes('--record') ? 'record'
  : process.argv.includes('--check') ? 'check' : 'check'

if (mode === 'mutate') mutate()
else {
  const scn = scenarios()
  if (mode === 'record') {
    const doc = { version: 1, generator: 'tests/golden-baseline.mjs', scenarios: {} }
    for (const [name, s] of Object.entries(scn)) doc.scenarios[name] = collect(s)
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true })
    fs.writeFileSync(BASELINE, JSON.stringify(doc, null, 2) + '\n')
    process.stdout.write(JSON.stringify({ command: 'golden-record', ok: true, scenarios: Object.keys(doc.scenarios), rows: Object.values(doc.scenarios).reduce((n, r) => n + r.length, 0) }) + '\n')
    process.exit(0)
  }
  const c = checkAgainst(loadBaseline())
  process.stdout.write(JSON.stringify({ command: 'golden-check', ok: c.ok, drift: c.drift.slice(0, 20), driftCount: c.drift.length }) + '\n')
  process.exit(c.ok ? 0 : 1)
}
