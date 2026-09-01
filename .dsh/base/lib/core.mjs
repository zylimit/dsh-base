// deepseek-base :: governance engine core
// Zero-dependency. Node >= 20. No network. No writes outside .dsh/base runtime dirs.
//
// This module owns: repo discovery, JSON/atomic IO, hashing, glob matching,
// the module catalog contract, path classification, and git access.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

// ── vocabulary ──────────────────────────────────────────────────────────────

/** The eight quality attributes this scaffold governs (ISO/IEC 25010 aligned). */
export const ATTRIBUTES = Object.freeze([
  'security',      // Security  — confidentiality, integrity, authz, anti-tamper
  'safety',        // Safety    — no harm to people, environment, equipment
  'privacy',       // Privacy   — lawful, minimal, revocable personal-data handling
  'resilience',    // Resilience— survive attack/fault/disaster, recover fast
  'reliability',   // Reliability — correct, continuous operation over time
  'availability',
  'performance',
  'maintainability',
])

/** Declared enforcement strength per attribute, strongest first. */
export const TIERS = Object.freeze(['critical', 'high', 'medium', 'low', 'minimal', 'none'])

/** Tiers that BLOCK the gate when no passing check claims the attribute. */
export const BLOCKING_TIERS = Object.freeze(new Set(['critical', 'high']))

/** Tiers that must carry a written reason: opting out is a recorded decision. */
export const REASON_REQUIRED_TIERS = Object.freeze(new Set(['minimal', 'none']))

/**
 * Attributes that can never be waived, fast-skipped, or downgraded.
 * Security, Safety and Privacy are non-negotiable by construction.
 */
export const PROTECTED_ATTRIBUTES = Object.freeze(new Set(['security', 'safety', 'privacy']))

export const RISK_TIERS = Object.freeze(['low', 'medium', 'high', 'critical'])

/** Process exit-code contract shared by every subcommand. */
export const EXIT = Object.freeze({
  OK: 0,        // clean
  VIOLATION: 1, // rule broken (lint/scan/audit level)
  GATE: 2,      // blocking quality gate failed — commit/release must stop
  DEGRADED: 3,  // not configured / not a git repo — never a false green
  STALE: 4,     // evidence exists but no longer binds the current tree
})

export const PROTECTED_CLASSES = Object.freeze(new Set(['security', 'safety', 'privacy']))

// ── filesystem + hashing ────────────────────────────────────────────────────

export function findRepoRoot (start = process.cwd()) {
  let dir = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(start)
    dir = parent
  }
}

export const ROOT = findRepoRoot(process.env.DSB_ROOT || process.cwd())
export const BASE_DIR = path.join(ROOT, '.dsh', 'base')
export const STATE_DIR = path.join(BASE_DIR, 'state')
export const CATALOG_PATH = path.join(BASE_DIR, 'catalog.json')

export function rel (p) {
  return path.relative(ROOT, path.resolve(p)).split(path.sep).join('/')
}

export function abs (p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p)
}

export function exists (p) {
  try { fs.accessSync(abs(p)); return true } catch { return false }
}

export function readText (p, fallback = null) {
  try { return fs.readFileSync(abs(p), 'utf8') } catch { return fallback }
}

export function readJson (p, fallback = null) {
  const raw = readText(p)
  if (raw === null) return fallback
  try { return JSON.parse(stripJsonComments(raw)) } catch { return fallback }
}

/** Tolerates `//` and `/* *\/` comments so catalogs can be annotated. */
export function stripJsonComments (input) {
  let out = ''
  let inStr = false, inLine = false, inBlock = false, esc = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i], n = input[i + 1]
    if (inLine) { if (c === '\n') { inLine = false; out += c } ; continue }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++ } ; continue }
    if (inStr) {
      out += c
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; out += c; continue }
    if (c === '/' && n === '/') { inLine = true; i++; continue }
    if (c === '/' && n === '*') { inBlock = true; i++; continue }
    out += c
  }
  return out
}

export function ensureDir (p) {
  fs.mkdirSync(abs(p), { recursive: true })
}

/** Atomic write: temp file in the same directory, then rename. */
export function writeAtomic (p, content) {
  const target = abs(p)
  ensureDir(path.dirname(target))
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, target)
  return target
}

export function writeJsonAtomic (p, value) {
  return writeAtomic(p, JSON.stringify(value, null, 2) + '\n')
}

export function sha256 (data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

/** Content hash that ignores line-ending style, so Windows and CI agree. */
export function sha256Lf (text) {
  return sha256(String(text).replace(/\r\n/g, '\n'))
}

export function listFiles (dir, { depth = Infinity, filter = null } = {}) {
  const root = abs(dir)
  const results = []
  const walk = (d, level) => {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        if (level < depth) walk(full, level + 1)
      } else if (e.isFile()) {
        if (!filter || filter(rel(full))) results.push(rel(full))
      }
    }
  }
  walk(root, 0)
  return results.sort()
}

// ── glob ────────────────────────────────────────────────────────────────────

const globCache = new Map()

