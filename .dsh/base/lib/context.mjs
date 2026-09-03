// dsh-base :: bounded context packing, environment doctor, retention, risk scan.
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
import { computeImpact, resolveVerification, lintCatalog, archCheck } from './graph.mjs'
import { readTask, verifyLedger, verifyReceipts, readLedger, fastState, syncCheck, backlogList } from './quality.mjs'
import { specLint, trace, skillsLint, agentsLint, adrCheck, fitness } from './scan.mjs'

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
    { id: 'fast-mode', ok: !fastState().active, detail: fastState().active ? 'OPEN until ' + fastState().until + ' - evidence is being deferred' : 'closed' },
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

  const fast = fastState()
  if (fast.active) {
    findings.push({ severity: 'warning', code: 'FAST_MODE_OPEN', message: 'fast mode is open until ' + fast.until + ' (' + fast.reason + '); evidence is being deferred, not waived' })
  }
  const fastGate = readLedger().filter(e => e.gate).slice(-1)[0]
  if (fastGate && fastGate.fastMode) {
    findings.push({
      severity: 'error',
      code: 'FAST_MODE_DEBT',
      message: 'the newest gate ran in fast mode and skipped [' + (fastGate.skippedByFastMode || []).join(', ') +
        ']; that evidence has not been produced. Run "dsb fast off" then "dsb gate" before releasing.',
    })
  }

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
// ── project memory: bounded recap and archiving ─────────────────────────────
//
// Memory that grows without bound stops being memory: past a certain size nobody
// reads it, and an agent that does spends its context on history instead of work.
// So recap is a DERIVED, budgeted digest rather than three whole files, and
// archiving keeps the live ledger small without ever deleting anything. That is
// what makes "clear the session and resume" affordable as a project ages.

const MEMORY_DEFAULTS = Object.freeze({
  ledger: 'progress.md',
  archive: 'progress.archive.md',
  maxLedgerBytes: 24000,
  keepDone: 40,
  keepNotes: 30,
  recapBudget: 6000,
})

export function memoryConfig (catalog) {
  return { ...MEMORY_DEFAULTS, ...((catalog && catalog.memory) || {}) }
}

/** Split a ledger into its "## " sections, preserving order and raw bodies. */
export function parseLedger (text) {
  const sections = []
  let current = null
  for (const line of String(text || '').split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) { current = { title: m[1], lines: [] }; sections.push(current) }
    else if (current) current.lines.push(line)
  }
  return sections
}

const entriesOf = (s) => (s ? s.lines.filter(l => /^\s*-\s+\S/.test(l)) : [])

/** An entry's own priority token, not a mention of one in its prose. */
const priorityOf = (line) => {
  const m = /^\s*-\s+#\d+\s+(P[0-2])\b/.exec(line)
  return m ? m[1] : null
}

/**
 * Recap is a digest, not a transcript. A ledger entry carries its evidence
 * pointer inline and can run long; quoting it in full would let three entries
 * consume the whole budget, which is the failure this command exists to prevent.
 */
const clip = (line, max = 200) =>
  line.length <= max ? line : line.slice(0, max - 3).trimEnd() + '...'
const sectionNamed = (sections, name) =>
  sections.find(s => s.title.toLowerCase().startsWith(name.toLowerCase())) || null

/** Live size report for the memory files, with the archiving advice. */
export function ledgerHealth (catalog) {
  const cfg = memoryConfig(catalog)
  const text = readText(cfg.ledger, '')
  const bytes = Buffer.byteLength(text, 'utf8')
  const sections = parseLedger(text)
  const done = entriesOf(sectionNamed(sections, 'Done')).length
  const notes = entriesOf(sectionNamed(sections, 'Notes')).length
  const over = bytes > cfg.maxLedgerBytes || done > cfg.keepDone
  return {
    ledger: cfg.ledger, bytes, maxLedgerBytes: cfg.maxLedgerBytes,
    doneEntries: done, keepDone: cfg.keepDone, noteEntries: notes,
    archive: cfg.archive, archiveBytes: Buffer.byteLength(readText(cfg.archive, ''), 'utf8'),
    ok: !over,
    advice: over
      ? 'memory exceeds its budget; run "dsb archive --apply" to move the oldest entries into ' + cfg.archive +
        '. Nothing is deleted, and recap stays a fixed cost as the project ages.'
      : 'memory is within budget',
  }
}

