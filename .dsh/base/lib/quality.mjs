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
  sha256, sha256Lf, nowIso, diffHash, diffIsEmpty, EMPTY_DIFF_HASH,
  headCommit, changedPaths, git, isGitRepo, classifyPath,
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
  // An open fast-mode window applies without being asked for: a developer under
  // pressure should not have to remember a flag, and the record must show the
  // window was open whether or not they did.
  const fast = fastState()
  const fastMode = opts.fastMode || fast.active
  const raw = plan.entries.map(e => runCheck(e.checkId, (catalog.checks || {})[e.checkId], { ...opts, fastMode }))
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

  const skippedByFastMode = results.filter(r => r.reason === 'fast-mode').map(r => r.id)
  const record = {
    at: nowIso(),
    gate,
    reason,
    fastMode,
    fastReason: fastMode ? (fast.reason || opts.fastReason || 'one-off --fast') : null,
    fastUntil: fast.active ? fast.until : null,
    skippedByFastMode,
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
  if (diffIsEmpty()) {
    throw new Error('refusing to write a receipt for an empty diff: the working tree matches HEAD, so there is nothing to review')
  }
  const record = {
    version: 1,
    taskId: safeTaskId(payload.taskId),
    reviewer: payload.reviewer,
    verdict: payload.verdict,
    scope: payload.scope,
    notes: payload.notes || '',
    lenses: Array.isArray(payload.lenses) ? payload.lenses : null,
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
  const head = headCommit()

  // Nothing to bind is not the same as evidence gone stale. An empty tree has no
  // change under review, so the engine renders no verdict rather than a green one:
  // otherwise a receipt written against one empty tree would satisfy every later
  // empty tree, and a commit would silently restore its own review.
  if (diffIsEmpty()) {
    return { ok: false, degraded: true, reason: 'no-change: the working tree matches HEAD, so no receipt can bind it', currentDiffHash: current, baseCommit: head }
  }

  const dir = RECEIPT_DIR()
  if (!fs.existsSync(dir)) return { ok: false, stale: true, reason: 'no-receipt-recorded', currentDiffHash: current }
  const receipts = listFiles(rel(dir)).filter(p => p.endsWith('.json')).map(p => readJson(p, null)).filter(Boolean)
  const tampered = receipts.filter(r => {
    const { contentHash, ...rest } = r
    return sha256Lf(JSON.stringify(rest)) !== contentHash
  })
  // A receipt recorded against the empty-diff identity reviewed nothing and can
  // never be evidence, whatever the tree looks like later.
  const vacuous = receipts.filter(r => r.diffHash === EMPTY_DIFF_HASH)
  const matching = receipts.filter(r =>
    r.diffHash === current &&
    r.baseCommit === head &&
    r.verdict === 'ACCEPT' &&
    !tampered.includes(r) &&
    !vacuous.includes(r))
  return {
    ok: matching.length > 0 && tampered.length === 0,
    stale: matching.length === 0,
    tampered: tampered.map(r => r.taskId),
    vacuous: vacuous.map(r => r.taskId),
    currentDiffHash: current,
    baseCommit: head,
    matching: matching.map(r => ({ taskId: r.taskId, reviewer: r.reviewer, createdAt: r.createdAt, lenses: r.lenses || null })),
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
  if (latest && latest.fastMode && latest.diffHash === current) {
    blockers.push('the newest gate ran in fast mode and skipped [' + (latest.skippedByFastMode || []).join(', ') +
      ']; a loan against evidence cannot close a task. Run "dsb fast off" then "dsb gate".')
  }
  if (!gateFresh) blockers.push('no PASSING gate bound to the current diff (run: dsb gate)')
  if (!receipts.ok) blockers.push('no fresh ACCEPT review receipt bound to the current diff (run: dsb review start, then the lenses, then dsb review verdict)')
  const structured = !(catalog && catalog.review && catalog.review.requireStructured === false)
  if (structured && receipts.ok) {
    const withLenses = (receipts.matching || []).some(m => m.lenses && m.lenses.length)
    if (!withLenses) {
      blockers.push('the accepting receipt records no lens coverage; a verdict reached without structured disagreement is consensus, which measures worse than three lenses that disagree')
    }
  }
  if (!ledger.ok) blockers.push('verification ledger chain is broken; prior evidence cannot be trusted')
  if (plan.empty) blockers.push('verification plan is empty')
  if (blockers.length) return { ok: false, task: task.id, blockers }
  writeJsonAtomic(rel(TASK_PATH()), { ...task, state: 'complete', completedAt: nowIso() })
  return { ok: true, task: task.id, diffHash: current }
}
// ── three-file synchronisation ──────────────────────────────────────────────

/**
 * Project memory must never fall behind the code by more than one commit.
 *
 * This is the rule that makes "clear the session and resume" safe: if the code
 * moved, the memory moved with it, so the recovery sources always describe the
 * same commit. It is a commit-time gate rather than advice, because advice is
 * precisely what gets skipped under deadline pressure.
 */
export function syncCheck (catalog, { staged = false, paths = null } = {}) {
  if (!isGitRepo()) return { ok: false, degraded: true, reason: 'not-a-git-repository' }

  const mem = (catalog && catalog.memory) || {}
  const ledgerFile = mem.ledger || 'progress.md'
  const specDirs = (catalog && catalog.trace && catalog.trace.requirementDirs) || ['docs/requirements']

  const changed = paths || changedPaths({ staged }).paths
  const has = (p) => changed.includes(p)
  const codeChanged = changed.filter(p => classifyPath(catalog, p).kind === 'module')
  const findings = []

  if (codeChanged.length > 0 && !has(ledgerFile)) {
    findings.push({
      severity: 'error',
      code: 'MEMORY_BEHIND_CODE',
      sample: codeChanged.slice(0, 5),
      message: codeChanged.length + ' governed file(s) changed but ' + ledgerFile + ' did not. ' +
        'Record what changed and the evidence for it, or the next session cannot resume from this commit.',
    })
  }

  const specFiles = changed.filter(p => specDirs.some(d => p.startsWith(d + '/')) && /\.md$/i.test(p))
  const specBody = specFiles.filter(p => !/CHANGELOG/i.test(p))
  const specLog = specFiles.filter(p => /CHANGELOG/i.test(p))
  if (specBody.length > 0 && specLog.length === 0) {
    findings.push({
      severity: 'error',
      code: 'SPEC_WITHOUT_CHANGELOG',
      sample: specBody,
      message: 'the specification changed (' + specBody.join(', ') + ') with no changelog entry in the same change; ' +
        'a requirement that moved without a recorded reason is unreviewable',
    })
  }
  if (specLog.length > 0 && specBody.length === 0) {
    findings.push({
      severity: 'warning',
      code: 'CHANGELOG_WITHOUT_SPEC',
      message: 'the changelog changed with no specification edit; confirm the entry describes something that actually happened',
    })
  }

  const errors = findings.filter(f => f.severity === 'error')
  return {
    ok: errors.length === 0,
    changed: changed.length,
    codeChanged: codeChanged.length,
    ledgerFile,
    ledgerInChange: has(ledgerFile),
    findings,
    counts: { error: errors.length, warning: findings.length - errors.length },
  }
}
// ── fast mode ───────────────────────────────────────────────────────────────
//
// Shipping under time pressure is a real requirement, and a governance system
// that pretends otherwise gets bypassed with --no-verify, which teaches the team
// that the gate is optional. So the pressure is served, on four conditions that
// keep it from becoming permanent:
//
//   1. It expires by itself. A window with no end is not a window.
//   2. It cannot touch security, safety or privacy. Those are not slow, they are
//      the reason the software is allowed to exist.
//   3. It skips only what the project marked skippable BEFORE the emergency,
//      when there was time to think about which evidence is cheap to defer.
//   4. It is a loan. Every skipped check is recorded as SKIPPED with its reason,
//      the gate record is stamped fastMode, and that record cannot close a task
//      or a release. The debt is dated and visible until a full gate repays it.

const FAST_PATH = () => path.join(BASE_DIR, 'state', 'fast-mode.json')

export function fastState () {
  const raw = readJson(rel(FAST_PATH()), null)
  if (!raw || !raw.until) return { active: false, expired: false, record: null }
  const until = new Date(raw.until)
  const expired = !(until > new Date())
  return { active: !expired, expired, record: raw, until: raw.until, reason: raw.reason, minutes: raw.minutes }
}

export function setFast ({ on, minutes = 60, reason = '', by = '' }) {
  if (!on) {
    try { fs.unlinkSync(abs(rel(FAST_PATH()))) } catch { /* already off */ }
    return { active: false, record: null }
  }
  const m = Math.max(1, Math.min(Number(minutes) || 60, 8 * 60))
  if (!String(reason).trim()) throw new Error('fast mode requires a reason: it is a dated loan against evidence, and an undated loan is never repaid')
  const record = {
    version: 1,
    reason: String(reason).trim(),
    by: String(by || process.env.USERNAME || process.env.USER || 'unknown'),
    minutes: m,
    createdAt: nowIso(),
    until: new Date(Date.now() + m * 60000).toISOString(),
  }
  writeJsonAtomic(rel(FAST_PATH()), record)
  return { active: true, record }
}

/** Checks this project marked skippable, minus everything protected. */
export function fastSkippable (catalog) {
  const out = []
  for (const [id, def] of Object.entries(catalog.checks || {})) {
    if (!def || !def.allowFastSkip) continue
    const isProtected = PROTECTED_CLASSES.has(def.class) || (def.attributes || []).some(a => PROTECTED_ATTRIBUTES.has(a))
    if (isProtected) continue
    out.push(id)
  }
  return out
}
// ── structured-disagreement review ──────────────────────────────────────────
//
// The strongest measured lever in agentic coding is not a better model or more
// samples: it is a review loop. An agentic review raised one model from 27.5 %
// to 56.9 % on SWE-bench Verified at 6.5x the token efficiency of resampling,
// and three agents in structured disagreement outperformed five in consensus.
// Consensus is the failure mode - agents agreeing cheaply is not review.
//
// This scaffold had that as prose in a skill, which is the same as not having
// it. Here it is a gate: a verdict cannot be written until every required lens
// has actually reported, every finding carries a location or a reproduction,
// and the whole thing binds the exact diff it judged.

const REVIEW_PATH = () => path.join(BASE_DIR, 'state', 'review', 'session.json')
const LOCATION = /^[^\s:]+:\d+/

/**
 * The review team. Nine lenses, each with a distinct failure mode it owns, so a
 * finding has an obvious home and two lenses do not report the same thing twice.
 *
 * A lens carries the attribute it speaks for. That is what lets the engine leave
 * it out of a review where nothing declares that attribute above `minimal`:
 * convening a privacy reviewer for a module that stores nothing produces nitpicks,
 * and nitpicks are how a review loop stops being believed.
 */
// Stages order the work the way cost order it. Spending expensive review on
// code that has not passed cheap review is waste; spending security review on
// code that does not work yet is theatre. Stage gating IS the budget.
export const REVIEW_STAGES = Object.freeze({
  1: 'code',
  2: 'functional',
  3: 'trust',
})

export const LENS_LIBRARY = Object.freeze({
  correctness:     { stage: 1, attribute: null,              asks: 'does it do what the requirement says, at the boundaries and in the error paths, not just on the happy path' },
  architecture:    { stage: 1, attribute: 'maintainability', asks: 'is the change inside its declared boundary, does any new edge exist in the catalog, and does it respect the layer direction' },
  maintainability: { stage: 1, attribute: 'maintainability', asks: 'will the next person understand this without archaeology: duplication, dead code, naming that lies, comments that explain what instead of why' },
  testing:         { stage: 2, attribute: 'reliability',     asks: 'does a test fail without the fix, does every case trace to an anchor, and is a failure classified rather than retried' },
  performance:     { stage: 2, attribute: 'performance',     asks: 'what is the complexity class on the growth path, what allocates per call, and does it meet the stated budget rather than feeling fast' },
  reliability:     { stage: 3, attribute: 'reliability',     asks: 'what happens under partial failure: is the effect idempotent, is an error handled or propagated, is anything swallowed' },
  resilience:      { stage: 3, attribute: 'resilience',      asks: 'is every outbound call bounded by a timeout, every retry by a budget with backoff, every queue and cache by a limit, and is the degraded mode declared' },
  security:        { stage: 3, attribute: 'security',        asks: 'STRIDE across the trust boundary this change touches: authn, authz, injection sinks, secrets, transport, supply chain' },
  privacy:         { stage: 3, attribute: 'privacy',         asks: 'what personal data is touched, logged, exported or retained, under what lawful basis, and can its deletion be proven' },
})

/**
 * How much review this project's stakes justify. A personal tool and a payment
 * system need the same engine and emphatically not the same review team.
 */
export const REVIEW_PROFILES = Object.freeze({
  personal:   ['correctness'],
  team:       ['correctness', 'testing', 'architecture'],
  production: ['correctness', 'testing', 'architecture', 'security', 'reliability', 'performance'],
  regulated:  Object.keys(LENS_LIBRARY),
})

const TIER_RANK = ['none', 'minimal', 'low', 'medium', 'high', 'critical']

/**
 * Which lenses this review convenes.
 *
 * Order of authority: an explicit list wins; otherwise the profile sets the team,
 * and a lens is then EXCLUDED when no affected module declares its attribute
 * above `minimal`. Attributes can only remove a lens, never add one — otherwise
 * a project that declared everything high would convene everybody, which is the
 * failure this is here to prevent.
 */
export function reviewLenses (catalog, { affected = null } = {}) {
  const explicit = catalog && catalog.review && Array.isArray(catalog.review.lenses) ? catalog.review.lenses : null
  if (explicit && explicit.length) return explicit

  const profile = (catalog && catalog.review && catalog.review.profile) ||
    (catalog && catalog.profile) || 'team'
  const base = REVIEW_PROFILES[profile] || REVIEW_PROFILES.team
  if (!affected || !catalog || !Array.isArray(catalog.modules)) return base

  const mods = catalog.modules.filter(m => affected.includes(m.id))
  if (mods.length === 0) return base
  return base.filter(name => {
    const attr = LENS_LIBRARY[name] && LENS_LIBRARY[name].attribute
    // A lens with no attribute - correctness - is the floor of every review. It
    // is the one lens whose absence makes the stage model vacuous: with nothing
    // left in stage 1 the gate would skip straight to stage 3 and the verdict
    // would forever be missing its cheapest report.
    if (!attr) return true
    return mods.some(m => TIER_RANK.indexOf((m.attributes || {})[attr] || 'none') >= TIER_RANK.indexOf('low'))
  })
}

/** Why a lens the profile named was not convened. */
export function lensExclusions (catalog, affected) {
  const explicit = catalog && catalog.review && Array.isArray(catalog.review.lenses) ? catalog.review.lenses : null
  if (explicit && explicit.length) return []
  const profile = (catalog && catalog.review && catalog.review.profile) || (catalog && catalog.profile) || 'team'
  const base = REVIEW_PROFILES[profile] || REVIEW_PROFILES.team
  const kept = new Set(reviewLenses(catalog, { affected }))
  return base.filter(n => !kept.has(n)).map(n => ({
    lens: n,
    reason: 'no affected module declares ' + LENS_LIBRARY[n].attribute + ' above minimal',
  }))
}

export function readReview () { return readJson(rel(REVIEW_PATH()), null) }

function saveReview (s) { writeJsonAtomic(rel(REVIEW_PATH()), s); return s }

export function startReview (catalog, { packPath = null, scope = '', affected = null } = {}) {
  if (!isGitRepo()) return { ok: false, degraded: true, reason: 'not-a-git-repository' }
  if (diffIsEmpty()) return { ok: false, degraded: true, reason: 'no-change: there is nothing under review' }

  // Consecutive rejections of the same work are a signal about the bar, not an
  // instruction to try again. Seven rounds on one change means either the change
  // is wrong or the standard is wrong, and only a human can say which.
  const previous = readReview()
  const lineage = previous && previous.lineage ? previous.lineage : []
  const rejections = previous && previous.verdict && previous.verdict.verdict === 'FIX_REQUIRED'
    ? lineage.concat([{ at: previous.verdict.at, diffHash: previous.diffHash, errors: previous.verdict.errorCount }])
    : lineage

  return {
    ok: true,
    session: saveReview({
      version: 1,
      diffHash: diffHash(),
      baseCommit: headCommit(),
      startedAt: nowIso(),
      scope,
      packPath,
      requiredLenses: reviewLenses(catalog, { affected }),
      excludedLenses: lensExclusions(catalog, affected),
      lineage: rejections,
      blue: null,
      lenses: {},
      verdict: null,
    }),
  }
}

/** The session is only evidence about the tree it was opened against. */
function freshness (s) {
  if (!s) return { ok: false, reason: 'no review session; run "dsb review start"' }
  const now = diffHash()
  if (s.diffHash !== now) return { ok: false, stale: true, reason: 'the working tree changed since this review opened; re-open it' }
  return { ok: true }
}

/** Blue states what it verified and how. A claim with no evidence is an opinion. */
export function recordBlue (payload) {
  const s = readReview()
  const f = freshness(s)
  if (!f.ok) return { ok: false, ...f }
  const claims = Array.isArray(payload && payload.claims) ? payload.claims : []
  if (claims.length === 0) return { ok: false, reason: 'blue must state at least one claim' }
  const bad = claims.filter(c => !c || !c.claim || !c.evidence)
  if (bad.length) return { ok: false, reason: bad.length + ' claim(s) carry no evidence; a claim without a command, a path or an exit code is an opinion' }
  s.blue = { at: nowIso(), claims }
  return { ok: true, session: saveReview(s) }
}

/**
 * One lens reports. A finding must be locatable: file:line, or a reproduction
 * someone else can run. Anything else is an impression, and impressions are what
 * make review theatre.
 */
/** The highest stage whose lenses may report. Stage gating is the budget. */
export function currentStage (s) {
  const stageOf = (n) => (LENS_LIBRARY[n] ? LENS_LIBRARY[n].stage : 1)
  const reported = new Set(Object.keys(s.lenses || {}))
  const required = s.requiredLenses || []
  const stageComplete = (stage) => required
    .filter(n => stageOf(n) === stage)
    .every(n => reported.has(n))
  let current = 1
  for (;;) {
    const lenses = required.filter(n => stageOf(n) === current)
    if (lenses.length === 0) {
      // A stage this profile never convenes is not a gate: skip it rather than
      // demanding reports nobody was asked to write.
      if (current < 3) { current++; continue }
      return current
    }
    if (!stageComplete(current)) return current
    if (current < 3) { current++; continue }
    return current
  }
}

export function recordLens (name, payload) {
  const s = readReview()
  const f = freshness(s)
  if (!f.ok) return { ok: false, ...f }
  if (!s.requiredLenses.includes(name)) {
    return { ok: false, reason: 'unknown lens "' + name + '"; this review requires ' + s.requiredLenses.join(', ') }
  }
  const findings = Array.isArray(payload && payload.findings) ? payload.findings : []
  const unlocated = findings.filter(x => !(x && ((x.location && LOCATION.test(String(x.location))) || (x.reproduction && String(x.reproduction).trim()))))
  if (unlocated.length) {
    return { ok: false, reason: unlocated.length + ' finding(s) have neither a file:line location nor a reproduction; such a finding cannot be acted on and does not count' }
  }
  for (const x of findings) {
    if (!['error', 'warning', 'info'].includes(x.severity)) {
      return { ok: false, reason: 'each finding needs severity error | warning | info' }
    }
  }
  // A later stage may not open before the earlier one has fully reported: that
  // is the mechanism that keeps expensive lenses away from code that has not
  // passed the cheap ones yet.
  const stage = LENS_LIBRARY[name] ? LENS_LIBRARY[name].stage : 1
  const current = currentStage(s)
  if (stage > current) {
    return {
      ok: false,
      stageGated: true,
      lens: name,
      stage,
      currentStage: current,
      reason: 'this lens belongs to stage ' + stage + ' (' + REVIEW_STAGES[stage] + ') and the review is at stage ' +
        current + ' (' + REVIEW_STAGES[current] + '); report the earlier-stage lenses first',
    }
  }
  s.lenses[name] = {
    at: nowIso(),
    unable: !!(payload && payload.unable),
    unableReason: (payload && payload.unableReason) || null,
    findings,
  }
  return { ok: true, session: saveReview(s) }
}

/**
 * The verdict. It is computed from what was actually recorded, not asserted:
 * an unexamined lens cannot be waved through, and a lens that reported an error
 * cannot be outvoted by lenses that found nothing.
 */
export function reviewVerdict (catalog, { reviewer = 'reviewer', notes = '' } = {}) {
  const s = readReview()
  const f = freshness(s)
  if (!f.ok) return { ok: false, ...f }

  const stage = currentStage(s)
  const all = Object.entries(s.lenses)
  // An error anywhere is the dominant fact, whatever stage it was found in:
  // fixing it is what the next round exists for. A later-stage lens could only
  // have reported after the earlier stages passed, so ordering still holds.
  const errors = all.flatMap(([l, v]) => (v.findings || []).filter(x => x.severity === 'error').map(x => ({ lens: l, ...x })))
  const unable = all.filter(([, v]) => v.unable).map(([l]) => l)
  const blockers = []
  if (!s.blue) blockers.push('blue has not stated what it verified')

  const stageLenses = s.requiredLenses.filter(n => (LENS_LIBRARY[n] ? LENS_LIBRARY[n].stage : 1) === stage)
  const missing = stageLenses.filter(l => !s.lenses[l])
  let verdict = null
  if (errors.length) verdict = 'FIX_REQUIRED'
  else if (unable.length) verdict = 'NEEDS_MORE_EVIDENCE'
  else if (missing.length) blockers.push('stage ' + stage + ' lens(es) never reported: ' + missing.join(', '))
  else verdict = 'ACCEPT'
  if (blockers.length) return { ok: false, blockers, stage, requiredLenses: s.requiredLenses, recorded: Object.keys(s.lenses) }

  // Repeated rejection of the same work is information about the bar, not an
  // instruction to try again. At the limit the loop stops and asks a human which
  // is wrong - the change or the standard - because no further round can answer it.
  const maxRounds = (catalog && catalog.review && catalog.review.maxRounds) || 3
  const round = (s.lineage || []).length + 1
  const escalate = verdict === 'FIX_REQUIRED' && round >= maxRounds
  const isFinal = stage >= 3 || !(s.requiredLenses || []).some(n => (LENS_LIBRARY[n] ? LENS_LIBRARY[n].stage : 1) > stage)

  s.verdict = {
    at: nowIso(),
    verdict,
    reviewer,
    notes,
    round,
    escalate,
    stage,
    isFinal,
    errorCount: errors.length,
    unableLenses: unable,
    lensCoverage: stageLenses,
  }
  saveReview(s)

  let receipt = null
  if (verdict === 'ACCEPT' && isFinal) {
    receipt = writeReceipt({
      taskId: (readTask() || {}).id || 'review-' + s.diffHash.slice(0, 8),
      reviewer,
      verdict: 'ACCEPT',
      scope: s.scope || 'working tree',
      notes: notes,
      lenses: s.requiredLenses,
    })
  }

  return {
    ok: true,
    verdict,
    errors: errors.slice(0, 20),
    errorCount: errors.length,
    unableLenses: unable,
    lensCoverage: s.requiredLenses,
    excludedLenses: s.excludedLenses || [],
    stage,
    isFinal,
    round,
    maxRounds,
    escalate,
    receipt,
    advice: escalate
      ? 'round ' + round + ' of ' + maxRounds + ': this change has been rejected ' + round + ' times. Stop. ' +
        'Either the change is wrong or the standard is, and another round cannot tell you which. Take it to a human: ' +
        'reduce the scope, lower catalog.review.profile if the stakes do not justify this team, or accept the finding as debt with a written reason.'
      : (verdict === 'ACCEPT'
        ? (isFinal
          ? 'every stage passed, every required lens reported, and none found an error'
          : 'stage ' + stage + ' (' + REVIEW_STAGES[stage] + ') passed; report the stage ' + (stage + 1) + ' lenses to advance')
        : (verdict === 'FIX_REQUIRED'
          ? 'fix the errors and re-open the review; a lens that found an error is not outvoted by lenses that found nothing'
          : 'a lens could not reach a conclusion; supply what it needs rather than accepting around it')),
  }
}
// ── backlog ─────────────────────────────────────────────────────────────────
//
// A review must end. Endless rounds are how a good standard is abandoned, so
// rejections escalate after the configured limit. What may NOT happen instead
// is findings evaporating. A finding that a human decides to carry becomes a
// backlog entry: owner, expiry, and a reason why the bar is temporarily lower
// than the finding. Nothing is deleted, nothing is pretended away, and the
// protected floor holds: a security, safety or privacy finding is never
// backloggable, because the backlog would be the waiver the design refuses.

const BACKLOG_FORBIDDEN = /(security|safety|privacy|pii|secret|credential)/i

export function backlogAdd (payload) {
  const s = readReview()
  const f = freshness(s)
  if (!f.ok) return { ok: false, ...f }
  const required = ['owner', 'expiry', 'summary', 'lens']
  const missing = required.filter(k => !(payload && payload[k] && String(payload[k]).trim()))
  if (missing.length) return { ok: false, reason: 'a backlog entry needs: ' + missing.join(', ') + ' (owner, expiry as ISO date, summary, lens)' }
  if (!(new Date(payload.expiry) > new Date())) return { ok: false, reason: 'expiry must be in the future; an undated debt is never repaid' }
  const summary = String(payload.summary)
  if (BACKLOG_FORBIDDEN.test(summary)) {
    return { ok: false, reason: 'a security, safety or privacy finding cannot be backlogged; it is exactly what the backlog would become a waiver for' }
  }
  s.backlog = s.backlog || []
  const entry = {
    at: nowIso(),
    owner: String(payload.owner),
    expiry: payload.expiry,
    lens: String(payload.lens),
    summary,
    location: payload.location || null,
  }
  s.backlog.push(entry)
  saveReview(s)
  return { ok: true, entry, count: s.backlog.length }
}

export function backlogList () {
  const s = readReview()
  if (!s) return { ok: true, count: 0, entries: [] }
  const now = new Date()
  const entries = (s.backlog || []).map(e => ({ ...e, expired: !(new Date(e.expiry) > now) }))
  return { ok: true, count: entries.length, entries, expired: entries.filter(e => e.expired).length }
}
