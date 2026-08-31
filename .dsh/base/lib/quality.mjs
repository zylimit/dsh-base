// deepseek-base :: four-state verification gate, attribute coverage,
// tamper-evident receipt ledger, structured waivers, and the change budget.
//
// Iron rules encoded here:
//   1. A missing tool is BLOCKED, never PASS. Nothing ran, so nothing is proven.
//   2. An empty verification plan is BLOCKED. Zero checks prove zero things.
//   3. Counter-evidence outranks confirming evidence.
//   4. security / safety / privacy are never waivable and never fast-skipped.
//   5. Every receipt binds to the exact diff it judged; one byte changes, it stales.

import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import {
  BASE_DIR, ROOT, ATTRIBUTES, BLOCKING_TIERS, PROTECTED_ATTRIBUTES, PROTECTED_CLASSES,
  readJson, readText, writeJsonAtomic, writeAtomic, listFiles, rel, abs, exists,
  sha256, sha256Lf, nowIso, diffHash, headCommit, changedPaths, git, isGitRepo,
} from './core.mjs'

import { resolveVerification } from './graph.mjs'

export const STATUS = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', BLOCKED: 'BLOCKED', SKIPPED: 'SKIPPED' })

const EVIDENCE_DIR = () => path.join(BASE_DIR, 'evidence')
const RECEIPT_DIR = () => path.join(BASE_DIR, 'receipts')
const WAIVER_DIR = () => path.join(BASE_DIR, 'waivers')
const LEDGER_PATH = () => path.join(BASE_DIR, 'state', 'ledger.jsonl')
const GATELOG_PATH = () => path.join(BASE_DIR, 'state', 'gate-log.jsonl')
const TASK_PATH = () => path.join(BASE_DIR, 'state', 'task.json')

const GENESIS = '0000000000000000000000000000000000000000000000000000000000000000'
const MAX_EVIDENCE_INLINE = 4000

// ── check execution ─────────────────────────────────────────────────────────

function commandExecutable (command) {
  const exe = String(command).trim().split(/\s+/)[0]
  if (!exe) return { ok: false, exe }
  if (exe.includes('/') || exe.includes('\\')) return { ok: exists(exe) || fs.existsSync(exe), exe }
  const probe = process.platform === 'win32'
    ? spawnSync('where', [exe], { encoding: 'utf8', windowsHide: true })
    : spawnSync('sh', ['-lc', 'command -v ' + JSON.stringify(exe)], { encoding: 'utf8' })
  return { ok: probe.status === 0, exe }
}

/**
 * Run one check and classify the outcome into exactly one of four states.
 * There is no fifth state and no default-to-green path.
 */
export function runCheck (id, def, { fastMode = false, timeoutMs = null, dryRun = false } = {}) {
  const started = Date.now()
  const base = { id, class: def && def.class ? def.class : 'unclassified', attributes: (def && def.attributes) || [] }

  if (!def || typeof def.command !== 'string' || !def.command.trim()) {
    return { ...base, status: STATUS.BLOCKED, reason: 'check-undefined-or-empty-command', durationMs: 0 }
  }

  const protectedCheck = PROTECTED_CLASSES.has(base.class) || base.attributes.some(a => PROTECTED_ATTRIBUTES.has(a))
  if (fastMode && def.allowFastSkip && !protectedCheck) {
    return { ...base, status: STATUS.SKIPPED, reason: 'fast-mode', durationMs: 0 }
  }

  if (dryRun) return { ...base, status: STATUS.SKIPPED, reason: 'dry-run', durationMs: 0, command: def.command }

  const probe = commandExecutable(def.command)
  if (!probe.ok) {
    return { ...base, status: STATUS.BLOCKED, reason: 'command-missing:' + probe.exe, durationMs: 0, command: def.command }
  }

  const limit = timeoutMs || def.timeoutMs || 900000
  const r = spawnSync(def.command, {
    cwd: ROOT, shell: true, encoding: 'utf8', timeout: limit,
    maxBuffer: 32 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, DSB_CHECK_ID: id, CI: process.env.CI || '' },
  })
  const durationMs = Date.now() - started
  const output = (r.stdout || '') + (r.stderr ? '\n--- stderr ---\n' + r.stderr : '')

  fs.mkdirSync(EVIDENCE_DIR(), { recursive: true })
  const safeId = id.replace(/[^A-Za-z0-9._-]/g, '_')
  const evidencePath = path.join(EVIDENCE_DIR(), safeId + '-' + Date.now() + '.log')
  writeAtomic(evidencePath, output)

  let status
  let reason
  if (r.error && r.error.code === 'ETIMEDOUT') { status = STATUS.FAIL; reason = 'timeout:' + limit + 'ms' }
  else if (r.error) { status = STATUS.BLOCKED; reason = 'spawn-error:' + r.error.code }
  else if (r.status === 0) { status = STATUS.PASS }
  else { status = STATUS.FAIL; reason = 'exit:' + r.status }

  return {
    ...base,
    status,
    reason,
    exitCode: r.status === null ? -1 : r.status,
    durationMs,
    command: def.command,
    evidence: rel(evidencePath),
    evidenceSha256: sha256Lf(output),
    excerpt: output.length > MAX_EVIDENCE_INLINE ? output.slice(0, MAX_EVIDENCE_INLINE) + '\n...[truncated, see evidence]' : output,
  }
}

