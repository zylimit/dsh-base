#!/usr/bin/env node
// deepseek-base installer. One implementation; setup.sh and setup.ps1 are thin
// wrappers over it, so there is no shell/PowerShell parity to maintain.
//
//   node scripts/install.mjs <target...> [options]
//
//   --dry-run            report what would happen, write nothing
//   --enable             seed .dsh/base/catalog.json from catalog.example.json
//   --hooks              set core.hooksPath and mark the hooks executable
//   --stage              git add the installed files (implied by --verify in a repo)
//   --verify             run doctor / selftest / skills-lint / catalog-lint after installing
//   --targets-from FILE  read one target path per line (blank lines and # ignored)
//   --json               print only the machine-readable line
//
// Policy:
//   managed  - overwritten only when identical; a difference is staged beside the
//              original as <file>.deepseek-base-new and never applied silently
//   seeded   - written once; an existing project file is always kept
//   excluded - the scaffold's own instance data (requirements, ADRs, runtime state)
//
// Exit: 0 every target clean | 1 a target needs attention | 2 usage or fatal error

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import url from 'node:url'
import process from 'node:process'

const SRC = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')

const MANAGED_ROOTS = ['.dsh', 'docs', 'scripts']

// Never installed. Runtime state is local; requirements and decisions belong to
// the project that wrote them, and installing ours would make spec-lint pass on a
// specification nobody in the adopting project ever wrote.
const EXCLUDE_PREFIX = [
  '.dsh/base/state/', '.dsh/base/evidence/', '.dsh/base/receipts/', '.dsh/base/waivers/',
  'docs/requirements/', 'docs/adr/ADR-',
]
const EXCLUDE_EXACT = new Set(['.dsh/base/catalog.json'])

// Written once, then owned by the project. progress.md is seeded from the template
// rather than from our own ledger: a new project starts with an empty memory.
const SEEDS = [
  { to: 'AGENTS.md', from: 'AGENTS.md' },
  { to: '.editorconfig', from: '.editorconfig' },
  { to: '.gitattributes', from: '.gitattributes' },
  { to: 'cordis.patch.yml', from: 'cordis.patch.yml' },
  { to: 'progress.md', from: '.dsh/templates/PROGRESS.md' },
]

const HOOKS = ['pre-commit', 'commit-msg', 'pre-push']
const HOOKS_PATH = '.dsh/base/githooks'

// ── helpers ─────────────────────────────────────────────────────────────────

// Content identity ignores line-ending style. Without this, a target checked out
// with CRLF would report every managed file as differing on every install.
const hashLf = (buf) => crypto.createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n')).digest('hex')

function walk (dir, base, out) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    const rel = path.relative(base, full).split(path.sep).join('/')
    if (e.isDirectory()) walk(full, base, out)
    else if (e.isFile()) out.push(rel)
  }
  return out
}

function managedFiles () {
  const all = []
  for (const rootDir of MANAGED_ROOTS) {
    const full = path.join(SRC, rootDir)
    if (fs.existsSync(full)) walk(full, SRC, all)
  }
  return all
    .filter(rel => !EXCLUDE_EXACT.has(rel))
    .filter(rel => !EXCLUDE_PREFIX.some(p => rel.startsWith(p)))
    .sort()
}

