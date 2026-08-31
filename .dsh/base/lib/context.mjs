// deepseek-base :: bounded context packing, environment doctor, retention, risk scan.
//
// context-pack exists because the scarce resource in a 1M-line repository is not
// compute, it is the model's attention. A pack is a budgeted, deny-filtered,
// reproducible bundle handed to a fresh delegate; the caller sees only a manifest.

import path from 'node:path'
import fs from 'node:fs'
import {
  BASE_DIR, ROOT, ATTRIBUTES, readText, readJson, writeAtomic, listFiles, rel, abs, exists,
  matchesAny, trackedFiles, canonicalDiff, diffHash, headCommit, isGitRepo, sha256Lf,
  nowIso, git,
} from './core.mjs'
import { computeImpact, resolveVerification } from './graph.mjs'
import { readTask, verifyLedger, verifyReceipts, readLedger } from './quality.mjs'

const FENCE = '\u0060\u0060\u0060'
const TICK = '\u0060'

/** Never packed, under any budget, for any reason. */
export const CONTEXT_DENY = Object.freeze([
  '**/.git/**', '**/node_modules/**', '**/dist/**', '**/build/**', '**/out/**', '**/.next/**',
  '**/target/**', '**/.venv/**', '**/venv/**', '**/__pycache__/**', '**/coverage/**',
  '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/*.jks',
  '**/id_rsa*', '**/id_ed25519*', '**/.ssh/**', '**/.aws/**', '**/.azure/**', '**/.gnupg/**',
  '**/.kube/**', '**/*secret*', '**/*credential*', '**/*.keystore',
  '.dsh/base/state/**', '.dsh/base/evidence/**', '.dsh/base/receipts/**', '.dsh/base/waivers/**',
  '**/*.lock', '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock',
])

/** Explicitly allowed despite matching a deny pattern. */
export const CONTEXT_ALLOW = Object.freeze(['**/.env.example', '**/.env.sample', '**/.env.template'])

export function denied (p) {
  if (matchesAny(p, CONTEXT_ALLOW)) return false
  return matchesAny(p, CONTEXT_DENY)
}

const PACK_DIR = () => path.join(BASE_DIR, 'state', 'context')

export function contextPack (catalog, { focus = [], task = null, budget = null } = {}) {
  const b = { ...catalog.contextPack, ...(budget || {}) }
  const changed = isGitRepo()
    ? git(['-c', 'core.quotePath=false', 'diff', '--name-only']).stdout.split('\n').filter(Boolean)
    : []
  const impact = computeImpact(catalog, changed)
  const sections = []
  const omitted = []
  let total = 0
  const included = []

  const push = (title, body) => {
    const block = '\n## ' + title + '\n\n' + body + '\n'
    if (total + block.length > b.maxTotalChars) { omitted.push({ section: title, reason: 'total-budget' }); return false }
    sections.push(block)
    total += block.length
    return true
  }

  // P1 - the task envelope: what the delegate is allowed to do at all.
  const t = task || readTask()
  if (t) {
    push('Task envelope', [
      '- **Goal**: ' + (t.goal || '(unset)'),
      '- **Scope**: ' + (t.scope || '(unset)'),
      '- **Out of scope**: ' + (t.outOfScope || '(unset)'),
      '- **Verification**: ' + (t.verification || '(unset)'),
      '- **Escalation**: ' + (t.escalation || '(unset)'),
      '- **Base commit**: ' + (t.baseCommit || 'unknown'),
    ].join('\n'))
  }

  // P2 - module contracts: the nested AGENTS.md the harness would load anyway.
  const contracts = []
  for (const id of impact.affected.slice(0, 20)) {
    const m = (catalog.modules || []).find(x => x.id === id)
    if (!m) continue
    const dirs = [...new Set((m.paths || []).map(g => g.split('/').filter(s => !s.includes('*')).join('/')).filter(Boolean))]
    for (const d of dirs) {
      const p = d + '/AGENTS.md'
      if (exists(p)) contracts.push('### ' + p + '\n\n' + readText(p, '').slice(0, b.maxFileChars))
    }
  }
  if (contracts.length) push('Module contracts', contracts.join('\n\n'))

  // P3 - the canonical diff, truncated to its own budget.
  const diff = canonicalDiff() || ''
  if (diff.trim()) {
    const clipped = diff.length > b.maxDiffChars ? diff.slice(0, b.maxDiffChars) + '\n...[diff truncated at ' + b.maxDiffChars + ' chars]' : diff
    push('Working-tree diff', FENCE + 'diff\n' + clipped + '\n' + FENCE)
  }

  // P4 - focused files, deny-filtered and per-file capped.
  const focusGlobs = Array.isArray(focus) ? focus : String(focus || '').split(',').map(s => s.trim()).filter(Boolean)
  const candidates = focusGlobs.length
    ? trackedFiles(catalog.maxTrackedPaths).paths.filter(p => matchesAny(p, focusGlobs))
    : changed
  for (const f of candidates) {
    if (included.length >= b.maxFiles) { omitted.push({ path: f, reason: 'max-files' }); continue }
    if (denied(f)) { omitted.push({ path: f, reason: 'deny-list' }); continue }
    const text = readText(f, null)
    if (text === null) { omitted.push({ path: f, reason: 'unreadable' }); continue }
    const clipped = text.length > b.maxFileChars ? text.slice(0, b.maxFileChars) + '\n...[truncated]' : text
    if (!push('File: ' + f, FENCE + '\n' + clipped + '\n' + FENCE)) { omitted.push({ path: f, reason: 'total-budget' }); continue }
    included.push({ path: f, bytes: Buffer.byteLength(clipped, 'utf8') })
  }

  // P5 - the exact verification the delegate must satisfy.
  const checks = [...new Set(impact.affected.flatMap(id => resolveVerification(catalog, id)))]
  if (checks.length) {
    push('Verification plan', checks
      .map(c => '- ' + TICK + c + TICK + ': ' + (((catalog.checks || {})[c] || {}).command || '(undefined command -> BLOCKED)'))
      .join('\n'))
  }

  const body = '# Context pack\n\nGenerated ' + nowIso() + ' at commit ' + (headCommit() || 'n/a') + '\n' + sections.join('')
  const packHash = sha256Lf(JSON.stringify({ files: included, budgets: b, diffHash: diffHash() }))
  fs.mkdirSync(PACK_DIR(), { recursive: true })
  const outPath = path.join(PACK_DIR(), 'pack-' + packHash.slice(0, 12) + '.md')
  writeAtomic(rel(outPath), body)

  return {
    ok: true,
    packPath: rel(outPath),
    packHash,
    chars: body.length,
    budgets: b,
    includedFiles: included.length,
    affectedModules: impact.affected,
    degraded: impact.degraded,
    omitted: omitted.slice(0, 50),
    omittedCount: omitted.length,
  }
}