// ── verification plan ───────────────────────────────────────────────────────

export function buildPlan (catalog, affectedModules) {
  const planned = new Map()
  for (const id of affectedModules) {
    for (const checkId of resolveVerification(catalog, id)) {
      if (!planned.has(checkId)) planned.set(checkId, { checkId, modules: [] })
      planned.get(checkId).modules.push(id)
    }
  }
  const entries = [...planned.values()].sort((a, b) => a.checkId.localeCompare(b.checkId))
  return {
    entries,
    hash: sha256Lf(JSON.stringify(entries.map(e => [e.checkId, e.modules.sort()]))),
    empty: entries.length === 0,
    modules: [...affectedModules].sort(),
  }
}

// ── waivers ─────────────────────────────────────────────────────────────────

const WAIVER_FORBIDDEN_WORDS = /(safety|security|privacy|pii|secret|credential|destructive|deploy|production|push)/i

export function waiverContentHash (w) {
  const { contentHash, ...rest } = w
  return sha256Lf(JSON.stringify(rest, Object.keys(rest).sort()))
}

export function listWaivers () {
  const dir = WAIVER_DIR()
  if (!fs.existsSync(dir)) return []
  return listFiles(rel(dir))
    .filter(p => p.endsWith('.json'))
    .map(p => ({ path: p, waiver: readJson(p, null) }))
    .filter(x => x.waiver)
}

export function validateWaiver (w) {
  const errors = []
  if (w.version !== 1) errors.push('version must be 1')
  for (const f of ['owner', 'reason', 'scope', 'expiry', 'compensation']) {
    if (!w[f] || typeof w[f] !== 'string' || !w[f].trim()) errors.push('missing field: ' + f)
  }
  if (w.expiry && !(new Date(w.expiry) > new Date())) errors.push('expiry must be a future ISO timestamp')
  const joined = String(w.reason || '') + ' ' + String(w.scope || '')
  if (WAIVER_FORBIDDEN_WORDS.test(joined)) {
    errors.push('waiver names a protected concern (security/safety/privacy/secret/credential/destructive/deploy/production/push); these are never waivable')
  }
  if (w.contentHash && w.contentHash !== waiverContentHash(w)) errors.push('contentHash mismatch: the waiver was edited after creation')
  return { ok: errors.length === 0, errors }
}

/** A waiver can only downgrade FAIL/BLOCKED on a non-protected check. */
export function applyWaivers (results, catalog) {
  const waivers = listWaivers()
  const applied = []
  return {
    results: results.map(r => {
      if (r.status !== STATUS.FAIL && r.status !== STATUS.BLOCKED) return r
      const def = (catalog.checks || {})[r.id] || {}
      const isProtected = PROTECTED_CLASSES.has(def.class) || (def.attributes || []).some(a => PROTECTED_ATTRIBUTES.has(a))
      if (isProtected) return r
      const hit = waivers.find(w => w.waiver.scope === r.id && validateWaiver(w.waiver).ok)
      if (!hit) return r
      applied.push({ check: r.id, waiver: hit.path, expiry: hit.waiver.expiry })
      return { ...r, status: STATUS.SKIPPED, reason: 'waiver:' + r.id, waivedFrom: r.status }
    }),
    applied,
  }
}

// ── attribute coverage ──────────────────────────────────────────────────────

/**
 * For every affected module, each attribute declared at a blocking tier must
 * have at least one PASSING check that claims it, and no claiming check may
 * have failed. Contradiction outranks confirmation.
 */