function git (args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return { ok: r.status === 0, code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

function isGitRepo (dir) {
  return git(['rev-parse', '--is-inside-work-tree'], dir).ok
}

function gitTopLevel (dir) {
  const r = git(['rev-parse', '--show-toplevel'], dir)
  return r.ok ? path.resolve(r.stdout.trim()) : null
}

function dsb (dir, args) {
  const r = spawnSync(process.execPath, [path.join(dir, '.dsh', 'base', 'dsb.mjs'), ...args], {
    cwd: dir, encoding: 'utf8', windowsHide: true, env: { ...process.env, DSB_ROOT: dir },
  })
  let json = null
  const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop()
  if (line) { try { json = JSON.parse(line) } catch { json = null } }
  return { code: r.status, json }
}

// ── one target ──────────────────────────────────────────────────────────────

function install (target, opts) {
  const result = {
    target, ok: false, copied: 0, unchanged: 0, staged: [], kept: [], seeded: [],
    warnings: [], errors: [], verify: null,
  }

  let dst
  try {
    fs.mkdirSync(target, { recursive: true })
    dst = fs.realpathSync(target)
  } catch (e) {
    result.errors.push('cannot create or resolve target: ' + e.message)
    return result
  }

  if (path.resolve(dst) === path.resolve(SRC)) {
    result.errors.push('refusing to install the scaffold into itself')
    return result
  }

  // The project root is the nearest .git ancestor. Without an own repository the
  // engine would govern whichever tree happens to be above this directory.
  const top = gitTopLevel(dst)
  if (!top) {
    result.warnings.push('not a git repository: every git-derived capability will degrade (exit 3). Run: git init')
  } else if (top !== dst) {
    result.warnings.push('this directory is inside the repository at ' + top + '; the engine will govern that tree, not this subdirectory')
  }

  const write = (rel, buf) => {
    if (opts.dryRun) return
    const to = path.join(dst, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.writeFileSync(to, buf)
  }

  for (const rel of managedFiles()) {
    const from = path.join(SRC, rel)
    const to = path.join(dst, rel)
    const src = fs.readFileSync(from)
    if (!fs.existsSync(to)) { write(rel, src); result.copied++; continue }
    if (hashLf(src) === hashLf(fs.readFileSync(to))) { result.unchanged++; continue }
    write(rel + '.deepseek-base-new', src)
    result.staged.push(rel)
  }

  for (const seed of SEEDS) {
    const to = path.join(dst, seed.to)
    if (fs.existsSync(to)) { result.kept.push(seed.to); continue }
    const from = path.join(SRC, seed.from)
    if (!fs.existsSync(from)) continue
    write(seed.to, fs.readFileSync(from))
    result.seeded.push(seed.to + (seed.from === seed.to ? '' : ' (from ' + seed.from + ')'))
    result.copied++
  }

  if (opts.enable) {
    const catalog = path.join(dst, '.dsh', 'base', 'catalog.json')
    const example = path.join(dst, '.dsh', 'base', 'catalog.example.json')
    if (fs.existsSync(catalog)) result.kept.push('.dsh/base/catalog.json')
    else if (opts.dryRun) result.seeded.push('.dsh/base/catalog.json (from catalog.example.json)')
    else if (fs.existsSync(example)) {
      fs.copyFileSync(example, catalog)
      result.seeded.push('.dsh/base/catalog.json (from catalog.example.json)')
    }
  }

  if (opts.hooks && !opts.dryRun) {
    if (!top) result.warnings.push('--hooks skipped: not a git repository')
    else {
      const set = git(['config', 'core.hooksPath', HOOKS_PATH], dst)
      if (!set.ok) result.warnings.push('could not set core.hooksPath: ' + set.stderr.trim())
      // Copying through a filesystem that has no execute bit leaves the hooks
      // non-executable on Linux and macOS. Record the mode in the index so the
      // repository carries it wherever it is cloned next.
      for (const h of HOOKS) {
        const p = HOOKS_PATH + '/' + h
        if (!fs.existsSync(path.join(dst, p))) continue
        try { fs.chmodSync(path.join(dst, p), 0o755) } catch { /* filesystem without modes */ }
        const add = git(['add', '--chmod=+x', '--', p], dst)
        if (!add.ok) result.warnings.push('could not record the executable bit for ' + p)
      }
    }
  }

  // Verification before staging would measure an empty tracked set and call it
  // clean, which is exactly the false green this scaffold exists to prevent.
  if ((opts.stage || opts.verify) && !opts.dryRun && top === dst) {
    const add = git(['add', '-A', '--', '.'], dst)
    if (!add.ok) result.warnings.push('could not stage the installation: ' + add.stderr.trim())
    else result.staged_in_index = true
  }

  if (opts.verify && !opts.dryRun) {
    const v = { }
    const doctor = dsb(dst, ['doctor'])
    v.doctor = doctor.json ? { enabled: doctor.json.enabled, skills: doctor.json.skills, failing: doctor.json.failing } : { error: 'no output' }
    v.selftest = dsb(dst, ['selftest']).code
    v.skillsLint = dsb(dst, ['skills-lint']).code
    const hasCatalog = fs.existsSync(path.join(dst, '.dsh', 'base', 'catalog.json'))
    const cl = hasCatalog ? dsb(dst, ['catalog-lint']) : null
    v.catalogLint = cl ? cl.code : null
    v.trackedPaths = cl && cl.json && cl.json.counts ? cl.json.counts.trackedPaths : null
    v.unmapped = cl && cl.json && cl.json.counts ? cl.json.counts.unmapped : null
    if (cl && v.trackedPaths === 0) {
      result.warnings.push('catalog-lint measured 0 tracked paths, so it proved nothing; stage the tree and run it again')
    }
    result.verify = v
    if (v.selftest !== 0) result.errors.push('engine self-test failed in the installed copy (exit ' + v.selftest + ')')
    if (v.skillsLint !== 0) result.errors.push('skills-lint failed in the installed copy (exit ' + v.skillsLint + ')')
    if (hasCatalog && v.catalogLint !== 0) {
      result.warnings.push('catalog-lint exit ' + v.catalogLint + ': the seeded catalog still describes placeholder modules and does not classify this project source yet')
    }
  }

  result.ok = result.errors.length === 0
  return result
}

// ── cli ─────────────────────────────────────────────────────────────────────

function parse (argv) {
  const targets = []
  const opts = { dryRun: false, enable: false, hooks: false, verify: false, stage: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') opts.dryRun = true
    else if (a === '--enable') opts.enable = true
    else if (a === '--hooks') opts.hooks = true
    else if (a === '--verify') opts.verify = true
    else if (a === '--stage') opts.stage = true
    else if (a === '--json') opts.json = true
    else if (a === '--targets-from') {
      const file = argv[++i]
      if (!file || !fs.existsSync(file)) { console.error('install: --targets-from needs an existing file'); process.exit(2) }
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const t = line.trim()
        if (t && !t.startsWith('#')) targets.push(t)
      }
    } else if (a.startsWith('--')) { console.error('install: unknown option ' + a); process.exit(2) }
    else targets.push(a)
  }
  return { targets, opts }
}

const { targets, opts } = parse(process.argv.slice(2))
if (targets.length === 0) {
  console.error('usage: node scripts/install.mjs <target...> [--dry-run] [--enable] [--hooks] [--stage] [--verify] [--targets-from FILE] [--json]')
  process.exit(2)
}

const results = targets.map(t => install(path.resolve(t), opts))

if (!opts.json) {
  const verb = opts.dryRun ? 'would install' : 'installed'
  for (const r of results) {
    process.stderr.write('\n' + (r.ok ? '  ok  ' : ' FAIL ') + verb + ' -> ' + r.target + '\n')
    process.stderr.write('        copied ' + r.copied + ', unchanged ' + r.unchanged +
      ', staged ' + r.staged.length + ', kept ' + r.kept.length + '\n')
    for (const s of r.seeded) process.stderr.write('        seeded: ' + s + '\n')
    for (const s of r.staged) process.stderr.write('        differs, staged for review: ' + s + '.deepseek-base-new\n')
    for (const w of r.warnings) process.stderr.write('        warn: ' + w + '\n')
    for (const e of r.errors) process.stderr.write('        ERROR: ' + e + '\n')
    if (r.verify) {
      process.stderr.write('        verify: selftest=' + r.verify.selftest +
        ' skills-lint=' + r.verify.skillsLint +
        ' catalog-lint=' + (r.verify.catalogLint === null ? 'n/a' : r.verify.catalogLint) +
        ' tracked=' + (r.verify.trackedPaths === null || r.verify.trackedPaths === undefined ? 'n/a' : r.verify.trackedPaths) +
        ' unmapped=' + (r.verify.unmapped === null || r.verify.unmapped === undefined ? 'n/a' : r.verify.unmapped) +
        ' doctor.failing=[' + ((r.verify.doctor.failing || []).join(',')) + ']\n')
    }
  }
  if (opts.dryRun) process.stderr.write('\nDRY RUN: nothing was written.\n')
  else {
    process.stderr.write('\nNext, in each target:\n')
    if (!opts.hooks) process.stderr.write('  git config core.hooksPath ' + HOOKS_PATH + '\n')
    if (!opts.enable) process.stderr.write('  cp .dsh/base/catalog.example.json .dsh/base/catalog.json   # then edit it\n')
    process.stderr.write('  node .dsh/base/dsb.mjs doctor\n')
    process.stderr.write('  node .dsh/base/dsb.mjs catalog-lint\n')
  }
}

process.stdout.write(JSON.stringify({
  command: 'install',
  ok: results.every(r => r.ok),
  dryRun: opts.dryRun,
  targets: results.length,
  results,
}) + '\n')

process.exit(results.every(r => r.ok) ? 0 : 1)