/**
 * Compile a POSIX-ish glob to a RegExp. Supports `**`, `*`, `?`,
 * `{a,b}` alternation and `[...]` classes. Paths are always `/`-separated.
 */
export function globToRegExp (glob) {
  const cached = globCache.get(glob)
  if (cached) return cached
  let re = ''
  let i = 0
  const g = String(glob)
  while (i < g.length) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        // `**/` consumes zero or more path segments; bare `**` matches anything
        if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 3; continue }
        re += '.*'; i += 2; continue
      }
      re += '[^/]*'; i++; continue
    }
    if (c === '?') { re += '[^/]'; i++; continue }
    if (c === '{') {
      const close = g.indexOf('}', i)
      if (close > i) {
        const parts = g.slice(i + 1, close).split(',').map(p => p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
        re += `(?:${parts.join('|')})`
        i = close + 1
        continue
      }
    }
    if (c === '[') {
      const close = g.indexOf(']', i)
      if (close > i) { re += g.slice(i, close + 1); i = close + 1; continue }
    }
    re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    i++
  }
  const compiled = new RegExp(`^${re}$`)
  globCache.set(glob, compiled)
  return compiled
}

/** Literal-character count: higher means a more specific pattern wins. */
export function globSpecificity (glob) {
  return String(glob).replace(/[*?{}\[\]]/g, '').length
}

export function matchesAny (p, globs) {
  for (const g of globs || []) if (globToRegExp(g).test(p)) return true
  return false
}

/** Catch-all patterns are rejected: they hide unmapped files behind a green gate. */
export const CATCH_ALL_GLOBS = Object.freeze(new Set(['', '.', '*', '**', '**/*', './**', '/**']))

// ── git ─────────────────────────────────────────────────────────────────────

export function git (args, { cwd = ROOT, input = undefined, maxBuffer = 64 * 1024 * 1024 } = {}) {
  const r = spawnSync('git', args, { cwd, input, maxBuffer, encoding: 'utf8', windowsHide: true })
  return {
    code: r.status === null ? -1 : r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    ok: r.status === 0,
  }
}

let _isGit = null
export function isGitRepo () {
  if (_isGit === null) _isGit = git(['rev-parse', '--is-inside-work-tree']).ok
  return _isGit
}

export function headCommit () {
  const r = git(['rev-parse', 'HEAD'])
  return r.ok ? r.stdout.trim() : null
}

/**
 * Tracked paths, NUL-delimited so non-ASCII filenames survive intact.
 * Truncation is reported, never silent: a truncated list is a bad measurement.
 */
export function trackedFiles (limit = 200000) {
  if (!isGitRepo()) return { paths: [], truncated: false, available: false }
  const r = git(['-c', 'core.quotePath=false', 'ls-files', '-z'])
  if (!r.ok) return { paths: [], truncated: false, available: false }
  const all = r.stdout.split('\0').filter(Boolean)
  const truncated = all.length > limit
  return { paths: truncated ? all.slice(0, limit) : all, truncated, available: true, total: all.length }
}

/** Changed paths relative to a baseline (default: working tree vs HEAD + untracked). */
export function changedPaths ({ baseline = null, staged = false } = {}) {
  if (!isGitRepo()) return { paths: [], available: false }
  const args = ['-c', 'core.quotePath=false', 'diff', '--name-only', '-z']
  if (staged) args.push('--cached')
  if (baseline) args.push(baseline)
  const r = git(args)
  const set = new Set(r.ok ? r.stdout.split('\0').filter(Boolean) : [])
  if (!staged) {
    const u = git(['-c', 'core.quotePath=false', 'ls-files', '-z', '--others', '--exclude-standard'])
    if (u.ok) for (const p of u.stdout.split('\0').filter(Boolean)) set.add(p)
    const c = git(['-c', 'core.quotePath=false', 'diff', '--name-only', '-z', '--cached'])
    if (c.ok) for (const p of c.stdout.split('\0').filter(Boolean)) set.add(p)
  }
  return { paths: [...set].sort(), available: true }
}

/** Runtime files that must never enter a diff fingerprint. */
export const DIFF_EXCLUDED = Object.freeze([
  '.dsh/base/state/**',
  '.dsh/base/receipts/**',
  '.dsh/base/waivers/**',
  '.dsh/base/trend/**',
  '.dsh/base/evidence/**',
])

/**
 * Canonical diff of the working tree against HEAD, plus the content hash of
 * every untracked file. Runtime state is excluded so the fingerprint tracks
 * source changes only.
 */
