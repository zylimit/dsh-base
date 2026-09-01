#!/usr/bin/env node
// deepseek-base governance engine :: CLI router.
//
//   node .dsh/base/dsb.mjs <subcommand> [flags]
//
// stdout is exactly one line of JSON. stderr carries human diagnostics.
// Exit codes: 0 clean | 1 rule violation | 2 blocking gate failure
//             3 degraded or not configured (never a false green) | 4 stale evidence

import process from 'node:process'
import fs from 'node:fs'
import path from 'node:path'
import {
  EXIT, ROOT, BASE_DIR, loadCatalog, emit, note, degraded, isGitRepo,
  changedPaths, diffHash, writeJsonAtomic, writeAtomic, readJson, readText,
  rel, exists, nowIso, listFiles, git,
} from './lib/core.mjs'
import {
  lintCatalog, computeImpact, archCheck, recordTrend, trendGate, readTrend,
  coChange, discoverCatalog, detectCommands,
} from './lib/graph.mjs'
import { loadFleet, fleetLint, fleetImpact, fleetStatus, fleetRecap, FLEET_FILE } from './lib/fleet.mjs'
import {
  runGate, verifyLedger, readLedger, gateAudit, writeReceipt, verifyReceipts,
  listWaivers, validateWaiver, waiverContentHash, assessBudget, startTask, readTask, completeTask,
  syncCheck, fastState, setFast, fastSkippable,
  startReview, recordBlue, recordLens, reviewVerdict, readReview, reviewLenses,
} from './lib/quality.mjs'
import { fitness, adrCheck, specLint, skillsLint, agentsLint, trace, rulesAudit } from './lib/scan.mjs'
import {
  contextPack, doctor, retention, riskScan, attributeAudit,
  recap, archiveLedger, ledgerHealth, invariants, specView, archiveChangelog,
} from './lib/context.mjs'
import { selftest } from './lib/selftest.mjs'

// ── argument parsing ────────────────────────────────────────────────────────

function parseArgs (argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue }
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++ }
      else flags[key] = true
    } else positional.push(a)
  }
  return { positional, flags }
}

const list = (v) => (v === undefined || v === true) ? [] : String(v).split(',').map(s => s.trim()).filter(Boolean)

// ── catalog gate ────────────────────────────────────────────────────────────

function needCatalog (command) {
  const state = loadCatalog()
  if (!state.present) {
    degraded(command, 'no module catalog at ' + state.path + '; governance is not enabled for this repository. Create it from .dsh/base/catalog.example.json to switch it on.')
    return null
  }
  if (!state.catalog) {
    degraded(command, state.parseError || 'catalog.json could not be parsed')
    return null
  }
  return state.catalog
}

function needGit (command) {
  if (isGitRepo()) return true
  degraded(command, 'not a git repository; this capability derives its facts from git and refuses to guess')
  return false
}

function changedFor (flags) {
  if (flags.paths) return list(flags.paths)
  // --baseline <ref> judges the range <ref>..HEAD instead of the working tree,
  // which is what a push needs: the commits being published, not the desk state.
  const baseline = typeof flags.baseline === 'string' ? flags.baseline : null
  return changedPaths({ staged: !!flags.staged, baseline }).paths
}

// ── commands ────────────────────────────────────────────────────────────────

const COMMANDS = {}

COMMANDS.doctor = () => {
  const state = loadCatalog()
  const r = doctor(state)
  for (const c of r.checks) note((c.ok ? '  ok  ' : ' warn ') + c.id + ' :: ' + c.detail)
  return emit({ command: 'doctor', ...r }, EXIT.OK)
}

