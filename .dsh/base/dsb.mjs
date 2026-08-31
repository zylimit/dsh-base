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
  changedPaths, diffHash, writeJsonAtomic, readJson, rel, exists, nowIso, listFiles, git,
} from './lib/core.mjs'
import { lintCatalog, computeImpact, archCheck, recordTrend, trendGate, readTrend } from './lib/graph.mjs'
import {
  runGate, verifyLedger, readLedger, gateAudit, writeReceipt, verifyReceipts,
  listWaivers, validateWaiver, waiverContentHash, assessBudget, startTask, readTask, completeTask,
} from './lib/quality.mjs'
import { fitness, adrCheck, specLint, skillsLint, agentsLint, trace } from './lib/scan.mjs'
import { contextPack, doctor, retention, riskScan, attributeAudit } from './lib/context.mjs'
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

COMMANDS.ledger = () => {
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