// ── doctor ──────────────────────────────────────────────────────────────────

export function doctor (catalogState) {
  const nodeMajor = Number(process.versions.node.split('.')[0])
  const catalog = catalogState.catalog
  const skills = exists('.dsh/skills') ? listFiles('.dsh/skills').filter(p => p.endsWith('SKILL.md')).length : 0
  const ledger = verifyLedger()
  let receipts = { ok: false }
  try { receipts = verifyReceipts() } catch { receipts = { ok: false } }
  const modulesWithAttributes = catalog ? (catalog.modules || []).filter(m => Object.keys(m.attributes || {}).length).length : 0
  const forbiddenEdges = catalog ? (catalog.modules || []).reduce((n, m) => n + (m.forbiddenDependencies || []).length, 0) : 0
  const hooksPath = (git(['config', '--get', 'core.hooksPath']).stdout || '').trim()

  const checks = [
    { id: 'node-version', ok: nodeMajor >= 20, detail: 'node ' + process.versions.node + ' (requires >= 20)' },
    { id: 'git-repository', ok: isGitRepo(), detail: isGitRepo() ? 'git worktree at ' + ROOT : 'not a git repository; every git-derived capability degrades' },
    { id: 'catalog-present', ok: catalogState.present && !!catalog, detail: catalogState.present ? (catalog ? catalogState.path : 'catalog.json present but unparseable') : 'no catalog at ' + catalogState.path + ' (governance OFF; a valid silent state for small repos)' },
    { id: 'root-agents-md', ok: exists('AGENTS.md'), detail: exists('AGENTS.md') ? Buffer.byteLength(readText('AGENTS.md', ''), 'utf8') + ' bytes' : 'missing project constitution' },
    { id: 'skills-present', ok: skills > 0, detail: skills + ' skill file(s) under .dsh/skills' },
    { id: 'ledger-intact', ok: ledger.ok, detail: ledger.ok ? ledger.entries + ' ledger entries, chain intact' : ledger.breaks.length + ' chain break(s); prior evidence is untrusted' },
    { id: 'git-hooks-installed', ok: hooksPath === '.dsh/base/githooks', detail: 'core.hooksPath = ' + (hooksPath || '(unset)') },
    { id: 'attributes-declared', ok: modulesWithAttributes > 0 || !catalog, detail: modulesWithAttributes + ' module(s) declare quality attributes' },
  ]

  return {
    ok: true,
    enabled: catalogState.present && !!catalog,
    node: process.versions.node,
    platform: process.platform,
    root: ROOT,
    headCommit: headCommit(),
    modules: catalog ? (catalog.modules || []).length : 0,
    checksConfigured: catalog ? Object.keys(catalog.checks || {}).length : 0,
    modulesWithAttributes,
    forbiddenEdges,
    skills,
    receiptsFresh: !!receipts.ok,
    ledger: { ok: ledger.ok, entries: ledger.entries, breaks: ledger.breaks.length },
    checks,
    failing: checks.filter(c => !c.ok).map(c => c.id),
  }
}