/**
 * Move the oldest Done and Notes entries into the archive.
 * History is append-only: entries move, never disappear, and an archived entry is
 * never rewritten. A pointer line in the live ledger says where they went.
 */
export function archiveLedger (catalog, { apply = false } = {}) {
  const cfg = memoryConfig(catalog)
  if (!exists(cfg.ledger)) return { ok: false, degraded: true, reason: 'no ledger at ' + cfg.ledger }
  const text = readText(cfg.ledger, '')
  const sections = parseLedger(text)

  const plan = []
  const moved = { Done: [], Notes: [] }
  for (const [name, keep] of [['Done', cfg.keepDone], ['Notes', cfg.keepNotes]]) {
    const s = sectionNamed(sections, name)
    if (!s) continue
    const items = entriesOf(s)
    if (items.length <= keep) continue
    // Newest first is the section contract, so the tail is the oldest.
    const tail = items.slice(keep)
    moved[name] = tail
    plan.push({ section: name, total: items.length, keep, moving: tail.length })
  }

  const total = plan.reduce((n, p) => n + p.moving, 0)
  if (total === 0) {
    return { ok: true, applied: false, moved: 0, plan: [], reason: 'nothing to archive', health: ledgerHealth(catalog) }
  }
  if (!apply) {
    return { ok: true, applied: false, moved: total, plan, health: ledgerHealth(catalog) }
  }

  const stamp = nowIso().slice(0, 10)
  let archive = readText(cfg.archive, '')
  if (!archive) {
    archive = '# Archived project memory\n\nAppend-only. An archived entry is never rewritten; a correction is a new entry in the live ledger.\n'
  }
  archive += '\n## Archived ' + stamp + '\n'
  for (const name of ['Done', 'Notes']) {
    if (moved[name].length === 0) continue
    archive += '\n### ' + name + '\n\n' + moved[name].join('\n') + '\n'
  }
  writeAtomic(cfg.archive, archive)

  const movedSet = new Set([...moved.Done, ...moved.Notes])
  const pointer = '- Older entries are in [' + cfg.archive + '](' + cfg.archive + ').'
  const out = []
  let placed = false
  for (const line of text.split('\n')) {
    if (movedSet.has(line)) {
      if (!placed) { out.push(pointer); placed = true }
      continue
    }
    out.push(line)
  }
  writeAtomic(cfg.ledger, out.join('\n'))
  return { ok: true, applied: true, moved: total, plan, archive: cfg.archive, health: ledgerHealth(catalog) }
}

/**
 * One bounded answer to "where are we".
 *
 * It reads the memory files but returns only what is still live, so its cost is a
 * function of the current state rather than of the project's age.
 */