export function assessAttributes (catalog, affectedModules, results) {
  const byCheck = new Map(results.map(r => [r.id, r]))
  const coverage = []
  const gaps = []

  for (const id of affectedModules) {
    const m = (catalog.modules || []).find(x => x.id === id)
    if (!m) continue
    for (const [attr, tier] of Object.entries(m.attributes || {})) {
      if (!ATTRIBUTES.includes(attr)) continue
      const claiming = Object.entries(catalog.checks || {})
        .filter(([, def]) => (def.attributes || []).includes(attr))
        .map(([cid]) => cid)
      const executed = claiming.filter(cid => byCheck.has(cid))
      const passing = executed.filter(cid => byCheck.get(cid).status === STATUS.PASS)
      const contradicting = executed.filter(cid => byCheck.get(cid).status === STATUS.FAIL || byCheck.get(cid).status === STATUS.BLOCKED)
      const covered = passing.length > 0 && contradicting.length === 0
      const row = { module: id, attribute: attr, tier, claiming, executed, passing, contradicting, covered }
      coverage.push(row)
      if (BLOCKING_TIERS.has(tier) && !covered) {
        gaps.push({
          ...row,
          why: contradicting.length ? 'a claiming check reported ' + byCheck.get(contradicting[0]).status
            : executed.length === 0 ? (claiming.length === 0 ? 'no check in the catalog claims this attribute' : 'no claiming check was in the executed plan')
              : 'no claiming check passed',
        })
      }
    }
  }
  return { coverage, gaps }
}

// ── gate ────────────────────────────────────────────────────────────────────

export function aggregate (results, plan) {
  // Nothing changed, so there is nothing to prove. This is not the same as an
  // affected module whose verification plan resolved to zero checks.
  if ((plan.modules || []).length === 0) {
    return { gate: STATUS.PASS, reason: 'no-affected-modules: no change reaches a governed module' }
  }
  if (plan.empty) return { gate: STATUS.BLOCKED, reason: 'empty-plan: affected modules resolved zero checks; nothing ran, so nothing is proven' }
  if (results.some(r => r.status === STATUS.FAIL)) return { gate: STATUS.FAIL, reason: 'at-least-one-check-failed' }
  if (results.some(r => r.status === STATUS.BLOCKED)) return { gate: STATUS.BLOCKED, reason: 'at-least-one-check-blocked' }
  if (results.length > 0 && results.every(r => r.status === STATUS.SKIPPED)) return { gate: STATUS.BLOCKED, reason: 'every-check-skipped' }
  return { gate: STATUS.PASS, reason: 'all-executed-checks-passed' }
}

export function runGate (catalog, impact, opts = {}) {
  const plan = buildPlan(catalog, impact.affected)
  const raw = plan.entries.map(e => runCheck(e.checkId, (catalog.checks || {})[e.checkId], opts))
  const waived = applyWaivers(raw, catalog)
  const results = waived.results
  const agg = aggregate(results, plan)
  const attrs = assessAttributes(catalog, impact.affected, results)

  let gate = agg.gate
  let reason = agg.reason
  if (gate === STATUS.PASS && attrs.gaps.length > 0) {
    gate = 'BLOCKED_BY_ATTRIBUTES'
    reason = attrs.gaps.length + ' blocking quality-attribute gap(s): green checks that prove nothing about a critical/high attribute do not close the gate'
  }

  const record = {
    at: nowIso(),
    gate,
    reason,
    baseCommit: headCommit(),
    diffHash: diffHash(),
    planHash: plan.hash,
    modules: plan.modules,
    degraded: !!impact.degraded,
    results: results.map(r => ({ id: r.id, status: r.status, reason: r.reason, durationMs: r.durationMs, evidence: r.evidence, evidenceSha256: r.evidenceSha256 })),
    attributeCoverage: attrs.coverage,
    attributeGaps: attrs.gaps,
    waivers: waived.applied,
  }
  appendLedger(record)
  appendGateLog({ at: record.at, kind: 'gate', gate, checks: results.length, gaps: attrs.gaps.length })
  return { ...record, detail: results }
}

// ── tamper-evident ledger ───────────────────────────────────────────────────

export function readLedger () {
  const raw = readText(rel(LEDGER_PATH()), '')
  if (!raw) return []
  return raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return { corrupt: true, raw: l } } })
}

export function appendLedger (record) {
  const entries = readLedger()
  const prev = entries.length ? (entries[entries.length - 1].chain || GENESIS) : GENESIS
  const contentHash = sha256Lf(JSON.stringify(record))
  const chain = sha256(prev + '\0' + contentHash)
  const line = JSON.stringify({ ...record, contentHash, prev, chain })
  fs.mkdirSync(path.dirname(LEDGER_PATH()), { recursive: true })
  fs.appendFileSync(LEDGER_PATH(), line + '\n')
  return { contentHash, chain }
}