export function canonicalDiff ({ staged = false } = {}) {
  if (!isGitRepo()) return null
  const args = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--unified=3']
  if (staged) args.push('--cached')
  // The default identity is the whole working tree against HEAD, staged and
  // unstaged alike. A bare `git diff` sees only unstaged content, so a fully
  // staged change would hash as "nothing changed" and a receipt would bind
  // nothing. On an unborn branch there is no HEAD to compare against.
  else if (headCommit()) args.push('HEAD')
  const tracked = git(args).stdout
  const u = git(['-c', 'core.quotePath=false', 'ls-files', '-z', '--others', '--exclude-standard'])
  const extras = []
  if (u.ok) {
    for (const p of u.stdout.split('\0').filter(Boolean).sort()) {
      if (matchesAny(p, DIFF_EXCLUDED)) continue
      const content = readText(p, '')
      extras.push(`untracked ${p} ${sha256Lf(content ?? '')}`)
    }
  }
  const filtered = tracked
    .split('\n')
    .filter(line => {
      const m = /^diff --git a\/(.+?) b\//.exec(line)
      return !(m && matchesAny(m[1], DIFF_EXCLUDED))
    })
    .join('\n')
  return `${filtered}\n${extras.join('\n')}`
}

export function diffHash (opts = {}) {
  const d = canonicalDiff(opts)
  return d === null ? null : sha256Lf(d)
}

/**
 * True when the working tree carries no change against HEAD.
 * Evidence can only bind a change; an empty tree has nothing to bind, which is
 * a different condition from evidence that has gone stale.
 */
export function diffIsEmpty (opts = {}) {
  const d = canonicalDiff(opts)
  return d === null ? null : d.trim().length === 0
}

/** The identity of an empty canonical diff. A receipt carrying it proves nothing. */
export const EMPTY_DIFF_HASH = sha256Lf('\n')

// ── catalog ─────────────────────────────────────────────────────────────────

export const CATALOG_DEFAULTS = Object.freeze({
  maxTrackedPaths: 200000,
  contextPack: { maxTotalChars: 120000, maxFiles: 40, maxFileChars: 6000, maxDiffChars: 40000 },
  budget: { maxChangedFiles: 40, maxChangedLines: 1500, maxModulesTouched: 3, maxNewFiles: 25 },
  trace: { requirementDirs: ['docs/requirements'], testDirs: ['tests', 'test', 'src'], minCoverage: 1 },
  adr: { dir: 'docs/adr' },
  agentsMd: { requireForRiskTiers: ['high', 'critical'], maxBytes: 12000 },
  riskChecks: { low: [], medium: [], high: [], critical: [] },
  checks: {},
  layers: [],
  global: [],
  ignored: [],
  modules: [],
})

export function loadCatalog () {
  const present = exists(CATALOG_PATH)
  if (!present) return { present: false, catalog: null, path: rel(CATALOG_PATH) }
  const parsed = readJson(CATALOG_PATH, undefined)
  if (parsed === undefined) {
    return { present: true, catalog: null, path: rel(CATALOG_PATH), parseError: 'catalog.json is not valid JSON' }
  }
  const catalog = {
    ...CATALOG_DEFAULTS,
    ...parsed,
    contextPack: { ...CATALOG_DEFAULTS.contextPack, ...(parsed.contextPack || {}) },
    budget: { ...CATALOG_DEFAULTS.budget, ...(parsed.budget || {}) },
    trace: { ...CATALOG_DEFAULTS.trace, ...(parsed.trace || {}) },
    adr: { ...CATALOG_DEFAULTS.adr, ...(parsed.adr || {}) },
    agentsMd: { ...CATALOG_DEFAULTS.agentsMd, ...(parsed.agentsMd || {}) },
    riskChecks: { ...CATALOG_DEFAULTS.riskChecks, ...(parsed.riskChecks || {}) },
  }
  return { present: true, catalog, path: rel(CATALOG_PATH) }
}

export function moduleById (catalog, id) {
  return (catalog?.modules || []).find(m => m.id === id) || null
}

/**
 * Classify one repository path.
 * Precedence: module > ignored > global > unmapped.
 * Within modules, the most specific matching glob wins.
 */
export function classifyPath (catalog, p) {
  let best = null
  for (const m of catalog.modules || []) {
    for (const g of m.paths || []) {
      if (globToRegExp(g).test(p)) {
        const spec = globSpecificity(g)
        if (!best || spec > best.spec) best = { kind: 'module', moduleId: m.id, glob: g, spec }
      }
    }
  }
  if (best) return best
  const ignoredGlobs = (catalog.ignored || []).map(x => (typeof x === 'string' ? x : x.path))
  if (matchesAny(p, ignoredGlobs)) return { kind: 'ignored' }
  if (matchesAny(p, catalog.global || [])) return { kind: 'global' }
  return { kind: 'unmapped' }
}

// ── output ──────────────────────────────────────────────────────────────────

let humanMode = false
export function setHuman (v) { humanMode = !!v }

/** stdout carries one line of JSON; stderr carries human diagnostics. */
export function emit (payload, code = EXIT.OK) {
  process.stdout.write(JSON.stringify(payload) + '\n')
  return code
}

export function note (...parts) {
  process.stderr.write(parts.join(' ') + '\n')
}

export function human (...parts) {
  if (humanMode) process.stderr.write(parts.join(' ') + '\n')
}

export function degraded (command, reason) {
  return emit({ command, ok: false, degraded: true, reason }, EXIT.DEGRADED)
}

export function nowIso () { return new Date().toISOString() }

export function uniq (arr) { return [...new Set(arr)] }

export function chunk (arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}