COMMANDS.selftest = () => {
  const r = selftest()
  for (const f of r.failures) note(' FAIL ' + f.name + ' :: ' + f.detail)
  note(r.passed + '/' + r.total + ' assertions passed')
  return emit({ command: 'selftest', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

COMMANDS['catalog-lint'] = () => {
  const catalog = needCatalog('catalog-lint'); if (!catalog) return EXIT.DEGRADED
  const r = lintCatalog(catalog)
  for (const f of r.findings) note((f.severity === 'error' ? ' ERR  ' : ' warn ') + f.code + ' :: ' + f.message)
  return emit({ command: 'catalog-lint', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

COMMANDS.impact = (args) => {
  const catalog = needCatalog('impact'); if (!catalog) return EXIT.DEGRADED
  if (!args.flags.paths && !needGit('impact')) return EXIT.DEGRADED
  const r = computeImpact(catalog, changedFor(args.flags))
  note('affected modules: ' + (r.affected.join(', ') || '(none)') + (r.degraded ? '  [DEGRADED: conservative full fan-out]' : ''))
  return emit({ command: 'impact', ...r }, EXIT.OK)
}

COMMANDS.gate = (args) => {
  const catalog = needCatalog('gate'); if (!catalog) return EXIT.DEGRADED
  if (!needGit('gate')) return EXIT.DEGRADED
  const impact = computeImpact(catalog, changedFor(args.flags))
  const r = runGate(catalog, impact, {
    fastMode: !!args.flags.fast,
    dryRun: !!args.flags['dry-run'],
    timeoutMs: args.flags.timeout ? Number(args.flags.timeout) : null,
  })
  for (const c of r.results) note(' ' + c.status.padEnd(8) + c.id + (c.reason ? ' :: ' + c.reason : ''))
  for (const g of r.attributeGaps) note(' GAP     ' + g.module + '/' + g.attribute + ' (' + g.tier + ') :: ' + g.why)
  note('gate = ' + r.gate + ' :: ' + r.reason)
  const code = r.gate === 'PASS' ? EXIT.OK : EXIT.GATE
  const { detail, ...payload } = r
  return emit({ command: 'gate', ...payload }, code)
}
COMMANDS.verify = COMMANDS.gate

COMMANDS.attributes = () => {
  const catalog = needCatalog('attributes'); if (!catalog) return EXIT.DEGRADED
  const r = attributeAudit(catalog)
  for (const g of r.gaps) note(' GAP  ' + g.module + '/' + g.attribute + ' (' + g.tier + ') :: ' + g.why)
  return emit({ command: 'attributes', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

COMMANDS['arch-check'] = (args) => {
  const catalog = needCatalog('arch-check'); if (!catalog) return EXIT.DEGRADED
  if (!needGit('arch-check')) return EXIT.DEGRADED
  const paths = args.flags.changed ? changedFor(args.flags) : (args.flags.paths ? list(args.flags.paths) : null)
  const r = archCheck(catalog, { paths })
  for (const e of r.forbidden) note(' FORBIDDEN  ' + e.from + ' -> ' + e.to + '  e.g. ' + (e.files[0] || ''))
  for (const e of r.layerViolations) note(' LAYER      ' + e.from + '(' + e.fromLayer + ') -> ' + e.to + '(' + e.toLayer + ')')
  for (const e of r.undeclared) note(' DRIFT      ' + e.from + ' -> ' + e.to + '  e.g. ' + (e.files[0] || ''))
  for (const e of r.unusedDeclarations) note(' UNUSED     ' + e.from + ' -> ' + e.to + ' (declared but no real import)')
  note('scanned ' + r.scanned + ' file(s), ' + r.edges + ' inter-module edge(s), ' + r.unresolved + ' unresolved specifier(s)')
  if (args.flags.record) {
    const entry = recordTrend(r)
    note('recorded trend snapshot: ' + JSON.stringify(entry.metrics))
    return emit({ command: 'arch-check', recorded: entry, ...r }, EXIT.OK)
  }
  return emit({ command: 'arch-check', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

COMMANDS['arch-trend'] = (args) => {
  const catalog = needCatalog('arch-trend'); if (!catalog) return EXIT.DEGRADED
  const history = readTrend()
  if (!args.flags.gate) {
    return emit({ command: 'arch-trend', samples: history.length, history: history.slice(-20) }, EXIT.OK)
  }
  const current = archCheck(catalog, {})
  const r = trendGate(current)
  for (const reg of r.regressions || []) note(' RATCHET  ' + reg.metric + ': best ' + reg.best + ' -> now ' + reg.now)
  note(r.ok ? 'ratchet holds: no metric exceeds its historical best' : 'ratchet broken: new architectural debt was added')
  return emit({ command: 'arch-trend', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

COMMANDS.fitness = (args) => {
  const catalog = needCatalog('fitness'); if (!catalog) return EXIT.DEGRADED
  const paths = args.flags.paths ? list(args.flags.paths) : (args.flags.all ? null : changedFor(args.flags))
  const r = fitness(catalog, { paths: args.flags.all ? null : paths, all: !!args.flags.all })
  for (const f of r.findings) note(' ' + (f.severity === 'error' ? 'ERR ' : 'warn') + '  ' + f.rule + '  ' + f.file + ':' + f.line + '  ' + f.excerpt)
  note('scanned ' + r.scanned + ' file(s): ' + r.counts.error + ' error(s), ' + r.counts.warning + ' warning(s)')
  return emit({ command: 'fitness', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

COMMANDS['adr-check'] = () => {
  const catalog = needCatalog('adr-check'); if (!catalog) return EXIT.DEGRADED
  const r = adrCheck(catalog)
  for (const f of r.findings) note((f.severity === 'error' ? ' ERR  ' : ' warn ') + f.code + '  ' + f.file + ' :: ' + f.message)
  note(r.live + ' live ADR(s), ' + r.manualOnly + ' enforced only by human review')
  return emit({ command: 'adr-check', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

COMMANDS['spec-lint'] = () => {
  const catalog = needCatalog('spec-lint'); if (!catalog) return EXIT.DEGRADED
  const r = specLint(catalog)
  if (r.degraded) return degraded('spec-lint', r.reason)
  for (const f of r.findings) note((f.severity === 'error' ? ' ERR  ' : ' warn ') + f.code + '  ' + (f.file || '') + (f.line ? ':' + f.line : '') + ' :: ' + f.message)
  note(r.counts.requirements + ' requirement(s), ' + r.counts.error + ' error(s), ' + r.counts.warning + ' warning(s)')
  return emit({ command: 'spec-lint', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

COMMANDS.trace = () => {
  const catalog = needCatalog('trace'); if (!catalog) return EXIT.DEGRADED
  const r = trace(catalog)
  if (r.degraded) return degraded('trace', r.reason)
  for (const id of r.unverified) note(' UNVERIFIED  ' + id + ' :: no test references this id')
  for (const d of r.dangling) note(' DANGLING    ' + d.id + ' referenced in ' + d.file + ' but never declared')
  note('requirement coverage ' + (r.coverage * 100).toFixed(1) + '% (minimum ' + (r.minCoverage * 100).toFixed(1) + '%)')
  return emit({ command: 'trace', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

COMMANDS['skills-lint'] = () => {
  const r = skillsLint()
  for (const f of r.findings) note((f.severity === 'error' ? ' ERR  ' : ' warn ') + f.code + '  ' + (f.file || '') + ' :: ' + f.message)
  note(r.counts.skills + ' skill(s) discovered')
  return emit({ command: 'skills-lint', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

COMMANDS['agents-lint'] = () => {
  const catalog = needCatalog('agents-lint'); if (!catalog) return EXIT.DEGRADED
  const r = agentsLint(catalog)
  for (const f of r.findings) note((f.severity === 'error' ? ' ERR  ' : ' warn ') + f.code + '  ' + (f.file || f.module || '') + ' :: ' + f.message)
  note(r.counts.contracts + ' module contract file(s) found')
  return emit({ command: 'agents-lint', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

COMMANDS.budget = (args) => {
  const catalog = needCatalog('budget'); if (!catalog) return EXIT.DEGRADED
  if (!needGit('budget')) return EXIT.DEGRADED
  const impact = computeImpact(catalog, changedFor(args.flags))
  const r = assessBudget(catalog, impact, { staged: !!args.flags.staged })
  for (const f of r.findings) note(' OVER  ' + f.metric + ': ' + f.actual + ' > limit ' + f.limit)
  note(r.advice)
  return emit({ command: 'budget', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

COMMANDS['context-pack'] = (args) => {
  const catalog = needCatalog('context-pack'); if (!catalog) return EXIT.DEGRADED
  const budget = args.flags.budget ? { maxTotalChars: Number(args.flags.budget) } : null
  const r = contextPack(catalog, { focus: list(args.flags.focus), budget })
  note('pack written to ' + r.packPath + ' (' + r.chars + ' chars, ' + r.includedFiles + ' file(s), ' + r.omittedCount + ' omitted)')
  return emit({ command: 'context-pack', ...r }, EXIT.OK)
}

COMMANDS.receipt = async (args) => {
  const sub = args.positional[1]
  if (sub === 'write') {
    const raw = await readStdin()
    let payload
    try { payload = JSON.parse(raw) } catch { return emit({ command: 'receipt', ok: false, reason: 'stdin is not valid JSON' }, EXIT.DEGRADED) }
    try {
      const r = writeReceipt(payload)
      note('receipt written for task ' + r.taskId + ' bound to diff ' + String(r.diffHash).slice(0, 12))
      return emit({ command: 'receipt', ok: true, receipt: r }, EXIT.OK)
    } catch (e) {
      return emit({ command: 'receipt', ok: false, reason: e.message }, EXIT.DEGRADED)
    }
  }
  if (sub === 'verify') {
    const r = verifyReceipts()
    if (r.degraded) return degraded('receipt', r.reason)
    note(r.ok ? 'a fresh ACCEPT receipt binds the current diff' : 'no fresh receipt binds the current diff; re-review is required')
    return emit({ command: 'receipt', ...r }, r.ok ? EXIT.OK : EXIT.STALE)
  }
  return emit({ command: 'receipt', ok: false, reason: 'usage: receipt write|verify' }, EXIT.DEGRADED)
}

COMMANDS.waiver = async (args) => {
  const sub = args.positional[1]
  if (sub === 'list' || sub === undefined) {
    const all = listWaivers().map(w => ({ path: w.path, scope: w.waiver.scope, expiry: w.waiver.expiry, valid: validateWaiver(w.waiver).ok }))
    return emit({ command: 'waiver', ok: true, waivers: all }, EXIT.OK)
  }
  if (sub === 'check') {
    const all = listWaivers().map(w => ({ path: w.path, ...validateWaiver(w.waiver) }))
    const bad = all.filter(w => !w.ok)
    for (const w of bad) note(' INVALID  ' + w.path + ' :: ' + w.errors.join('; '))
    return emit({ command: 'waiver', ok: bad.length === 0, waivers: all }, bad.length ? EXIT.VIOLATION : EXIT.OK)
  }
  if (sub === 'create') {
    const raw = await readStdin()
    let w
    try { w = JSON.parse(raw) } catch { return emit({ command: 'waiver', ok: false, reason: 'stdin is not valid JSON' }, EXIT.DEGRADED) }
    w.version = 1
    w.created_at = nowIso()
    const v = validateWaiver(w)
    if (!v.ok) { for (const e of v.errors) note(' INVALID :: ' + e); return emit({ command: 'waiver', ok: false, errors: v.errors }, EXIT.VIOLATION) }
    w.contentHash = waiverContentHash(w)
    const p = '.dsh/base/waivers/' + String(w.scope).replace(/[^A-Za-z0-9._-]/g, '_') + '.json'
    writeJsonAtomic(p, w)
    note('waiver written to ' + p + ' expiring ' + w.expiry)
    return emit({ command: 'waiver', ok: true, path: p, waiver: w }, EXIT.OK)
  }
  return emit({ command: 'waiver', ok: false, reason: 'usage: waiver list|check|create' }, EXIT.DEGRADED)
}

COMMANDS.task = async (args) => {
  const sub = args.positional[1] || 'status'
  if (sub === 'start') {
    const raw = await readStdin()
    let envelope
    try { envelope = JSON.parse(raw) } catch { return emit({ command: 'task', ok: false, reason: 'stdin must be the JSON task envelope: {id,goal,scope,outOfScope,existingPattern,verification,escalation}' }, EXIT.DEGRADED) }
    try {
      const r = startTask(envelope)
      note('task ' + r.id + ' started at ' + (r.baseCommit || 'no-commit'))
      return emit({ command: 'task', ok: true, task: r }, EXIT.OK)
    } catch (e) { return emit({ command: 'task', ok: false, reason: e.message }, EXIT.DEGRADED) }
  }
  if (sub === 'status') {
    const t = readTask()
    return emit({ command: 'task', ok: true, task: t, diffHash: diffHash() }, EXIT.OK)
  }
  if (sub === 'complete') {
    const catalog = needCatalog('task'); if (!catalog) return EXIT.DEGRADED
    const impact = computeImpact(catalog, changedFor(args.flags))
    const r = completeTask(catalog, impact)
    for (const b of r.blockers || []) note(' BLOCKER  ' + b)
    return emit({ command: 'task', ...r }, r.ok ? EXIT.OK : EXIT.GATE)
  }
  return emit({ command: 'task', ok: false, reason: 'usage: task start|status|complete' }, EXIT.DEGRADED)
}

COMMANDS.ledger = (args) => {
  const sub = args.positional[1]
  if (sub !== undefined && sub !== 'verify') {
    return emit({ command: 'ledger', ok: false, reason: 'usage: ledger [verify]' }, EXIT.DEGRADED)
  }
  const r = verifyLedger()
  for (const b of r.breaks) note(' BREAK  entry ' + b.index + ' :: ' + b.reason)
  note(r.ok ? r.entries + ' ledger entries, chain intact' : 'ledger chain is broken; every prior verification must be treated as unproven')
  return emit({ command: 'ledger', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

COMMANDS['gate-audit'] = () => {
  const catalog = needCatalog('gate-audit'); if (!catalog) return EXIT.DEGRADED
  const r = gateAudit(catalog)
  note(r.advice)
  for (const id of r.neverIntervenedChecks) note(' NEVER-FIRED  ' + id)
  return emit({ command: 'gate-audit', ...r }, EXIT.OK)
}

COMMANDS.risk = () => {
  const state = loadCatalog()
  const r = riskScan(state.catalog)
  for (const f of r.findings) note((f.severity === 'error' ? ' ERR  ' : ' warn ') + f.code + ' :: ' + f.message)
  note(r.findings.length ? r.findings.length + ' decay signal(s)' : 'no decay signals')
  return emit({ command: 'risk', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

COMMANDS.retention = (args) => {
  const state = loadCatalog()
  const r = retention(state.catalog || {}, { apply: !!args.flags.apply })
  note((r.applied ? 'deleted ' : 'would delete ') + r.candidates + ' artefact(s); ' + r.protectedByLedger + ' protected by the ledger')
  return emit({ command: 'retention', ...r }, EXIT.OK)
}

COMMANDS['diff-hash'] = () => {
  if (!needGit('diff-hash')) return EXIT.DEGRADED
  return emit({ command: 'diff-hash', diffHash: diffHash(), staged: diffHash({ staged: true }) }, EXIT.OK)
}

COMMANDS['review-pack'] = (args) => {
  if (!needGit('review-pack')) return EXIT.DEGRADED
  const base = args.flags.base || resolveBase()
  const commits = git(['log', '--oneline', base + '..HEAD']).stdout.trim()
  const stat = git(['diff', '--stat', base]).stdout.trim()
  const nameStatus = git(['diff', '--name-status', base]).stdout.trim()
  const deletions = nameStatus.split('\n').filter(l => /^D\s/.test(l)).map(l => l.slice(1).trim())
  const untracked = git(['ls-files', '--others', '--exclude-standard']).stdout.split('\n').filter(Boolean)
  const full = git(['diff', base]).stdout
  const lines = full.split('\n')
  const spillDir = path.join(BASE_DIR, 'state', 'review')
  fs.mkdirSync(spillDir, { recursive: true })
  const stamp = Date.now()
  let diffSection
  if (lines.length > 800) {
    const spill = path.join(spillDir, 'diff-' + stamp + '.patch')
    fs.writeFileSync(spill, full)
    diffSection = 'Diff is ' + lines.length + ' lines; written to ' + rel(spill) + '. Read it there.'
  } else {
    diffSection = full
  }
  const body = [
    '# Review evidence pack',
    '',
    'Base: ' + base,
    'Head: ' + (git(['rev-parse', 'HEAD']).stdout.trim() || 'n/a'),
    'Generated: ' + nowIso(),
    '',
    '## Commits',
    '',
    commits || '(none)',
    '',
    '## Diffstat',
    '',
    stat || '(empty)',
    '',
    '## Deletion audit (files with removals — always review what left, not only what arrived)',
    '',
    deletions.length ? deletions.join('\n') : '(no deleted files)',
    '',
    '## Untracked new files',
    '',
    untracked.length ? untracked.join('\n') : '(none)',
    '',
    '## Diff',
    '',
    diffSection,
    '',
  ].join('\n')
  const outPath = path.join(spillDir, 'review-pack-' + stamp + '.md')
  fs.writeFileSync(outPath, body)
  note('review pack written to ' + rel(outPath))
  return emit({
    command: 'review-pack', ok: true, base, packPath: rel(outPath),
    commits: commits ? commits.split('\n').length : 0,
    deletedFiles: deletions, untracked, diffLines: lines.length, diffHash: diffHash(),
  }, EXIT.OK)
}

function resolveBase () {
  const tag = git(['describe', '--tags', '--abbrev=0']).stdout.trim()
  if (tag) return tag
  const origin = git(['rev-parse', '--verify', 'origin/main']).stdout.trim()
  if (origin) return 'origin/main'
  const head = git(['rev-parse', '--verify', 'HEAD']).stdout.trim()
  if (!head) return 'HEAD'
  const first = git(['rev-list', '--max-parents=0', 'HEAD']).stdout.trim().split('\n')[0]
  return first || 'HEAD'
}

// ── the composite Definition-of-Done gate ───────────────────────────────────

const DOD_STEPS = [
  { id: 'catalog-lint', run: (c) => lintCatalog(c), blocking: true },
  { id: 'skills-lint', run: () => skillsLint(), blocking: true },
  { id: 'agents-lint', run: (c) => agentsLint(c), blocking: true },
  { id: 'spec-lint', run: (c) => specLint(c), blocking: true },
  { id: 'adr-check', run: (c) => adrCheck(c), blocking: true },
  { id: 'attributes', run: (c) => attributeAudit(c), blocking: true },
  { id: 'arch-check', run: (c) => archCheck(c, {}), blocking: true },
  { id: 'fitness', run: (c) => fitness(c, { all: true }), blocking: true },
  { id: 'trace', run: (c) => trace(c), blocking: true },
  { id: 'ledger', run: () => verifyLedger(), blocking: true },
  { id: 'risk', run: (c) => riskScan(c), blocking: false },
  { id: 'budget', run: (c) => assessBudget(c, computeImpact(c, changedPaths({}).paths)), blocking: false },
]

COMMANDS.dod = (args) => {
  const catalog = needCatalog('dod'); if (!catalog) return EXIT.DEGRADED
  const steps = []
  for (const s of DOD_STEPS) {
    let r
    try { r = s.run(catalog) } catch (e) { r = { ok: false, degraded: true, reason: 'engine error: ' + e.message } }
    const status = r.degraded ? 'DEGRADED' : (r.ok ? 'PASS' : 'FAIL')
    steps.push({ id: s.id, status, blocking: s.blocking, reason: r.reason || (r.counts ? JSON.stringify(r.counts) : undefined) })
    note(' ' + status.padEnd(9) + s.id + (r.reason ? ' :: ' + r.reason : ''))
  }
  const blockingFailures = steps.filter(s => s.blocking && s.status !== 'PASS')
  const ok = blockingFailures.length === 0
  note(ok ? 'Definition of Done: satisfied' : 'Definition of Done: NOT satisfied (' + blockingFailures.map(s => s.id).join(', ') + ')')
  if (!args.flags['skip-gate']) note('NOTE: dod runs static governance only. Behavioural proof still requires: node .dsh/base/dsb.mjs gate')
  return emit({ command: 'dod', ok, steps, blockingFailures: blockingFailures.map(s => s.id) }, ok ? EXIT.OK : EXIT.GATE)
}


COMMANDS['sync-check'] = (args) => {
  const catalog = needCatalog('sync-check'); if (!catalog) return EXIT.DEGRADED
  const r = syncCheck(catalog, { staged: !!args.flags.staged, paths: args.flags.paths ? list(args.flags.paths) : null })
  if (r.degraded) return degraded('sync-check', r.reason)
  for (const f of r.findings) note((f.severity === 'error' ? ' ERR  ' : ' warn ') + f.code + ' :: ' + f.message)
  note(r.ok
    ? 'memory is in step with the code (' + r.codeChanged + ' governed file(s) changed)'
    : 'memory is out of step; the next session could not resume from this commit')
  return emit({ command: 'sync-check', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

COMMANDS.recap = (args) => {
  const state = loadCatalog()
  const r = recap(state.catalog, { budget: args.flags.budget ? Number(args.flags.budget) : null })
  note(r.text)
  note('recap: ' + r.chars + '/' + r.budget + ' chars' + (r.truncated ? ' (truncated)' : '') +
    ' | memory ' + r.health.bytes + '/' + r.health.maxLedgerBytes + ' bytes, ' +
    r.health.doneEntries + '/' + r.health.keepDone + ' Done entries')
  if (!r.health.ok) note('  ' + r.health.advice)
  return emit({ command: 'recap', ...r }, EXIT.OK)
}

COMMANDS.archive = (args) => {
  const state = loadCatalog()
  if (args.flags.changelog) {
    const c = archiveChangelog(state.catalog, { apply: !!args.flags.apply, keep: args.flags.keep ? Number(args.flags.keep) : 10 })
    if (c.degraded) return degraded('archive', c.reason)
    note(c.applied ? 'archived ' + c.moved + ' changelog version(s) into ' + c.archive
      : (c.moved ? 'would archive ' + c.moved + ' version(s); re-run with --apply' : 'nothing to archive'))
    return emit({ command: 'archive', target: 'changelog', ...c }, EXIT.OK)
  }
  const r = archiveLedger(state.catalog, { apply: !!args.flags.apply })
  if (r.degraded) return degraded('archive', r.reason)
  for (const p of r.plan) note('  ' + p.section + ': ' + p.total + ' entries, keeping ' + p.keep + ', moving ' + p.moving)
  note(r.applied
    ? 'archived ' + r.moved + ' entry(ies) into ' + r.archive + '; nothing was deleted'
    : (r.moved ? 'would archive ' + r.moved + ' entry(ies); re-run with --apply' : 'nothing to archive'))
  return emit({ command: 'archive', ...r }, EXIT.OK)
}

COMMANDS.init = (args) => {
  if (!isGitRepo()) {
    note('init: not a git repository. Run "git init" first, then init again.')
    return emit({ command: 'init', ok: false, degraded: true, reason: 'not-a-git-repository' }, EXIT.DEGRADED)
  }
  const mode = args.flags.vendored ? 'vendored' : (args.flags['exclude-file'] ? 'exclude-file' : 'private')
  const notes = []

  // 1. Isolation. The tool travels with the working copy but need not enter the
  //    project's history. Project memory is NOT isolated: it is project state and
  //    is what lets another machine resume without interruption.
  const entries = ['.dsh/']
  if (args.flags['ignore-constitution']) entries.push('AGENTS.md', 'AGENTS.local.md')
  let isolation = { mode, file: null, added: [], already: false }
  if (mode !== 'vendored') {
    const target = mode === 'exclude-file' ? '.git/info/exclude' : '.gitignore'
    if (mode === 'exclude-file') fs.mkdirSync(path.join(ROOT, '.git', 'info'), { recursive: true })
    const existing = exists(target) ? readText(target, '') : ''
    const have = new Set(existing.split(/\r?\n/).map(l => l.trim()))
    const missing = entries.filter(e => !have.has(e))
    isolation = { mode, file: target, added: missing, already: missing.length === 0 }
    if (missing.length && !args.flags['dry-run']) {
      const head = '# deepseek-base: private tooling, not part of this repository'
      const block = (existing && !existing.endsWith('\n') ? '\n' : '') + (existing ? '\n' : '') +
        head + '\n' + missing.join('\n') + '\n'
      writeAtomic(target, existing + block)
    }
  } else notes.push('vendored mode: the scaffold is committed with the project; nothing was ignored')

  // 2. The enforcement seam. core.hooksPath lives in .git/config, which is
  //    per-clone: it must be set again on every machine and every fresh clone.
  const before = (git(['config', '--get', 'core.hooksPath']).stdout || '').trim()
  const hooks = { path: '.dsh/base/githooks', previous: before || null, already: before === '.dsh/base/githooks', changed: false }
  if (args.flags['no-hooks']) notes.push('hooks left untouched (--no-hooks)')
  else if (!hooks.already && !args.flags['dry-run']) {
    const res = git(['config', 'core.hooksPath', '.dsh/base/githooks'])
    hooks.changed = res.ok
    if (!res.ok) notes.push('could not set core.hooksPath: ' + res.stderr.trim())
  }
  for (const h of ['pre-commit', 'commit-msg', 'pre-push']) {
    try { fs.chmodSync(path.join(BASE_DIR, 'githooks', h), 0o755) } catch { /* filesystem without modes */ }
  }

  // 3. The switch. Governance stays off until a catalog exists.
  const catalogPath = path.join(BASE_DIR, 'catalog.json')
  const examplePath = path.join(BASE_DIR, 'catalog.example.json')
  const catalog = { path: rel(catalogPath), existed: fs.existsSync(catalogPath), created: false, source: null }
  if (!catalog.existed && !args.flags['no-enable'] && !args.flags['dry-run']) {
    // Transcribing a module map by hand is asking a human to copy facts the
    // repository already contains. Propose from the real tree when there is one,
    // and fall back to the template only when there is nothing to read.
    let discovered = null
    try { discovered = discoverCatalog({ depth: args.flags.depth ? Number(args.flags.depth) : 2 }) } catch { discovered = null }
    if (discovered && discovered.ok) {
      writeJsonAtomic(rel(catalogPath), discovered.draft)
      catalog.created = true
      catalog.source = 'discovered'
      catalog.proposedModules = discovered.proposedModules
      catalog.detectedCommands = discovered.detectedCommands.map(c => c.id)
      catalog.needsDecision = discovered.needsDecision.map(d => d.field)
      notes.push('catalog proposed from ' + discovered.proposedModules + ' real module(s) and ' +
        discovered.realEdges + ' real import edge(s); riskTier, attributes and forbidden edges are left for a human to decide')
    } else if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, catalogPath)
      catalog.created = true
      catalog.source = 'template'
      notes.push('nothing to read yet, so the catalog was seeded from the template; run "catalog discover --write" once there is source')
    }
  }

  const health = doctor(loadCatalog())
  note('')
  note('deepseek-base init - mode: ' + mode)
  if (isolation.file) {
    note(isolation.already
      ? '  already isolated in ' + isolation.file
      : '  isolated in ' + isolation.file + ': ' + isolation.added.join(' '))
    note('  progress.md is NOT ignored: project memory is project state and must travel with the repository')
  }
  note(hooks.already ? '  hooks already wired' : (hooks.changed ? '  hooks wired: core.hooksPath = .dsh/base/githooks' : '  hooks not wired'))
  note(catalog.created || catalog.existed ? '  governance ON  (' + catalog.path + ')' : '  governance OFF (no catalog; every targeted command exits 3)')
  for (const n of notes) note('  note: ' + n)
  note('')
  note('  Next:  node .dsh/base/dsb.mjs recap      # where are we')
  note('         node .dsh/base/dsb.mjs doctor     # 8 checks, read "failing"')
  note('         node .dsh/base/dsb.mjs dod        # the static Definition of Done')
  note('  On a new machine: copy .dsh/ back in and run init again. It is idempotent.')

  return emit({ command: 'init', ok: true, mode, isolation, hooks, catalog, notes, doctorFailing: health.failing }, EXIT.OK)
}


COMMANDS.cochange = (args) => {
  const catalog = needCatalog('cochange'); if (!catalog) return EXIT.DEGRADED
  if (!needGit('cochange')) return EXIT.DEGRADED
  const r = coChange(catalog, {
    limit: args.flags.limit ? Number(args.flags.limit) : 500,
    minPairs: args.flags['min-pairs'] ? Number(args.flags['min-pairs']) : 3,
    ratio: args.flags.ratio ? Number(args.flags.ratio) : 0.5,
  })
  if (r.degraded) return degraded('cochange', r.reason)
  for (const f of r.findings) note((f.severity === 'error' ? ' ERR  ' : ' warn ') + f.code + ' :: ' + f.message)
  note('analysed ' + r.analysed + ' of ' + r.commits + ' commits (' + r.sweeping + ' sweeping commits excluded), ' + r.modules + ' module(s) with history')
  note(r.advice)
  return emit({ command: 'cochange', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

function needFleet (command, args) {
  const state = loadFleet(process.cwd(), args.flags.fleet === true ? null : args.flags.fleet)
  if (!state.present) {
    degraded(command, 'no ' + FLEET_FILE + ' found in this directory or any ancestor. A fleet manifest declares the repositories and the contracts between them; without it only single-repository governance applies.')
    return null
  }
  if (!state.fleet) { degraded(command, state.parseError || 'fleet.json could not be parsed'); return null }
  return state
}

COMMANDS.fleet = (args) => {
  const sub = args.positional[1] || 'status'
  const state = needFleet('fleet', args)
  if (!state) return EXIT.DEGRADED

  if (sub === 'lint') {
    const r = fleetLint(state)
    for (const f of r.findings) note((f.severity === 'error' ? ' ERR  ' : ' warn ') + f.code + ' :: ' + f.message)
    note(r.counts.repos + ' repositor(y|ies), ' + r.counts.contracts + ' contract(s), ' +
      r.counts.error + ' error(s), ' + r.counts.warning + ' warning(s)')
    return emit({ command: 'fleet', sub, fleetFile: state.file, ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
  }

  if (sub === 'impact') {
    const contract = args.positional[2]
    if (!contract) return emit({ command: 'fleet', sub, ok: false, reason: 'usage: fleet impact <contract-id>' }, EXIT.DEGRADED)
    const r = fleetImpact(state, contract)
    if (r.degraded) { note(r.reason); note('known contracts: ' + (r.known || []).join(', ')); return emit({ command: 'fleet', sub, ...r }, EXIT.DEGRADED) }
    note('contract ' + r.contract + ' owned by ' + r.provider)
    note('  versions            : ' + r.versions.map(v => v.version + ' (' + v.status + ')').join(', '))
    note('  direct consumers    : ' + (r.directConsumers.join(', ') || 'none'))
    note('  reached transitively: ' + (r.transitiveConsumers.join(', ') || 'none'))
    note('  coordination cost   : ' + r.coordinationCost + ' repositor(y|ies)')
    note('  ' + r.advice)
    return emit({ command: 'fleet', sub, ...r }, EXIT.OK)
  }

  if (sub === 'recap') {
    const r = fleetRecap(state, { budget: args.flags.budget ? Number(args.flags.budget) : 8000 })
    note(r.text)
    note('fleet recap: ' + r.chars + '/' + r.budget + ' chars over ' + r.repos + ' repositor(y|ies)' + (r.truncated ? ' (truncated)' : ''))
    return emit({ command: 'fleet', sub, ...r }, EXIT.OK)
  }

  if (sub === 'status') {
    const r = fleetStatus(state, { deep: !!args.flags.deep })
    for (const row of r.rows) {
      note('  ' + (row.exists ? (row.installed ? (row.governanceEnabled ? ' ok  ' : ' off ') : ' bare') : ' MISS') + ' ' +
        row.id.padEnd(18) +
        (row.installed ? 'modules=' + row.modules + ' skills=' + row.skills : 'scaffold not installed') +
        (row.doctorFailing && row.doctorFailing.length ? ' failing=[' + row.doctorFailing.join(',') + ']' : '') +
        (r.deep ? ' dod=' + row.dod + ' sync=' + row.syncCheck : ''))
    }
    note(r.ok ? 'every repository is installed, governed and healthy' : 'needs attention: ' + r.problems.join(', '))
    return emit({ command: 'fleet', sub, fleetFile: state.file, ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
  }

  return emit({ command: 'fleet', ok: false, reason: 'usage: fleet lint|impact <contract>|recap|status [--deep]' }, EXIT.DEGRADED)
}


COMMANDS.catalog = (args) => {
  const sub = args.positional[1] || 'discover'
  if (sub !== 'discover') {
    return emit({ command: 'catalog', ok: false, reason: 'usage: catalog discover [--write] [--depth N]' }, EXIT.DEGRADED)
  }
  if (!needGit('catalog')) return EXIT.DEGRADED

  const r = discoverCatalog({ depth: args.flags.depth ? Number(args.flags.depth) : 2 })
  if (r.degraded) return degraded('catalog', r.reason)

  const catalogPath = '.dsh/base/catalog.json'
  const draftPath = '.dsh/base/catalog.draft.json'
  const target = exists(catalogPath) ? draftPath : catalogPath

  note('')
  note('Proposed from what the repository already contains:')
  note('  ' + r.proposedModules + ' module(s) over ' + r.trackedPaths + ' tracked path(s)')
  note('  ' + r.realEdges + ' real import edge(s) became dependsOn declarations')
  if (r.unresolvedSpecifiers) note('  ' + r.unresolvedSpecifiers + ' import specifier(s) could not be attributed; the graph may be incomplete')
  note('  checks detected: ' + (r.detectedCommands.length
    ? r.detectedCommands.map(c => c.id + ' -> ' + c.command).join(' | ')
    : 'none (every gate will report BLOCKED until a check exists, which is correct)'))
  for (const c of r.detectedCommands) note('      ' + c.id.padEnd(6) + ' from ' + c.source)
  if (r.stillUnmappedCount) {
    note('  ' + r.stillUnmappedCount + ' path(s) still unmapped; catalog-lint will name them:')
    for (const p of r.stillUnmapped.slice(0, 8)) note('      ' + p)
  }
  note('')
  note('The engine refuses to decide these for you:')
  for (const d of r.needsDecision) note('  - ' + d.field + ': ' + d.why)
  note('')

  if (args.flags.write) {
    writeJsonAtomic(target, r.draft)
    note('draft written to ' + target + (target === draftPath ? ' (a catalog already exists; review and merge)' : ''))
    note('next: node .dsh/base/dsb.mjs catalog-lint')
  } else {
    note('re-run with --write to save it to ' + target)
  }

  return emit({ command: 'catalog', sub, ok: true, wrote: args.flags.write ? target : null, ...r }, EXIT.OK)
}


COMMANDS.fast = (args) => {
  const catalog = loadCatalog().catalog
  const sub = args.positional[1] || 'status'

  if (sub === 'status') {
    const s = fastState()
    const skippable = catalog ? fastSkippable(catalog) : []
    note(s.active
      ? 'fast mode is OPEN until ' + s.until + ' - reason: ' + s.reason
      : (s.expired ? 'fast mode expired at ' + s.record.until + ' and is no longer applied' : 'fast mode is closed'))
    note('  skippable in this project: ' + (skippable.join(', ') || 'nothing is marked allowFastSkip, so fast mode would change nothing'))
    note('  never skippable: every check claiming security, safety or privacy')
    return emit({ command: 'fast', sub, ...s, skippable }, EXIT.OK)
  }

  if (sub === 'on') {
    if (!catalog) return degraded('fast', 'no catalog; there is nothing to relax')
    try {
      const r = setFast({
        on: true,
        minutes: args.flags.minutes ? Number(args.flags.minutes) : 60,
        reason: typeof args.flags.reason === 'string' ? args.flags.reason : '',
      })
      const skippable = fastSkippable(catalog)
      note('fast mode OPEN for ' + r.record.minutes + ' minutes, until ' + r.record.until)
      note('  reason recorded: ' + r.record.reason)
      note('  will skip: ' + (skippable.join(', ') || 'nothing - no check is marked allowFastSkip'))
      note('  will still run: everything else, and every protected check without exception')
      note('')
      note('  This is a loan. Each skipped check is recorded as SKIPPED with its reason,')
      note('  the gate record is stamped fastMode, and that record cannot close a task or')
      note('  a release until a full gate repays it. It expires by itself.')
      return emit({ command: 'fast', sub, ok: true, ...r, skippable }, EXIT.OK)
    } catch (e) {
      note('fast: ' + e.message)
      return emit({ command: 'fast', sub, ok: false, reason: e.message }, EXIT.DEGRADED)
    }
  }

  if (sub === 'off') {
    const before = fastState()
    setFast({ on: false })
    note(before.record ? 'fast mode closed; run "dsb gate" to repay the skipped evidence' : 'fast mode was not open')
    return emit({ command: 'fast', sub, ok: true, wasOpen: !!before.record }, EXIT.OK)
  }

  return emit({ command: 'fast', ok: false, reason: 'usage: fast on --minutes N --reason "..." | fast off | fast status' }, EXIT.DEGRADED)
}

COMMANDS['rules-audit'] = (args) => {
  const catalog = needCatalog('rules-audit'); if (!catalog) return EXIT.DEGRADED
  const r = rulesAudit(catalog, { files: args.flags.files ? list(args.flags.files) : null })
  for (const f of r.findings) note(' ERR  ' + f.code + '  ' + f.file + ':' + f.line + '  ' + f.message)
  note(r.counts.total + ' rule(s): ' + r.counts.enforced + ' enforced, ' +
    r.counts.declaredUnenforced + ' declared prompt-only, ' + r.counts.unenforced + ' silently unenforced' +
    ' (enforcement ratio ' + r.enforcementRatio + ')')
  note(r.advice)
  return emit({ command: 'rules-audit', ...r }, r.ok ? EXIT.OK : EXIT.VIOLATION)
}

COMMANDS.invariants = (args) => {
  const state = loadCatalog()
  const r = invariants(state.catalog, { budget: args.flags.budget ? Number(args.flags.budget) : 1200 })
  note(r.text)
  return emit({ command: 'invariants', ...r }, EXIT.OK)
}


COMMANDS.review = async (args) => {
  const catalog = needCatalog('review'); if (!catalog) return EXIT.DEGRADED
  const sub = args.positional[1] || 'status'

  if (sub === 'start') {
    const pack = COMMANDS['review-pack'] ? null : null
    const r = startReview(catalog, { scope: typeof args.flags.scope === 'string' ? args.flags.scope : '' })
    if (r.degraded) return degraded('review', r.reason)
    note('review opened against diff ' + r.session.diffHash.slice(0, 12))
    note('  required lenses: ' + r.session.requiredLenses.join(', '))
    note('')
    note('  Protocol - three roles, structured disagreement, not consensus:')
    note('    1. dsb review-pack                    assemble the evidence, including the deletion audit')
    note('    2. dsb review blue     < claims.json  state what you verified and with what evidence')
    note('    3. dsb review lens <n> < findings.json  one report per required lens, each finding located')
    note('    4. dsb review verdict                 computed from what was recorded, never asserted')
    note('')
    note('  Delegate each lens to a separate agent. Agreement reached cheaply is not review.')
    return emit({ command: 'review', sub, ...r }, EXIT.OK)
  }

  if (sub === 'blue') {
    const raw = await readStdin()
    let payload
    try { payload = JSON.parse(raw) } catch { return emit({ command: 'review', sub, ok: false, reason: 'stdin must be {"claims":[{"claim":"...","evidence":"..."}]}' }, EXIT.DEGRADED) }
    const r = recordBlue(payload)
    if (!r.ok) { note('review: ' + r.reason); return emit({ command: 'review', sub, ...r }, r.stale ? EXIT.STALE : EXIT.VIOLATION) }
    note('blue recorded ' + r.session.blue.claims.length + ' claim(s), each with evidence')
    return emit({ command: 'review', sub, ok: true, claims: r.session.blue.claims.length }, EXIT.OK)
  }

  if (sub === 'lens') {
    const name = args.positional[2]
    if (!name) return emit({ command: 'review', sub, ok: false, reason: 'usage: review lens <name> < findings.json' }, EXIT.DEGRADED)
    const raw = await readStdin()
    let payload
    try { payload = JSON.parse(raw) } catch { return emit({ command: 'review', sub, ok: false, reason: 'stdin must be {"findings":[{"severity":"error","location":"file:line","summary":"..."}]}' }, EXIT.DEGRADED) }
    const r = recordLens(name, payload)
    if (!r.ok) { note('review: ' + r.reason); return emit({ command: 'review', sub, ...r }, r.stale ? EXIT.STALE : EXIT.VIOLATION) }
    const rec = r.session.lenses[name]
    note('lens ' + name + ': ' + rec.findings.length + ' finding(s)' + (rec.unable ? ' [unable to conclude]' : ''))
    return emit({ command: 'review', sub, ok: true, lens: name, findings: rec.findings.length }, EXIT.OK)
  }

  if (sub === 'verdict') {
    const r = reviewVerdict(catalog, {
      reviewer: typeof args.flags.reviewer === 'string' ? args.flags.reviewer : 'reviewer',
      notes: typeof args.flags.notes === 'string' ? args.flags.notes : '',
    })
    if (r.degraded) return degraded('review', r.reason)
    if (!r.ok) {
      for (const b of r.blockers || []) note(' BLOCKER  ' + b)
      note('no verdict: a review that did not look cannot conclude')
      return emit({ command: 'review', sub, ...r }, r.stale ? EXIT.STALE : EXIT.VIOLATION)
    }
    for (const e of r.errors) note(' ' + e.lens.padEnd(12) + (e.location || e.reproduction) + '  ' + (e.summary || ''))
    note('verdict: ' + r.verdict + ' over lenses [' + r.lensCoverage.join(', ') + ']')
    note('  ' + r.advice)
    if (r.receipt) note('  receipt written, bound to diff ' + String(r.receipt.diffHash).slice(0, 12))
    return emit({ command: 'review', sub, ...r }, r.verdict === 'ACCEPT' ? EXIT.OK : EXIT.GATE)
  }

  if (sub === 'status') {
    const s = readReview()
    if (!s) { note('no review session open'); return emit({ command: 'review', sub, ok: true, session: null, lenses: reviewLenses(catalog) }, EXIT.OK) }
    const missing = s.requiredLenses.filter(l => !s.lenses[l])
    note('review of diff ' + s.diffHash.slice(0, 12) + (s.diffHash === diffHash() ? '' : '  [STALE: the tree changed]'))
    note('  blue      : ' + (s.blue ? s.blue.claims.length + ' claim(s)' : 'not stated'))
    note('  reported  : ' + (Object.keys(s.lenses).join(', ') || 'none'))
    note('  missing   : ' + (missing.join(', ') || 'none'))
    note('  verdict   : ' + (s.verdict ? s.verdict.verdict : 'none'))
    return emit({ command: 'review', sub, ok: true, session: s, missing, stale: s.diffHash !== diffHash() }, EXIT.OK)
  }

  return emit({ command: 'review', ok: false, reason: 'usage: review start|blue|lens <name>|verdict|status' }, EXIT.DEGRADED)
}

COMMANDS.spec = (args) => {
  const catalog = needCatalog('spec'); if (!catalog) return EXIT.DEGRADED
  const r = specView(catalog, {
    paths: args.flags.paths ? list(args.flags.paths) : null,
    all: !!args.flags.all,
    budget: args.flags.budget ? Number(args.flags.budget) : 6000,
  })
  if (r.degraded) return degraded('spec', r.reason)
  note(r.text)
  note('spec view: ' + r.chars + '/' + r.budget + ' chars, ' + r.selected.length + ' of ' + r.total + ' requirement(s) in scope')
  return emit({ command: 'spec', ...r }, EXIT.OK)
}

COMMANDS.help = () => {
  const names = Object.keys(COMMANDS).sort()
  note('dsb — deepseek-base governance engine')
  note('usage: node .dsh/base/dsb.mjs <subcommand> [--flags]')
  note('subcommands: ' + names.join(' '))
  note('exit codes: 0 clean | 1 violation | 2 blocking gate | 3 degraded | 4 stale')
  return emit({ command: 'help', subcommands: names }, EXIT.OK)
}

// ── stdin ───────────────────────────────────────────────────────────────────

function readStdin () {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve(''); return }
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => { data += c })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(''))
  })
}

// ── entry ───────────────────────────────────────────────────────────────────

async function main () {
  const args = parseArgs(process.argv.slice(2))
  const name = args.positional[0] || 'help'
  const fn = COMMANDS[name]
  if (!fn) {
    note('unknown subcommand: ' + name)
    emit({ command: name, ok: false, reason: 'unknown subcommand' }, EXIT.DEGRADED)
    return EXIT.DEGRADED
  }
  try {
    return await fn(args)
  } catch (e) {
    note('engine error: ' + (e && e.stack ? e.stack : e))
    emit({ command: name, ok: false, reason: 'engine-error: ' + (e && e.message ? e.message : String(e)) }, EXIT.DEGRADED)
    return EXIT.DEGRADED
  }
}

main().then((code) => { process.exitCode = code === undefined ? EXIT.OK : code })