/** A broken chain fails closed: every prior verification is treated as unproven. */
export function verifyLedger () {
  const entries = readLedger()
  let prev = GENESIS
  const breaks = []
  entries.forEach((e, i) => {
    if (e.corrupt) { breaks.push({ index: i, reason: 'unparseable-line' }); return }
    const { contentHash, prev: p, chain, ...rest } = e
    const expectedContent = sha256Lf(JSON.stringify(rest))
    if (expectedContent !== contentHash) breaks.push({ index: i, reason: 'content-hash-mismatch', at: e.at })
    if (p !== prev) breaks.push({ index: i, reason: 'chain-predecessor-mismatch', at: e.at })
    const expectedChain = sha256(prev + '\0' + contentHash)
    if (expectedChain !== chain) breaks.push({ index: i, reason: 'chain-hash-mismatch', at: e.at })
    prev = chain || prev
  })
  return { ok: breaks.length === 0, entries: entries.length, breaks, head: prev }
}

export function appendGateLog (entry) {
  fs.mkdirSync(path.dirname(GATELOG_PATH()), { recursive: true })
  fs.appendFileSync(GATELOG_PATH(), JSON.stringify({ ...entry, at: entry.at || nowIso() }) + '\n')
}

export function readGateLog () {
  const raw = readText(rel(GATELOG_PATH()), '')
  if (!raw) return []
  return raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

/** A control that has never intervened is cost plus false confidence. */
export function gateAudit (catalog) {
  const log = readGateLog()
  const fired = new Map()
  for (const e of log) {
    if (e.kind === 'gate') continue
    fired.set(e.control || e.hook || 'unknown', (fired.get(e.control || e.hook || 'unknown') || 0) + 1)
  }
  const gateRuns = log.filter(e => e.kind === 'gate')
  const everFailedChecks = new Set()
  for (const rec of readLedger()) {
    for (const r of rec.results || []) if (r.status === 'FAIL' || r.status === 'BLOCKED') everFailedChecks.add(r.id)
  }
  const neverFailed = Object.keys(catalog.checks || {}).filter(id => !everFailedChecks.has(id))
  return {
    gateRuns: gateRuns.length,
    interventions: Object.fromEntries(fired),
    neverIntervenedChecks: neverFailed,
    advice: neverFailed.length
      ? 'These checks have never failed. Either they are genuinely stable, or they never actually run. Confirm with evidence before keeping them.'
      : 'Every configured check has intervened at least once.',
  }
}

// ── receipts ────────────────────────────────────────────────────────────────

export function safeTaskId (id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'task'
}

export function writeReceipt (payload) {
  const required = ['taskId', 'reviewer', 'verdict', 'scope']
  for (const f of required) if (!payload[f]) throw new Error('receipt requires field: ' + f)
  if (!['ACCEPT', 'FIX_REQUIRED', 'NEEDS_MORE_EVIDENCE'].includes(payload.verdict)) {
    throw new Error('verdict must be ACCEPT | FIX_REQUIRED | NEEDS_MORE_EVIDENCE')
  }
  const record = {
    version: 1,
    taskId: safeTaskId(payload.taskId),
    reviewer: payload.reviewer,
    verdict: payload.verdict,
    scope: payload.scope,
    notes: payload.notes || '',
    baseCommit: headCommit(),
    diffHash: diffHash(),
    createdAt: nowIso(),
  }
  record.contentHash = sha256Lf(JSON.stringify(record))
  const p = path.join(RECEIPT_DIR(), record.taskId + '.json')
  writeJsonAtomic(rel(p), record)
  // The ledger envelope owns `contentHash`; the receipt's own hash travels under
  // a distinct name so the chain verifier cannot strip it while recomputing.
  appendLedger({ at: record.createdAt, kind: 'receipt', taskId: record.taskId, verdict: record.verdict, diffHash: record.diffHash, receiptHash: record.contentHash })
  return record
}

/** Any byte of the working tree changing stales every receipt bound to it. */
export function verifyReceipts () {
  if (!isGitRepo()) return { ok: false, degraded: true, reason: 'not-a-git-repository' }
  const current = diffHash()
  const dir = RECEIPT_DIR()
  if (!fs.existsSync(dir)) return { ok: false, stale: true, reason: 'no-receipt-recorded', currentDiffHash: current }
  const receipts = listFiles(rel(dir)).filter(p => p.endsWith('.json')).map(p => readJson(p, null)).filter(Boolean)
  const tampered = receipts.filter(r => {
    const { contentHash, ...rest } = r
    return sha256Lf(JSON.stringify(rest)) !== contentHash
  })
  const matching = receipts.filter(r => r.diffHash === current && r.verdict === 'ACCEPT' && !tampered.includes(r))
  return {
    ok: matching.length > 0 && tampered.length === 0,
    stale: matching.length === 0,
    tampered: tampered.map(r => r.taskId),
    currentDiffHash: current,
    matching: matching.map(r => ({ taskId: r.taskId, reviewer: r.reviewer, createdAt: r.createdAt })),
    receipts: receipts.length,
  }
}

// ── change budget (runaway-development guard) ───────────────────────────────

/**
 * Blast-radius budget. Exceeding it is not forbidden — it is a signal that the
 * change must be split, or explicitly escalated through plan mode and an ADR.
 */
export function assessBudget (catalog, impact, { staged = false } = {}) {
  const b = catalog.budget || {}
  const changed = changedPaths({ staged }).paths
  // Same rule as the canonical diff: the default view is the whole working tree
  // against HEAD, so a staged change is counted rather than reported as zero.
  const statArgs = ['diff', '--numstat']
  if (staged) statArgs.push('--cached')
  else if (headCommit()) statArgs.push('HEAD')
  const diffStat = isGitRepo() ? git(statArgs).stdout : ''
  let added = 0, removed = 0
  for (const line of diffStat.split('\n')) {
    const m = /^(\d+)\s+(\d+)\s+/.exec(line)
    if (m) { added += Number(m[1]); removed += Number(m[2]) }
  }
  const untracked = isGitRepo()
    ? git(['ls-files', '--others', '--exclude-standard']).stdout.split('\n').filter(Boolean)
    : []
  const findings = []
  const check = (name, actual, limit) => {
    if (limit !== undefined && limit !== null && actual > limit) {
      findings.push({ metric: name, actual, limit })
    }
  }
  check('changedFiles', changed.length, b.maxChangedFiles)
  check('changedLines', added + removed, b.maxChangedLines)
  check('modulesTouched', impact.direct.length, b.maxModulesTouched)
  check('newFiles', untracked.length, b.maxNewFiles)

  return {
    ok: findings.length === 0,
    metrics: { changedFiles: changed.length, changedLines: added + removed, added, removed, modulesTouched: impact.direct.length, newFiles: untracked.length, affectedModules: impact.affected.length },
    limits: b,
    findings,
    advice: findings.length
      ? 'Blast radius exceeds the declared budget. Split the change, or record an explicit decision (ADR + plan) before continuing. Do not silently proceed.'
      : 'Change is within the declared budget.',
  }
}

// ── task envelope ───────────────────────────────────────────────────────────

export function startTask (envelope) {
  const required = ['id', 'goal', 'scope', 'outOfScope', 'verification', 'escalation']
  const missing = required.filter(f => !envelope[f] || !String(envelope[f]).trim())
  if (missing.length) throw new Error('task envelope is incomplete; missing: ' + missing.join(', '))
  const record = {
    ...envelope,
    id: safeTaskId(envelope.id),
    state: 'active',
    baseCommit: headCommit(),
    startedAt: nowIso(),
  }
  writeJsonAtomic(rel(TASK_PATH()), record)
  appendGateLog({ kind: 'task', control: 'task-start', task: record.id })
  return record
}

export function readTask () { return readJson(rel(TASK_PATH()), null) }

export function completeTask (catalog, impact) {
  const task = readTask()
  if (!task || task.state !== 'active') return { ok: false, reason: 'no-active-task' }
  const receipts = verifyReceipts()
  const ledger = verifyLedger()
  const plan = buildPlan(catalog, impact.affected)
  const latest = readLedger().filter(e => e.kind === undefined && e.gate).slice(-1)[0]
  const current = diffHash()
  const gateFresh = latest && latest.diffHash === current && latest.gate === STATUS.PASS
  const blockers = []
  if (!gateFresh) blockers.push('no PASSING gate bound to the current diff (run: dsb gate)')
  if (!receipts.ok) blockers.push('no fresh ACCEPT review receipt bound to the current diff (run: dsb receipt write)')
  if (!ledger.ok) blockers.push('verification ledger chain is broken; prior evidence cannot be trusted')
  if (plan.empty) blockers.push('verification plan is empty')
  if (blockers.length) return { ok: false, task: task.id, blockers }
  writeJsonAtomic(rel(TASK_PATH()), { ...task, state: 'complete', completedAt: nowIso() })
  return { ok: true, task: task.id, diffHash: current }
}