export function recap (catalog, { budget = null } = {}) {
  const cfg = memoryConfig(catalog)
  const cap = budget || cfg.recapBudget
  const sections = parseLedger(readText(cfg.ledger, ''))
  const pick = (name, limit) => entriesOf(sectionNamed(sections, name)).slice(0, limit).map(l => clip(l))
  const todo = entriesOf(sectionNamed(sections, 'TODO'))

  const spec = catalog ? specLint(catalog) : { degraded: true }
  const tr = spec.degraded ? { degraded: true } : trace(catalog)
  const task = readTask()
  const gates = readLedger().filter(e => e.gate)
  const lastGate = gates[gates.length - 1] || null
  const risks = catalog ? riskScan(catalog) : { findings: [] }
  const branch = (git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout || '').trim()
  const dirty = (git(['status', '--porcelain']).stdout || '').split('\n').filter(Boolean).length

  const blocks = []
  const push = (title, lines) => { if (lines && lines.length) blocks.push('## ' + title + '\n' + lines.join('\n')) }

  push('Position', [
    '- branch ' + (branch || 'unknown') + ' at ' + (headCommit() || 'no commit') + ', ' + dirty + ' uncommitted path(s)',
    '- active task: ' + (task && task.state === 'active' ? task.id + ' - ' + task.goal : 'none'),
    '- last gate: ' + (lastGate ? lastGate.gate + ' at ' + lastGate.at + ' over [' + (lastGate.modules || []).join(', ') + ']' : 'never run'),
    '- requirements: ' + (spec.degraded ? 'none declared' : spec.counts.requirements + ' declared, test coverage ' + (tr.degraded ? 'n/a' : (tr.coverage * 100).toFixed(0) + ' %')),
  ])
  push('Pinned', pick('Pinned', 12))
  push('In progress', pick('In progress', 8))
  push('Next (P0)', todo.filter(l => priorityOf(l) === 'P0').slice(0, 10).map(l => clip(l)))
  push('Next (P1)', todo.filter(l => priorityOf(l) === 'P1').slice(0, 10).map(l => clip(l)))
  push('Recent decisions', pick('Decisions', 5))
  push('Recently done', pick('Done', 6))
  push('Risks and assumptions', pick('Risks', 8))
  if (risks.findings.length) push('Decay signals', risks.findings.map(f => clip('- ' + f.code + ': ' + f.message)))

  let body = '# Recap - ' + nowIso() + '\n\n' + blocks.join('\n\n') + '\n'
  let truncated = false
  if (body.length > cap) {
    body = body.slice(0, cap) + '\n\n...[recap truncated at ' + cap + ' chars; open ' + cfg.ledger + ' for the rest]\n'
    truncated = true
  }
  return {
    ok: true, chars: body.length, budget: cap, truncated,
    health: ledgerHealth(catalog),
    sources: [cfg.ledger].concat(spec.degraded ? [] : [...new Set(spec.ids.map(i => i.file))]),
    text: body,
  }
}
// ── invariants ──────────────────────────────────────────────────────────────
//
// Compaction does not correct drift. ContextEcho benchmarked 23 models across
// long agentic-coding sessions and found that summarising the history does not
// restore adherence to the instructions that were in it. So the constitution
// decays inside a session, and nothing notices.
//
// This is the counter-measure: the smallest set of non-negotiables, plus the
// live state that changes what they mean, small enough to re-read at every
// phase boundary and immediately after any compaction. It is derived, so it
// cannot go stale the way a pasted reminder does.