// ── retention ───────────────────────────────────────────────────────────────

export function retention (catalog, { apply = false, maxAgeDays = 30, maxEvidence = 400, maxPacks = 60 } = {}) {
  const protectedPaths = new Set()
  for (const rec of readLedger()) {
    for (const r of rec.results || []) if (r.evidence) protectedPaths.add(r.evidence)
  }
  const cutoff = Date.now() - maxAgeDays * 86400000
  const plan = []

  const sweep = (dir, keep) => {
    if (!exists(dir)) return
    const files = listFiles(dir)
      .map(p => { try { return { p, mtime: fs.statSync(abs(p)).mtimeMs } } catch { return null } })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
    files.forEach((f, i) => {
      if (protectedPaths.has(f.p)) return
      if (i < keep && f.mtime >= cutoff) return
      plan.push({ path: f.p, reason: i >= keep ? 'over-count' : 'over-age' })
    })
  }
  sweep('.dsh/base/evidence', maxEvidence)
  sweep('.dsh/base/state/context', maxPacks)

  if (apply) {
    for (const item of plan) { try { fs.unlinkSync(abs(item.path)) } catch { /* already gone */ } }
  }
  return { ok: true, applied: apply, candidates: plan.length, protectedByLedger: protectedPaths.size, plan: plan.slice(0, 100) }
}

// ── risk scan (session-open decay detector) ─────────────────────────────────

export function riskScan (catalog) {
  const findings = []
  const task = readTask()
  if (task && task.state === 'active') {
    const ageH = (Date.now() - new Date(task.startedAt).getTime()) / 3600000
    if (ageH > 72) findings.push({ severity: 'warning', code: 'STALE_TASK', message: 'task "' + task.id + '" has been active for ' + Math.round(ageH) + 'h; close it or restate the goal' })
  }
  const ledger = verifyLedger()
  if (!ledger.ok) findings.push({ severity: 'error', code: 'LEDGER_BROKEN', message: 'verification ledger chain is broken; treat every prior green as unproven' })

  const waiverDir = '.dsh/base/waivers'
  if (exists(waiverDir)) {
    for (const p of listFiles(waiverDir).filter(x => x.endsWith('.json'))) {
      const w = readJson(p, null)
      if (w && w.expiry && new Date(w.expiry) <= new Date()) {
        findings.push({ severity: 'error', code: 'EXPIRED_WAIVER', message: 'waiver ' + p + ' expired on ' + w.expiry + '; delete it or renew it with a fresh justification' })
      }
    }
  }

  const fails = new Map()
  for (const rec of readLedger().slice(-30)) {
    for (const r of rec.results || []) {
      if (r.status === 'FAIL') fails.set(r.id, (fails.get(r.id) || 0) + 1)
      else if (r.status === 'PASS') fails.set(r.id, 0)
    }
  }
  for (const [id, n] of fails) {
    if (n >= 3) findings.push({ severity: 'warning', code: 'FAIL_STREAK', message: 'check "' + id + '" failed ' + n + ' times in a row; stop patching and run a root-cause investigation' })
  }

  if (catalog) {
    for (const m of catalog.modules || []) {
      for (const [attr, tier] of Object.entries(m.attributes || {})) {
        if (tier !== 'critical' && tier !== 'high') continue
        const claiming = Object.entries(catalog.checks || {}).filter(([, d]) => (d.attributes || []).includes(attr))
        if (claiming.length === 0) {
          findings.push({ severity: 'error', code: 'UNWIRED_ATTRIBUTE', module: m.id, message: 'module "' + m.id + '" declares ' + attr + ' at a blocking tier but no check claims that attribute' })
        }
      }
    }
  }

  const errorCount = findings.filter(f => f.severity === 'error').length
  return { ok: errorCount === 0, findings, counts: { error: errorCount, warning: findings.length - errorCount } }
}

// ── attribute wiring audit ──────────────────────────────────────────────────

export function attributeAudit (catalog) {
  const rows = []
  const gaps = []
  for (const m of catalog.modules || []) {
    const plan = resolveVerification(catalog, m.id)
    for (const [attr, tier] of Object.entries(m.attributes || {})) {
      if (!ATTRIBUTES.includes(attr)) continue
      const claiming = Object.entries(catalog.checks || {})
        .filter(([, d]) => (d.attributes || []).includes(attr))
        .map(([id]) => id)
      const wired = claiming.filter(c => plan.includes(c))
      const blocking = tier === 'critical' || tier === 'high'
      rows.push({ module: m.id, attribute: attr, tier, claiming, wired, blocking })
      if (blocking && wired.length === 0) {
        gaps.push({
          module: m.id, attribute: attr, tier, claiming, wired,
          why: claiming.length === 0 ? 'no check claims this attribute' : 'claiming checks exist but none is in this module verification plan',
        })
      }
    }
  }
  return { ok: gaps.length === 0, rows, gaps, counts: { declarations: rows.length, gaps: gaps.length } }
}