export function invariants (catalog, { budget = 1200 } = {}) {
  const task = readTask()
  const fast = fastState()
  const ledger = verifyLedger()
  const gates = readLedger().filter(e => e.gate)
  const last = gates[gates.length - 1] || null

  const laws = [
    '# Invariants - re-read after any compaction and at every phase boundary',
    '',
    '1. EVIDENCE. Name the command, run it fresh, read output AND exit code, confirm it supports THIS claim, then speak. Never "should work" or "looks correct".',
    '2. STATES. exit 0 clean | 1 violation | 2 blocking gate | 3 degraded | 4 stale. Exit 3 is NOT a pass. A missing tool is BLOCKED. An empty plan is BLOCKED.',
    '3. FLOOR. security, safety and privacy are never waived, never fast-skipped, never downgraded. There is no expressible exception.',
    '4. SCOPE. Change only what the task envelope names. Missing information is not permission.',
    '5. TIERS. HIGH acts - push, release, deploy, destructive commands, secrets, migration, new dependency - stop for explicit human authorization.',
  ]

  const state = []
  state.push('- task: ' + (task && task.state === 'active' ? task.id + ' - scope: ' + task.scope : 'none open'))
  if (fast.active) state.push('- FAST MODE OPEN until ' + fast.until + ' (' + fast.reason + '): evidence is deferred, not waived')
  if (last) {
    state.push('- last gate: ' + last.gate +
      (last.fastMode ? ' (fast mode DEBT: ' + (last.skippedByFastMode || []).join(', ') + ')' : '') + ' at ' + last.at)
  } else state.push('- last gate: never run')
  if (!ledger.ok) state.push('- LEDGER BROKEN: every prior verification is unproven until re-run')

  let body = laws.join('\n') + '\n\n## Live state\n' + state.join('\n') + '\n'
  let truncated = false
  if (body.length > budget) { body = body.slice(0, budget) + '\n...[truncated]\n'; truncated = true }
  return { ok: true, chars: body.length, budget, truncated, text: body }
}
// ── bounded specification view ──────────────────────────────────────────────
//
// Project memory can be archived because a Done entry from last year is history.
// A requirement cannot: one written three years ago is still in force today. So
// the specification is the one memory file that grows without an archive, and the
// only way to keep reading it affordable is to stop reading all of it.
//
// This derives the requirements a specific change actually touches, by the same
// route the gate uses to decide what to verify: impact selects modules, trace
// maps requirements onto modules, and only that intersection is rendered.

export function specView (catalog, { paths = null, budget = 6000, all = false } = {}) {
  const t = trace(catalog)
  if (t.degraded) return { ok: false, degraded: true, reason: t.reason }

  let selected = t.rows
  let affected = null
  if (!all) {
    const changed = paths || (isGitRepo() ? git(['-c', 'core.quotePath=false', 'diff', '--name-only', 'HEAD']).stdout.split('\n').filter(Boolean) : [])
    const impact = computeImpact(catalog, changed)
    affected = impact.affected
    // A degraded impact means "everything", which here would defeat the purpose.
    // Say so rather than rendering the whole specification and calling it focused.
    if (!impact.degraded) {
      const set = new Set(affected)
      selected = t.rows.filter(r => r.modules.some(m => set.has(m)))
    }
  }

  const blocks = []
  // The header is part of what the caller pays for, so it is inside the budget.
  const headerAllowance = 320
  let rendered = headerAllowance
  let omitted = 0
  for (const row of selected) {
    const text = readText(row.definedIn, '')
    const lines = text.split('\n')
    // Prefer the heading that DECLARES the requirement. An id mentioned inside a
    // summary paragraph would otherwise be rendered as if it were the requirement.
    let idx = lines.findIndex(l => /^#{2,4}\s/.test(l) && l.includes(row.id))
    if (idx < 0) idx = lines.findIndex(l => l.includes(row.id))
    if (idx < 0) { omitted++; continue }
    let end = idx + 1
    while (end < lines.length && !/^#{2,4}\s/.test(lines[end])) end++
    const body = lines.slice(idx, Math.min(end, idx + 16)).join('\n').trim()
    const block = body + '\n\n_verified by: ' + (row.tests.join(', ') || 'NOTHING - unverified') + '_\n'
    if (rendered + block.length > budget) { omitted++; continue }
    blocks.push(block)
    rendered += block.length
  }

  // A requirement is linked to a module by CITATION: its id appears in the code
  // that implements it or in that module's tests. When a change touches modules
  // that cite nothing, the honest answer is that the change is untraceable - not
  // an empty list, which reads like 'nothing applies'.
  const noLink = !all && affected && affected.length > 0 && selected.length === 0
  const header = [
    '# Requirements in scope' + (all ? ' (all)' : (affected ? ' for [' + affected.join(', ') + ']' : '')),
    '',
    noLink
      ? 'No requirement is linked to [' + affected.join(', ') + ']. Put the requirement id in the code ' +
        'that implements it, or in that module tests. Until then this change cannot be traced to ' +
        'anything it was asked to do. Use --all to read the whole specification.'
      : selected.length + ' of ' + t.total + ' declared requirement(s) touch this change; ' +
        blocks.length + ' rendered, ' + omitted + ' omitted for budget.',
    '',
  ].join('\n')

  const body = header + blocks.join('\n')
  return {
    ok: true,
    total: t.total,
    selected: selected.map(r => r.id),
    rendered: blocks.length,
    omitted,
    affectedModules: affected,
    noLink,
    chars: body.length,
    budget,
    withinBudget: body.length <= budget,
    text: body,
  }
}

// ── changelog archiving ─────────────────────────────────────────────────────

/** Move all but the newest version sections of a changelog into its archive. */
export function archiveChangelog (catalog, { apply = false, keep = 10 } = {}) {
  const dirs = (catalog && catalog.trace && catalog.trace.requirementDirs) || ['docs/requirements']
  const file = dirs.map(d => d + '/PRODUCT-SPEC-CHANGELOG.md').find(p => exists(p))
  if (!file) return { ok: false, degraded: true, reason: 'no PRODUCT-SPEC-CHANGELOG.md under ' + dirs.join(', ') }
  const text = readText(file, '')
  const lines = text.split('\n')

  const starts = []
  for (let i = 0; i < lines.length; i++) if (/^##\s+\S/.test(lines[i])) starts.push(i)
  if (starts.length <= keep) {
    return { ok: true, applied: false, moved: 0, versions: starts.length, keep, reason: 'nothing to archive' }
  }

  const cut = starts[keep]
  const head = lines.slice(0, cut)
  const tail = lines.slice(cut)
  const moved = starts.length - keep
  if (!apply) return { ok: true, applied: false, moved, versions: starts.length, keep, file }

  const archiveFile = file.replace(/\.md$/, '.archive.md')
  let archive = readText(archiveFile, '')
  if (!archive) archive = '# Archived specification changelog\n\nAppend-only. An archived entry is never rewritten.\n'
  writeAtomic(archiveFile, archive + '\n' + tail.join('\n').trimEnd() + '\n')
  writeAtomic(file, head.join('\n').trimEnd() + '\n\n- Older versions are in [' +
    archiveFile.split('/').pop() + '](' + archiveFile.split('/').pop() + ').\n')
  return { ok: true, applied: true, moved, versions: starts.length, keep, file, archive: archiveFile }
}
// ── release readiness ───────────────────────────────────────────────────────
//
// A release is a HIGH-tier act and the engine never performs one: no tag, no
// push, no deploy. What it does is assemble the evidence a human signs on, so
// the decision is made on the same facts the gate used - not on a recollection.
// This is the other half of release-readiness: the skill tells you the
// conditions, this command evaluates them.

export function releaseReadiness (catalog, { budget = 3000 } = {}) {
  const run = (fn) => { try { return fn() } catch (e) { return { degraded: true, reason: 'engine error: ' + e.message } } }
  const cond = (id, result, blocking, detail) => ({ id, ok: result && result.ok !== false && !result.degraded, blocking, detail: detail || (result && result.reason) || null })

  const items = [
    cond('dod-static', run(() => {
      const failures = []
      const steps = [
        ['catalog', () => lintCatalog(catalog)], ['skills', () => skillsLint()], ['agents', () => agentsLint(catalog)],
        ['spec', () => specLint(catalog)], ['adr', () => adrCheck(catalog)], ['attributes', () => attributeAudit(catalog)],
        ['arch', () => archCheck(catalog, {})], ['fitness', () => fitness(catalog, { all: true })],
      ]
      for (const [id, fn] of steps) { const r = fn(); if (r.ok === false || r.degraded) failures.push(id) }
      return { ok: failures.length === 0, reason: failures.length ? 'failing: ' + failures.join(', ') : null }
    }), true),
    cond('trace-coverage', run(() => { const r = trace(catalog); return { ok: r.ok, reason: r.degraded ? r.reason : 'coverage ' + (r.coverage * 100).toFixed(0) + ' %' } }), true),
    cond('ledger-intact', run(() => { const r = verifyLedger(); return { ok: r.ok, reason: r.entries + ' entries' } }), true),
    cond('receipt-fresh', run(() => {
      const r = verifyReceipts()
      if (r.degraded) return { ok: false, reason: r.reason }
      return { ok: r.ok, reason: r.matching ? r.matching.length + ' fresh ACCEPT receipt(s)' : 'stale' }
    }), true),
    cond('gate-fresh', run(() => {
      const gates = readLedger().filter(x => x.gate && !x.kind)
      const latest = gates.slice(-1)[0]
      if (!latest) return { ok: false, reason: 'no gate has ever run here; a release is the evidence the gate produced' }
      if (latest.gate !== 'PASS') return { ok: false, reason: 'latest gate was ' + latest.gate + (latest.reason ? ' - ' + latest.reason : '') }
      if (latest.fastMode) return { ok: false, reason: 'latest gate ran in fast mode; a full gate is required' }
      const head = headCommit()
      const rangeBound = latest.range && latest.range.head === head
      const diffBound = !latest.range && latest.diffHash === diffHash()
      if (!rangeBound && !diffBound) return { ok: false, reason: 'the gate is not bound to this release surface (run: dsb gate, or dsb gate --baseline <ref> for a range)' }
      return { ok: true, reason: latest.range ? 'gate PASS bound to range ' + latest.range.base + '..HEAD' : 'gate PASS bound to the current diff' }
    }), true),
    cond('fast-mode-closed', run(() => { const s = fastState(); return { ok: !s.active, reason: s.active ? 'open until ' + s.until : 'closed' } }), true),
    cond('fast-debt-repaid', run(() => {
      const last = readLedger().filter(e => e.gate).slice(-1)[0]
      if (last && last.fastMode) return { ok: false, reason: 'last gate was fast mode; a full gate is required' }
      return { ok: true, reason: 'last gate was a full run' }
    }), true),
    cond('review-backlog', run(() => {
      const b = backlogList()
      if (b.expired) return { ok: false, reason: b.expired + ' expired backlog entr(y|ies)' }
      return { ok: true, reason: b.count + ' open entry(ies), ' + b.expired + ' expired' }
    }), false),
    cond('decay-signals', run(() => { const r = riskScan(catalog); return { ok: r.ok, reason: r.counts.error + ' error(s), ' + r.counts.warning + ' warning(s)' } }), false),
    cond('sync-clean', run(() => { const r = syncCheck(catalog, { staged: false }); return { ok: r.ok, reason: r.codeChanged + ' governed file(s) changed this commit-window' } }), true),
  ]

  const blockers = items.filter(i => i.blocking && !i.ok)
  const warnings = items.filter(i => !i.blocking && !i.ok)
  const ready = blockers.length === 0

  const lines = [
    '# Release readiness - ' + nowIso(),
    '',
    'Tagging, pushing and deploying are HIGH-tier human acts. This command never performs them.',
    'It assembles the evidence; the human makes the decision on these facts.',
    '',
    '## Conditions',
  ]
  for (const i of items) {
    lines.push('- [' + (i.ok ? 'x' : ' ') + '] ' + i.id + (i.blocking ? ' (blocking)' : '') + (i.detail ? ' - ' + i.detail : ''))
  }
  lines.push('')
  lines.push(ready ? '## READY - every blocking condition holds. A human may now tag and publish.' : '## NOT READY - blocking conditions above must be repaired first.')

  let body = lines.join('\n')
  let truncated = false
  if (body.length > budget) { body = body.slice(0, budget) + '\n...[truncated]\n'; truncated = true }

  return { ok: ready, ready, blockers: blockers.map(b => b.id), warnings: warnings.map(w => w.id), items, chars: body.length, budget, truncated, text: body }
}
