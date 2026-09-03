// dsh-base :: catalog lint, impact closure, architecture guard, drift ratchet.
//
// The architecture guard compares REAL import edges extracted from source
// against the DECLARED dependency graph in the module catalog. Undeclared
// edges are drift; forbidden edges are violations; the trend ledger turns the
// check into a ratchet so brownfield repositories can adopt it on day one.

import path from 'node:path'
import fs from 'node:fs'
import {
  BASE_DIR, ATTRIBUTES, TIERS, RISK_TIERS, REASON_REQUIRED_TIERS,
  CATCH_ALL_GLOBS, classifyPath, globToRegExp, globSpecificity,
  trackedFiles, readText, rel, abs, writeJsonAtomic, readJson, nowIso, git,
  ROOT, exists,
} from './core.mjs'

// ── catalog lint ────────────────────────────────────────────────────────────

const ERROR = 'error'
const WARN = 'warning'

export function lintCatalog (catalog) {
  const findings = []
  const add = (severity, code, message, extra = {}) => findings.push({ severity, code, message, ...extra })
  const ids = new Set()

  if (!Array.isArray(catalog.modules) || catalog.modules.length === 0) {
    add(ERROR, 'NO_MODULES', 'catalog declares no modules; nothing can be governed')
  }

  const layers = Array.isArray(catalog.layers) ? catalog.layers : []
  const layerIndex = new Map(layers.map((l, i) => [l, i]))

  for (const m of catalog.modules || []) {
    if (!m.id || typeof m.id !== 'string') { add(ERROR, 'MODULE_ID_MISSING', 'module without a string id'); continue }
    if (ids.has(m.id)) add(ERROR, 'DUPLICATE_MODULE_ID', 'duplicate module id "' + m.id + '"', { module: m.id })
    ids.add(m.id)

    if (!Array.isArray(m.paths) || m.paths.length === 0) {
      add(ERROR, 'MODULE_PATHS_MISSING', 'module "' + m.id + '" declares no paths', { module: m.id })
    }
    for (const g of m.paths || []) {
      if (CATCH_ALL_GLOBS.has(String(g).trim())) {
        add(ERROR, 'CATCH_ALL', 'module "' + m.id + '" uses catch-all glob "' + g + '"; it would swallow the whole tree and hide unmapped files', { module: m.id })
      }
    }
    if (m.riskTier && !RISK_TIERS.includes(m.riskTier)) {
      add(ERROR, 'UNKNOWN_RISK_TIER', 'module "' + m.id + '" has unknown riskTier "' + m.riskTier + '"', { module: m.id })
    }
    if (m.layer && layers.length && !layerIndex.has(m.layer)) {
      add(ERROR, 'UNKNOWN_LAYER', 'module "' + m.id + '" declares layer "' + m.layer + '" which is not in catalog.layers', { module: m.id })
    }
    if (layers.length && !m.layer) {
      add(WARN, 'MISSING_LAYER', 'module "' + m.id + '" has no layer while catalog.layers is defined', { module: m.id })
    }

    const attrs = m.attributes || {}
    for (const [name, tier] of Object.entries(attrs)) {
      if (!ATTRIBUTES.includes(name)) add(ERROR, 'UNKNOWN_ATTRIBUTE', 'module "' + m.id + '" declares unknown attribute "' + name + '"', { module: m.id })
      if (!TIERS.includes(tier)) add(ERROR, 'UNKNOWN_TIER', 'module "' + m.id + '" attribute "' + name + '" has unknown tier "' + tier + '"', { module: m.id })
      if (REASON_REQUIRED_TIERS.has(tier) && !(m.attributeReasons || {})[name]) {
        add(ERROR, 'UNJUSTIFIED_TIER', 'module "' + m.id + '" sets ' + name + '=' + tier + ' without attributeReasons.' + name + '; opting out of governance must be a recorded decision', { module: m.id })
      }
    }
  }

  for (const m of catalog.modules || []) {
    for (const d of m.dependsOn || []) {
      if (!ids.has(d)) add(ERROR, 'DANGLING_DEP', 'module "' + m.id + '" dependsOn unknown module "' + d + '"', { module: m.id })
    }
    for (const f of m.forbiddenDependencies || []) {
      if (f === m.id) add(ERROR, 'SELF_FORBIDDEN', 'module "' + m.id + '" forbids itself', { module: m.id })
      else if (!ids.has(f)) add(ERROR, 'DANGLING_FORBIDDEN', 'module "' + m.id + '" forbids unknown module "' + f + '"', { module: m.id })
      if ((m.dependsOn || []).includes(f)) {
        add(ERROR, 'FORBIDDEN_DECLARED', 'module "' + m.id + '" both dependsOn and forbids "' + f + '"; a prohibition is the stronger statement', { module: m.id })
      }
    }
    for (const c of m.verification || []) {
      if (!(catalog.checks || {})[c]) add(ERROR, 'DANGLING_CHECK', 'module "' + m.id + '" references undefined check "' + c + '"', { module: m.id })
    }
  }

  for (const [tier, list] of Object.entries(catalog.riskChecks || {})) {
    if (!RISK_TIERS.includes(tier)) add(ERROR, 'UNKNOWN_RISK_TIER', 'riskChecks declares unknown tier "' + tier + '"')
    for (const c of list || []) {
      if (!(catalog.checks || {})[c]) add(ERROR, 'DANGLING_CHECK', 'riskChecks.' + tier + ' references undefined check "' + c + '"')
    }
  }

  for (const [id, def] of Object.entries(catalog.checks || {})) {
    if (!def || typeof def.command !== 'string' || !def.command.trim()) {
      add(ERROR, 'CHECK_NO_COMMAND', 'check "' + id + '" has no command')
    }
    for (const a of (def && def.attributes) || []) {
      if (!ATTRIBUTES.includes(a)) add(ERROR, 'UNKNOWN_ATTRIBUTE', 'check "' + id + '" claims unknown attribute "' + a + '"')
    }
    if (def && def.allowFastSkip && ((def.attributes || []).some(a => a === 'security' || a === 'safety' || a === 'privacy'))) {
      add(ERROR, 'PROTECTED_FAST_SKIP', 'check "' + id + '" claims a protected attribute and may not set allowFastSkip')
    }
  }

  const cycles = findCycles(catalog)
  for (const c of cycles) add(WARN, 'CYCLE', 'dependency cycle: ' + c.join(' -> '))

  const t = trackedFiles(catalog.maxTrackedPaths)
  const paths = t.paths
  let unmapped = 0
  const overlapSeen = new Map()
  if (t.available) {
    if (paths.length === 0) {
      add(WARN, 'NO_TRACKED_PATHS', 'the repository has no tracked files, so this classification proved nothing; stage the tree and run it again')
    }
    if (t.truncated) add(WARN, 'TRUNCATED', 'tracked file list truncated at ' + catalog.maxTrackedPaths + ' of ' + t.total + '; coverage is incomplete and impact will expand conservatively')
    for (const p of paths) {
      const hits = []
      for (const m of catalog.modules || []) {
        for (const g of m.paths || []) {
          if (globToRegExp(g).test(p)) { hits.push({ id: m.id, spec: globSpecificity(g) }); break }
        }
      }
      if (hits.length > 1) {
        const top = Math.max(...hits.map(h => h.spec))
        const winners = hits.filter(h => h.spec === top)
        if (winners.length > 1) {
          const key = winners.map(w => w.id).sort().join('|')
          overlapSeen.set(key, (overlapSeen.get(key) || 0) + 1)
        }
      }
      if (hits.length === 0 && classifyPath(catalog, p).kind === 'unmapped') unmapped++
    }
    for (const [key, count] of overlapSeen) {
      add(ERROR, 'OVERLAP', count + ' path(s) claimed at equal specificity by modules: ' + key)
    }
    if (unmapped > 0) {
      add(ERROR, 'UNMAPPED', unmapped + ' tracked path(s) belong to no module, global or ignored entry; they would silently escape every targeted gate')
    }
  } else {
    add(WARN, 'NOT_GIT', 'not a git repository; full path classification skipped')
  }

  const errors = findings.filter(f => f.severity === ERROR)
  return {
    ok: errors.length === 0,
    findings,
    counts: {
      error: errors.length,
      warning: findings.length - errors.length,
      modules: (catalog.modules || []).length,
      trackedPaths: paths.length,
      unmapped,
      truncated: t.truncated,
    },
  }
}

export function findCycles (catalog) {
  const graph = new Map((catalog.modules || []).map(m => [m.id, m.dependsOn || []]))
  const cycles = []
  const state = new Map()
  const stack = []
  const visit = (id) => {
    if (state.get(id) === 2) return
    if (state.get(id) === 1) {
      const i = stack.indexOf(id)
      if (i >= 0) cycles.push([...stack.slice(i), id])
      return
    }
    state.set(id, 1); stack.push(id)
    for (const d of graph.get(id) || []) if (graph.has(d)) visit(d)
    stack.pop(); state.set(id, 2)
  }
  for (const id of graph.keys()) visit(id)
  return cycles
}

// ── impact ──────────────────────────────────────────────────────────────────

/**
 * Reverse-dependency closure over changed paths.
 * Conservative expansion is an iron rule: an unmapped hit, a global hit, a
 * truncated tracked list, or a non-git tree fans out to EVERY module and is
 * reported as degraded. Over-testing is cheap; a missed regression is not.
 */
export function computeImpact (catalog, changed) {
  const allIds = (catalog.modules || []).map(m => m.id)
  const direct = new Set()
  const reasons = []
  let degradedFlag = false

  for (const p of changed) {
    const c = classifyPath(catalog, p)
    if (c.kind === 'module') { direct.add(c.moduleId); continue }
    if (c.kind === 'ignored') continue
    if (c.kind === 'global') { degradedFlag = true; reasons.push({ path: p, reason: 'global-path' }); continue }
    degradedFlag = true; reasons.push({ path: p, reason: 'unmapped-path' })
  }

  let affected
  if (degradedFlag) {
    affected = new Set(allIds)
  } else {
    affected = new Set(direct)
    let grew = true
    while (grew) {
      grew = false
      for (const m of catalog.modules || []) {
        if (affected.has(m.id)) continue
        if ((m.dependsOn || []).some(d => affected.has(d))) { affected.add(m.id); grew = true }
      }
    }
  }

  const verification = {}
  for (const id of affected) verification[id] = resolveVerification(catalog, id)

  return {
    changed: [...changed].sort(),
    direct: [...direct].sort(),
    affected: [...affected].sort(),
    expansionReasons: reasons,
    degraded: degradedFlag,
    verification,
  }
}

export function resolveVerification (catalog, moduleId) {
  const m = (catalog.modules || []).find(x => x.id === moduleId)
  if (!m) return []
  if (Array.isArray(m.verification) && m.verification.length) return [...m.verification]
  const tier = m.riskTier || 'medium'
  return [...(((catalog.riskChecks || {})[tier]) || [])]
}

// ── import extraction ───────────────────────────────────────────────────────

const IMPORT_PATTERNS = [
  { ext: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.svelte', '.vue'], res: [
    /\bimport\s+(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ] },
  { ext: ['.py', '.pyi'], res: [
    /^\s*from\s+([A-Za-z_][\w.]*)\s+import\b/gm,
    /^\s*import\s+([A-Za-z_][\w.]*)/gm,
  ] },
  { ext: ['.go'], res: [/^\s*(?:import\s+)?(?:[\w.]+\s+)?"([^"]+)"/gm] },
  { ext: ['.java', '.kt', '.kts', '.scala', '.groovy'], res: [/^\s*import\s+(?:static\s+)?([\w.]+)/gm] },
  { ext: ['.cs'], res: [/^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm] },
  { ext: ['.rs'], res: [/^\s*(?:pub\s+)?use\s+([\w:]+)/gm, /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm] },
  { ext: ['.rb'], res: [/\brequire(?:_relative)?\s+['"]([^'"]+)['"]/g] },
  { ext: ['.php'], res: [/^\s*use\s+([\w\\]+)/gm, /\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g] },
  { ext: ['.swift'], res: [/^\s*import\s+([\w.]+)/gm] },
  { ext: ['.c', '.h', '.cc', '.cpp', '.hpp', '.cxx', '.hh'], res: [/^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm] },
]

const EXT_MAP = new Map()
for (const p of IMPORT_PATTERNS) for (const e of p.ext) EXT_MAP.set(e, p.res)

export const ARCH_SUPPORTED_EXTENSIONS = Object.freeze([...EXT_MAP.keys()])

export function extractImports (file, content) {
  const ext = path.extname(file).toLowerCase()
  const pats = EXT_MAP.get(ext)
  if (!pats) return null
  const specs = new Set()
  for (const re of pats) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(content)) !== null) if (m[1]) specs.add(m[1])
  }
  return [...specs]
}

const RESOLVE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.rb', '.php']
const RESOLVE_INDEX = ['index.ts', 'index.js', 'index.mjs', '__init__.py', 'mod.rs']

/** Map one import specifier, seen in fromFile, onto a catalog module id. */
export function resolveSpecifier (catalog, fromFile, spec) {
  if (spec.startsWith('.')) {
    const baseDir = path.posix.dirname(String(fromFile).split(path.sep).join('/'))
    const target = path.posix.normalize(path.posix.join(baseDir, spec))
    if (target.startsWith('..')) return { kind: 'external' }
    const candidates = [target]
      .concat(RESOLVE_EXT.map(e => target + e))
      .concat(RESOLVE_INDEX.map(f => path.posix.join(target, f)))
    for (const c of candidates) {
      const cls = classifyPath(catalog, c)
      if (cls.kind === 'module') return { kind: 'module', moduleId: cls.moduleId, via: c }
    }
    return { kind: 'unresolved', spec }
  }

  let best = null
  for (const m of catalog.modules || []) {
    for (const prov of m.provides || []) {
      const p = String(prov)
      if (spec === p || spec.startsWith(p.endsWith('/') ? p : p + '/') || spec.startsWith(p + '.') || spec.startsWith(p + '::') || spec.startsWith(p + '\\')) {
        if (!best || p.length > best.len) best = { moduleId: m.id, len: p.length }
      }
    }
  }
  if (best) return { kind: 'module', moduleId: best.moduleId }

  const asPath = spec.replace(/::/g, '/').replace(/\\/g, '/').replace(/\./g, '/')
  for (const suffix of ['', '.py', '.java', '.cs', '.go', '.rs', '.ts', '.js']) {
    const cls = classifyPath(catalog, asPath + suffix)
    if (cls.kind === 'module') return { kind: 'module', moduleId: cls.moduleId, via: asPath + suffix }
  }
  if (spec.includes('/')) {
    const cls = classifyPath(catalog, spec)
    if (cls.kind === 'module') return { kind: 'module', moduleId: cls.moduleId, via: spec }
  }
  return { kind: 'external', spec }
}

// ── architecture check ──────────────────────────────────────────────────────

const CACHE_PATH = () => path.join(BASE_DIR, 'state', 'arch-cache.json')

export function archCheck (catalog, { paths = null, useCache = true } = {}) {
  const layers = Array.isArray(catalog.layers) ? catalog.layers : []
  const layerIndex = new Map(layers.map((l, i) => [l, i]))
  const byId = new Map((catalog.modules || []).map(m => [m.id, m]))

  let files = paths
  if (!files) files = trackedFiles(catalog.maxTrackedPaths).paths

  const cache = useCache ? (readJson(rel(CACHE_PATH()), {}) || {}) : {}
  const nextCache = {}

  const edges = new Map()
  let scanned = 0, skippedLanguage = 0, unresolved = 0
  const unresolvedSamples = []

  for (const f of files) {
    const cls = classifyPath(catalog, f)
    if (cls.kind !== 'module') continue
    const ext = path.extname(f).toLowerCase()
    if (!EXT_MAP.has(ext)) { skippedLanguage++; continue }
    let stat
    try { stat = fs.statSync(abs(f)) } catch { continue }
    const sig = stat.size + ':' + Math.floor(stat.mtimeMs)
    let specs
    if (useCache && cache[f] && cache[f].sig === sig) specs = cache[f].specs
    else specs = extractImports(f, readText(f, '')) || []
    nextCache[f] = { sig, specs }
    scanned++
    for (const s of specs) {
      const r = resolveSpecifier(catalog, f, s)
      if (r.kind === 'module') {
        if (r.moduleId === cls.moduleId) continue
        const k = cls.moduleId + '->' + r.moduleId
        if (!edges.has(k)) edges.set(k, { from: cls.moduleId, to: r.moduleId, files: [] })
        const e = edges.get(k)
        if (e.files.length < 5) e.files.push(f)
      } else if (r.kind === 'unresolved') {
        unresolved++
        if (unresolvedSamples.length < 10) unresolvedSamples.push({ file: f, spec: s })
      }
    }
  }

  if (useCache && paths === null) {
    try { writeJsonAtomic(rel(CACHE_PATH()), nextCache) } catch { /* cache is an optimisation, never a gate */ }
  }

  const forbidden = []
  const undeclared = []
  const layerViolations = []
  const declaredUsed = new Set()

  for (const e of edges.values()) {
    const from = byId.get(e.from)
    if (!from) continue
    if ((from.forbiddenDependencies || []).includes(e.to)) {
      forbidden.push({ from: e.from, to: e.to, files: e.files, rule: 'forbiddenDependencies' })
      continue
    }
    const toMod = byId.get(e.to)
    if (layers.length && from.layer && toMod && toMod.layer) {
      const a = layerIndex.get(from.layer), b = layerIndex.get(toMod.layer)
      if (a !== undefined && b !== undefined && b < a) {
        layerViolations.push({ from: e.from, to: e.to, files: e.files, fromLayer: from.layer, toLayer: toMod.layer, rule: 'layer' })
        continue
      }
    }
    if ((from.dependsOn || []).includes(e.to)) { declaredUsed.add(e.from + '->' + e.to); continue }
    undeclared.push({ from: e.from, to: e.to, files: e.files })
  }

  const unusedDeclarations = []
  for (const m of catalog.modules || []) {
    for (const d of m.dependsOn || []) {
      if (!declaredUsed.has(m.id + '->' + d)) unusedDeclarations.push({ from: m.id, to: d })
    }
  }

  const cycles = findCycles(catalog)
  const violations = forbidden.length + layerViolations.length

  return {
    scanned,
    skippedLanguage,
    unresolved,
    unresolvedSamples,
    edges: edges.size,
    forbidden,
    layerViolations,
    undeclared,
    unusedDeclarations,
    cycles,
    metrics: {
      forbidden: forbidden.length,
      layerViolations: layerViolations.length,
      undeclared: undeclared.length,
      cycles: cycles.length,
      unusedDeclarations: unusedDeclarations.length,
    },
    ok: violations === 0 && undeclared.length === 0,
  }
}

// ── drift ratchet ───────────────────────────────────────────────────────────

const TREND_PATH = () => path.join(BASE_DIR, 'trend', 'arch-trend.jsonl')
const RATCHET_METRICS = ['forbidden', 'layerViolations', 'undeclared', 'cycles']

/**
 * Identity of the debt edges themselves, not just their count. A count ratchet
 * has a hole: delete one debt edge and add another and the number never moves.
 * The ratchet must compare edge identities against every prior snapshot.
 */
function edgeIdentities (result) {
  const cycleKey = (c) => [...new Set(c)].sort().join('|')
  return {
    forbidden: (result.forbidden || []).map(e => e.from + '->' + e.to),
    layerViolations: (result.layerViolations || []).map(e => e.from + '->' + e.to),
    undeclared: (result.undeclared || []).map(e => e.from + '->' + e.to),
    cycles: (result.cycles || []).map(cycleKey).filter(s => s.includes('|')),
  }
}

export function recordTrend (result) {
  const p = TREND_PATH()
  const entry = {
    at: nowIso(),
    metrics: Object.fromEntries(RATCHET_METRICS.map(k => [k, result.metrics[k] || 0])),
    edges: edgeIdentities(result),
    scanned: result.scanned,
  }
  let lines = []
  const existing = readText(rel(p), '')
  if (existing) lines = existing.split('\n').filter(Boolean)
  lines.push(JSON.stringify(entry))
  if (lines.length > 1000) lines = lines.slice(-500)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, lines.join('\n') + '\n')
  return entry
}

export function readTrend () {
  const raw = readText(rel(TREND_PATH()), '')
  if (!raw) return []
  const entries = []
  let corrupt = 0
  for (const l of raw.split('\n').filter(Boolean)) {
    try { entries.push(JSON.parse(l)) } catch { corrupt++ }
  }
  // Rides on the array so existing callers keep their shape; trendGate turns
  // any nonzero count into a failed verdict.
  entries.corrupt = corrupt
  return entries
}

/**
 * The ratchet turns one way only: historical debt is tolerated, new debt is not.
 * When snapshots carry edge identities, the ratchet compares edges against the
 * intersection of every prior snapshot - a new debt edge fails even if the
 * count stayed level. Forbidden edges are violations of the declared
 * architecture itself, so they are never baselineable: zero-tolerance, however
 * long the history. Snapshots without edge identities keep the count-based
 * ratchet.
 */
export function trendGate (current, history = readTrend()) {
  const forbiddenNow = (current.metrics && current.metrics.forbidden) || 0
  if (forbiddenNow > 0) {
    return {
      ok: false,
      forbiddenViolation: true,
      reason: 'forbidden dependency edges violate the declared architecture, not debt: the ratchet cannot baseline them',
      current: current.metrics,
      regressions: [{ metric: 'forbidden', best: 0, now: forbiddenNow }],
      samples: history.length,
    }
  }
  const corruptLines = (history.corrupt || 0) + (current.corrupt || 0)
  if (corruptLines > 0) {
    return {
      ok: false,
      corruptLines,
      reason: 'the debt history has ' + corruptLines + ' corrupt line(s); a ratchet over a history with holes cannot tell new debt from forgotten debt',
      current: current.metrics,
      regressions: [],
      samples: history.length,
    }
  }
  if (history.length === 0) {
    return { ok: true, baseline: true, reason: 'no baseline recorded yet; run "dsb arch-check --record" first' }
  }
  const withEdges = history.filter(h => h.edges)
  if (withEdges.length) {
    const intersection = {}
    const currentEdges = current.edges || { forbidden: [], layerViolations: [], undeclared: [], cycles: [] }
    for (const k of ['undeclared', 'layerViolations', 'cycles']) {
      const sets = withEdges.map(h => new Set(h.edges[k] || []))
      intersection[k] = sets.reduce((acc, s) => new Set([...acc].filter(x => s.has(x))), new Set(sets[0] || []))
    }
    const regressions = []
    for (const k of ['undeclared', 'layerViolations', 'cycles']) {
      for (const id of currentEdges[k] || []) {
        if (!intersection[k].has(id)) regressions.push({ metric: k, edge: id, reason: 'debt edge absent from at least one prior snapshot' })
      }
    }
    return {
      ok: regressions.length === 0,
      perEdge: true,
      intersection: Object.fromEntries(Object.entries(intersection).map(([k, v]) => [k, [...v]])),
      current: current.metrics,
      regressions,
      samples: withEdges.length,
    }
  }
  const best = {}
  for (const k of RATCHET_METRICS) {
    best[k] = Math.min(...history.map(h => (h.metrics && h.metrics[k] !== undefined) ? h.metrics[k] : Infinity))
  }
  const regressions = []
  for (const k of RATCHET_METRICS) {
    const now = current.metrics[k] || 0
    if (now > best[k]) regressions.push({ metric: k, best: best[k], now })
  }
  return { ok: regressions.length === 0, best, current: current.metrics, regressions, samples: history.length }
}
// ── co-change analysis ──────────────────────────────────────────────────────
//
// The measurement that decides whether a boundary is drawn in the right place.
// Size is a proxy; what actually matters is which parts tend to change together.
// Two modules that move in the same commit most of the time are one module with
// a wall through it, and splitting them into separate services turns every
// ordinary change into a coordinated release.

const SENTINEL = '@@@'

export function coChange (catalog, { limit = 500, minPairs = 3, ratio = 0.5, maxModulesPerCommit = 8 } = {}) {
  const r = git(['-c', 'core.quotePath=false', 'log', '-n', String(limit), '--no-merges',
    '--name-only', '--pretty=format:' + SENTINEL + '%H'])
  if (!r.ok) return { ok: false, degraded: true, reason: 'git log unavailable; a history is required to measure coupling' }

  const commits = []
  let current = null
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith(SENTINEL)) { current = { sha: line.slice(SENTINEL.length), paths: [] }; commits.push(current); continue }
    const p = line.trim()
    if (p && current) current.paths.push(p)
  }

  const byId = new Map((catalog.modules || []).map(m => [m.id, m]))
  const solo = new Map()
  const pairs = new Map()
  let analysed = 0
  let sweeping = 0

  for (const c of commits) {
    const mods = [...new Set(c.paths.map(p => classifyPath(catalog, p)).filter(x => x.kind === 'module').map(x => x.moduleId))].sort()
    if (mods.length === 0) continue
    // A release or a repository-wide reformat touches everything and says nothing
    // about coupling. Excluding it is reported, never silent.
    if (mods.length > maxModulesPerCommit) { sweeping++; continue }
    analysed++
    for (const m of mods) solo.set(m, (solo.get(m) || 0) + 1)
    for (let i = 0; i < mods.length; i++) {
      for (let j = i + 1; j < mods.length; j++) {
        const key = mods[i] + '|' + mods[j]
        pairs.set(key, (pairs.get(key) || 0) + 1)
      }
    }
  }

  const declared = (a, b) => {
    const ma = byId.get(a), mb = byId.get(b)
    return !!((ma && (ma.dependsOn || []).includes(b)) || (mb && (mb.dependsOn || []).includes(a)))
  }

  const rows = []
  for (const [key, count] of pairs) {
    const [a, b] = key.split('|')
    const denom = Math.min(solo.get(a) || 1, solo.get(b) || 1)
    const coupling = denom ? count / denom : 0
    rows.push({
      a, b, coChanges: count,
      commitsA: solo.get(a) || 0,
      commitsB: solo.get(b) || 0,
      coupling: Number(coupling.toFixed(3)),
      declaredEdge: declared(a, b),
      layerA: (byId.get(a) || {}).layer || null,
      layerB: (byId.get(b) || {}).layer || null,
    })
  }
  rows.sort((x, y) => y.coupling - x.coupling || y.coChanges - x.coChanges)

  // Accepting a coupling is a recorded decision, exactly like opting an attribute
  // out of governance: it carries a written reason and stays visible as a warning.
  const accepted = new Map()
  for (const entry of (catalog.cochange && catalog.cochange.accepted) || []) {
    if (!entry || entry.length < 2) continue
    accepted.set([entry[0], entry[1]].sort().join('|'), entry[2] || '(no reason recorded)')
  }

  const findings = []
  const minSample = (catalog.cochange && catalog.cochange.minSample) || 30
  if (analysed < minSample) {
    findings.push({
      severity: 'warning',
      code: 'LOW_CONFIDENCE',
      message: 'only ' + analysed + ' commit(s) carried module changes, below the ' + minSample +
        ' needed to conclude anything about coupling; treat every result below as a hint, not a measurement',
    })
  }
  for (const row of rows) {
    if (row.coChanges < minPairs || row.coupling < ratio) continue
    const key = [row.a, row.b].sort().join('|')
    if (accepted.has(key)) {
      findings.push({
        severity: 'warning',
        code: 'ACCEPTED_COUPLING',
        pair: [row.a, row.b],
        coupling: row.coupling,
        coChanges: row.coChanges,
        message: row.a + ' and ' + row.b + ' are ' + Math.round(row.coupling * 100) + ' % coupled, accepted: ' + accepted.get(key),
      })
      continue
    }
    findings.push({
      severity: row.declaredEdge ? 'warning' : 'error',
      code: row.declaredEdge ? 'HIGH_COUPLING' : 'BOUNDARY_SUSPECT',
      pair: [row.a, row.b],
      coupling: row.coupling,
      coChanges: row.coChanges,
      message: row.a + ' and ' + row.b + ' changed together in ' + row.coChanges + ' of ' + Math.min(row.commitsA, row.commitsB) +
        ' commits (' + Math.round(row.coupling * 100) + ' %)' +
        (row.declaredEdge
          ? '; the dependency is declared, but this level of coupling means they cannot be released independently'
          : '; there is no declared dependency between them, so the boundary is either wrong or the graph is incomplete'),
    })
  }

  const isolated = (catalog.modules || [])
    .filter(m => (solo.get(m.id) || 0) >= minPairs)
    .filter(m => ![...pairs.keys()].some(k => k.split('|').includes(m.id)))
    .map(m => m.id)

  const errors = findings.filter(f => f.severity === 'error')
  return {
    ok: errors.length === 0,
    commits: commits.length,
    analysed,
    sweeping,
    modules: solo.size,
    top: rows.slice(0, 20),
    findings,
    isolatedModules: isolated,
    counts: { error: errors.length, warning: findings.length - errors.length },
    advice: isolated.length
      ? 'Modules that never co-change with anything are the safest candidates to extract into their own repository: ' + isolated.join(', ')
      : 'No module is fully independent in this window; extracting any of them costs a coordinated release.',
  }
}
// ── catalog discovery ───────────────────────────────────────────────────────
//
// Asking a human to hand-write a module map is asking them to transcribe facts
// the repository already contains. Directory structure, real import edges and
// build manifests are readable; so the engine reads them and proposes a complete
// draft, and the human's job becomes correcting a proposal rather than authoring
// a blank one.
//
// What it must NOT do is decide consequences. A guessed riskTier or a guessed
// security attribute is worse than an absent one: too high and the gate blocks
// arbitrarily, too low and the gate is theatre. Those fields are emitted as
// explicit proposals that catalog-lint refuses until a human confirms them.

const SOURCE_ROOTS = ['src', 'lib', 'app', 'apps', 'packages', 'services', 'internal', 'cmd', 'pkg', 'modules', 'components']
const NON_SOURCE = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'coverage', '.git', '.dsh', '.github', '.venv', 'venv', '__pycache__'])

const GLOBAL_CANDIDATES = [
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'tsconfig.json',
  'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'pyproject.toml', 'poetry.lock',
  'requirements.txt', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Makefile',
  'Dockerfile', 'docker-compose.yml', '.gitignore', '.gitattributes', '.editorconfig',
]
// Entries marked `always` are emitted whether or not the path exists yet: the
// scaffold's own footprint appears the moment governance is enabled, and a draft
// that does not classify it leaves the very file it just wrote unmapped.
const IGNORE_CANDIDATES = [
  // Listed as subtrees, never as a blanket .dsh/**: `ignored` outranks `global`,
  // so a blanket entry would shadow the catalog's own global classification and a
  // change to the rules would stop fanning out to every module.
  { path: '.dsh/skills/**', reason: 'vendored doctrine; governed by skills-lint', always: true },
  { path: '.dsh/docs/**', reason: 'vendored reference manual', always: true },
  { path: '.dsh/templates/**', reason: 'vendored document skeletons', always: true },
  { path: '.dsh/workflows/**', reason: 'vendored fan-out scripts', always: true },
  { path: '.dsh/base/lib/**', reason: 'vendored governance engine', always: true },
  { path: '.dsh/base/audit/**', reason: 'vendored audit scripts', always: true },
  { path: '.dsh/base/githooks/**', reason: 'vendored enforcement hooks', always: true },
  { path: '.dsh/base/dsb.mjs', reason: 'vendored engine entry point', always: true },
  { path: '.dsh/base/install.mjs', reason: 'vendored installer', always: true },
  { path: '.dsh/base/AGENTS.md', reason: 'vendored engine directory contract', always: true },
  { path: '.dsh/base/.gitignore', reason: 'vendored runtime-state ignore policy', always: true },
  { path: '.dsh/base/adapters.json', reason: 'vendored external-tool reference table', always: true },
  { path: '.dsh/base/catalog.example.json', reason: 'vendored adoption template', always: true },
  { path: '.dsh/base/cordis.patch.yml', reason: 'vendored optional profile patch', always: true },
  { path: '.dsh/base/trend/**', reason: 'architecture-debt ledger; an append-only measurement, not source', always: true },
  { path: 'progress.md', reason: 'project memory; mutated every session and would fan out every gate', always: true },
  { path: 'progress.archive.md', reason: 'archived project memory', always: true },
  { path: 'AGENTS.md', reason: 'project constitution; the harness injects it, it changes no product behaviour', always: true },
  { path: 'README.md', reason: 'human-facing entry point; changes no behaviour' },
  { path: 'CHANGELOG.md', reason: 'release narrative; not an input to any check' },
  { path: 'LICENSE', reason: 'legal text; changed only by an explicit human decision' },
  { path: 'docs/**', reason: 'prose; governed by spec-lint and adr-check rather than by impact' },
  { path: '.github/**', reason: 'CI definitions; reviewed as configuration' },
]

/** Read the build manifests and report the commands this project actually has. */
export function detectCommands () {
  const found = []
  const pkgRaw = readText('package.json', null)
  if (pkgRaw) {
    let pkg = null
    try { pkg = JSON.parse(pkgRaw) } catch { pkg = null }
    const scripts = (pkg && pkg.scripts) || {}
    const runner = exists('pnpm-lock.yaml') ? 'pnpm' : exists('yarn.lock') ? 'yarn' : 'npm run'
    for (const [id, names] of [['unit', ['test', 'tests', 'jest', 'vitest']], ['lint', ['lint', 'eslint']], ['types', ['typecheck', 'tsc', 'types']], ['build', ['build', 'compile']]]) {
      const hit = names.find(n => scripts[n])
      if (hit) found.push({ id, command: runner + ' ' + hit, source: 'package.json scripts.' + hit })
    }
    if (found.length === 0) found.push({ id: 'unit', command: 'node --test', source: 'package.json with no test script; node built-in runner assumed' })
  }
  if (exists('pyproject.toml') || exists('pytest.ini') || exists('setup.cfg')) {
    found.push({ id: 'unit', command: 'pytest -q', source: 'python project layout' })
    found.push({ id: 'lint', command: 'ruff check .', source: 'python project layout (ruff is a common choice; replace if you use another)' })
  }
  if (exists('go.mod')) {
    found.push({ id: 'unit', command: 'go test ./...', source: 'go.mod' })
    found.push({ id: 'lint', command: 'go vet ./...', source: 'go.mod' })
  }
  if (exists('Cargo.toml')) {
    found.push({ id: 'unit', command: 'cargo test', source: 'Cargo.toml' })
    found.push({ id: 'lint', command: 'cargo clippy -- -D warnings', source: 'Cargo.toml' })
  }
  if (exists('Makefile')) {
    const mk = readText('Makefile', '')
    for (const t of ['test', 'lint', 'build']) {
      if (new RegExp('^' + t + ':', 'm').test(mk)) found.push({ id: t === 'test' ? 'unit' : t, command: 'make ' + t, source: 'Makefile target ' + t })
    }
  }
  const seen = new Set()
  return found.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)))
}

/** Group tracked paths into candidate modules by their source directory. */
function proposeModules (paths, depth) {
  const groups = new Map()
  for (const p of paths) {
    const parts = p.split('/')
    if (NON_SOURCE.has(parts[0])) continue
    if (parts.length < 2) continue
    let prefix = null
    if (SOURCE_ROOTS.includes(parts[0]) && parts.length > 2) {
      prefix = parts.slice(0, Math.min(depth + 1, parts.length - 1)).join('/')
    } else if (SOURCE_ROOTS.includes(parts[0])) {
      prefix = parts[0]
    } else if (parts.length > 2 && !parts[0].startsWith('.')) {
      prefix = parts.slice(0, Math.min(depth, parts.length - 1)).join('/')
    }
    if (!prefix) continue
    if (!groups.has(prefix)) groups.set(prefix, [])
    groups.get(prefix).push(p)
  }
  // A group with a single file is not a module; it is a file.
  const grouped = [...groups.entries()]
    .filter(([, files]) => files.length >= 2)
    .map(([prefix, files]) => ({
      id: prefix.split('/').filter(s => !SOURCE_ROOTS.includes(s)).join('-') || prefix.replace(/\//g, '-'),
      paths: [prefix + '/**'],
      files,
    }))

  // Fallback: any remaining top-level directory holding real files is a module
  // too. Without this the draft leaves paths unmapped, and an unmapped path
  // escapes every targeted gate - the exact failure catalog-lint exists to catch.
  const covered = new Set(grouped.flatMap(g => g.files))
  const rest = new Map()
  for (const p of paths) {
    if (covered.has(p)) continue
    const parts = p.split('/')
    if (parts.length < 2) continue
    if (NON_SOURCE.has(parts[0])) continue
    if (!rest.has(parts[0])) rest.set(parts[0], [])
    rest.get(parts[0]).push(p)
  }
  for (const [dir, files] of rest) {
    grouped.push({ id: dir.replace(/^\./, '').replace(/\//g, '-'), paths: [dir + '/**'], files })
  }
  return grouped
}

// Signals that a module handles something whose failure has consequences. These
// are PROPOSALS with evidence, never decisions: a guessed tier is worse than an
// absent one, because it is believed.
const ATTRIBUTE_SIGNALS = [
  { attribute: 'security', tier: 'high', re: /\b(auth|authn|authz|jwt|oauth|token|password|passwd|credential|secret|crypto|cipher|permission|rbac|acl|session|signin|login)\b/i },
  { attribute: 'privacy', tier: 'high', re: /\b(email|phone|mobile|address|birthday|birthdate|ssn|passport|id_card|idcard|personal|gdpr|consent|pii|subject_?rights)\b/i },
  { attribute: 'safety', tier: 'high', re: /\b(actuator|motor|valve|relay|dispense|dose|throttle|brake|servo|emergency_?stop|interlock|watchdog)\b/i },
  { attribute: 'reliability', tier: 'high', re: /\b(transaction|idempoten|exactly_?once|consistency|reconcil|ledger|balance)\b/i },
  { attribute: 'resilience', tier: 'high', re: /\b(circuit_?break|backoff|jitter|bulkhead|fallback|degrade|rate_?limit|throttl)\b/i },
  { attribute: 'security', tier: 'critical', re: /\b(payment|invoice|charge|refund|billing|payout|settlement)\b/i },
]

// Attributes describe what PRODUCTION code does. A specification that discusses
// personal data and a test fixture that mentions billing are talking about the
// subject, not doing it. Matching them produced proposals like "tests is
// security-critical because a fixture says billing", and a proposal system whose
// output is noise teaches its user to ignore every proposal, including the true
// ones. So: source files only, and never a blocking tier from one keyword.
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.mts', '.cts', '.py', '.go',
  '.rs', '.java', '.kt', '.cs', '.rb', '.php', '.swift', '.scala', '.c', '.h', '.cc', '.cpp', '.sql'])
const NON_PRODUCTION = /(^|\/)(tests?|__tests__|spec|fixtures?|mocks?|examples?|docs?)(\/|$)|\.(test|spec)\.[a-z]+$/i

/**
 * Propose attributes from observable signals in production source, each carrying
 * its evidence. A proposal is never a decision: the tier is capped at "high" and
 * a single weak signal is reported with its confidence rather than asserted.
 */
export function proposeAttributes (modules, { maxFilesPerModule = 300, maxBytes = 200000 } = {}) {
  const proposals = {}
  for (const m of modules) {
    const hits = {}
    for (const f of m.files.slice(0, maxFilesPerModule)) {
      if (!CODE_EXT.has(path.extname(f).toLowerCase())) continue
      if (NON_PRODUCTION.test(f)) continue
      if (SCAN_SKIP_DISCOVERY.has(path.extname(f).toLowerCase())) continue
      let text
      try {
        const st = fs.statSync(abs(f))
        if (st.size > maxBytes) continue
        text = fs.readFileSync(abs(f), 'utf8')
      } catch { continue }
      if (text.indexOf('\u0000') >= 0) continue
      const haystack = f + '\n' + text.slice(0, 20000)
      for (const sig of ATTRIBUTE_SIGNALS) {
        const match = sig.re.exec(haystack)
        if (!match) continue
        const key = sig.attribute
        if (!hits[key]) hits[key] = { files: new Set(), terms: new Set(), evidence: [] }
        hits[key].files.add(f)
        hits[key].terms.add(match[0].toLowerCase())
        if (hits[key].evidence.length < 3) hits[key].evidence.push(f + ': ' + match[0])
      }
    }
    const kept = {}
    for (const [attr, h] of Object.entries(hits)) {
      // One term in one file is a hint, not a signal. Two independent files or
      // two distinct terms make it worth a human's attention.
      const strong = h.files.size >= 2 || h.terms.size >= 2
      if (!strong) continue
      kept[attr] = {
        proposedTier: 'high',
        confidence: h.files.size >= 3 && h.terms.size >= 2 ? 'medium' : 'low',
        files: h.files.size,
        terms: [...h.terms],
        evidence: h.evidence,
        note: 'a keyword match is a reason to look, never a decision. Confirm the tier from what a failure here would cost.',
      }
    }
    if (Object.keys(kept).length) proposals[m.id] = kept
  }
  return proposals
}

const SCAN_SKIP_DISCOVERY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz',
  '.woff', '.woff2', '.ttf', '.mp4', '.bin', '.exe', '.dll', '.lock', '.map', '.snap'])

/**
 * Propose a complete catalog from what the repository already contains.
 * Every field the engine cannot honestly derive is emitted under
 * \`needsDecision\` rather than guessed.
 */
export function discoverCatalog ({ depth = 2 } = {}) {
  const t = trackedFiles(200000)
  if (!t.available) return { ok: false, degraded: true, reason: 'not a git repository; the file set cannot be established' }
  if (t.paths.length === 0) return { ok: false, degraded: true, reason: 'no tracked files; commit the project before discovering its structure' }

  const modules = proposeModules(t.paths, depth)
  if (modules.length === 0) {
    return {
      ok: false, degraded: true,
      reason: 'no directory holds two or more tracked source files, so no module can be proposed. Write some code first, or pass --depth 1.',
    }
  }

  // Real import edges between the proposed modules decide dependsOn, so the draft
  // graph matches the code from the first run rather than after the first drift.
  const probe = { modules: modules.map(m => ({ id: m.id, paths: m.paths })), maxTrackedPaths: 200000, layers: [], global: [], ignored: [] }
  const arch = archCheck(probe, { paths: t.paths, useCache: false })
  const deps = new Map(modules.map(m => [m.id, new Set()]))
  for (const e of arch.undeclared) deps.get(e.from) && deps.get(e.from).add(e.to)

  // Layers follow the longest path through the proposed graph. The names are
  // positional on purpose: inventing "domain" or "infra" would read as a finding
  // rather than as the guess it is.
  const level = new Map()
  const depthOf = (id, seen = new Set()) => {
    if (level.has(id)) return level.get(id)
    if (seen.has(id)) return 0
    seen.add(id)
    const d = [...(deps.get(id) || [])].reduce((mx, n) => Math.max(mx, depthOf(n, seen) + 1), 0)
    level.set(id, d)
    return d
  }
  for (const m of modules) depthOf(m.id)
  const maxLevel = Math.max(0, ...[...level.values()])
  const layers = []
  for (let i = maxLevel; i >= 0; i--) layers.push('tier-' + (maxLevel - i + 1))

  const commands = detectCommands()
  const checks = {}
  for (const c of commands) {
    checks[c.id] = {
      command: c.command,
      class: c.id === 'unit' ? 'test' : c.id === 'lint' ? 'lint' : 'build',
      attributes: c.id === 'unit' ? ['reliability'] : ['maintainability'],
    }
  }

  const covered = new Set()
  for (const m of modules) for (const f of m.files) covered.add(f)
  // A catalog change rewrites the rules, so it must fan out to every module. It
  // is listed even before it exists, because it exists the moment this is saved.
  const globals = GLOBAL_CANDIDATES.filter(g => t.paths.includes(g))
  if (!globals.includes('.dsh/base/catalog.json')) globals.push('.dsh/base/catalog.json')
  const ignored = IGNORE_CANDIDATES
    .filter(e => e.always || (e.path.includes('*') ? t.paths.some(p => p.startsWith(e.path.split('*')[0])) : t.paths.includes(e.path)))
    .map(e => ({ path: e.path, reason: e.reason }))
  let stillUnmapped = t.paths.filter(p =>
    !covered.has(p) && !globals.includes(p) &&
    !ignored.some(e => (e.path.includes('*') ? p.startsWith(e.path.split('*')[0]) : p === e.path)))

  // A root-level file nothing claimed becomes global: a change to it fans out to
  // every module. Over-testing is cheap; an unmapped path escapes every gate.
  for (const p of stillUnmapped.filter(x => !x.includes('/'))) {
    if (!globals.includes(p)) globals.push(p)
  }
  stillUnmapped = stillUnmapped.filter(p => p.includes('/'))

  const draft = {
    version: 1,
    project: { name: path.basename(ROOT), scaleTier: modules.length > 40 ? 'L' : modules.length > 10 ? 'M' : 'S' },
    maxTrackedPaths: 200000,
    layers,
    global: globals,
    ignored,
    riskChecks: {
      low: commands.filter(c => c.id === 'lint').map(c => c.id),
      medium: commands.map(c => c.id).filter(id => id === 'lint' || id === 'unit'),
      high: commands.map(c => c.id),
      critical: commands.map(c => c.id),
    },
    checks,
    contextPack: { maxTotalChars: 120000, maxFiles: 40, maxFileChars: 6000, maxDiffChars: 40000 },
    budget: { maxChangedFiles: 40, maxChangedLines: 1500, maxModulesTouched: 3, maxNewFiles: 25 },
    trace: { requirementDirs: ['docs/requirements'], testGlobs: ['**/test/**', '**/tests/**', '**/*.test.*', '**/*_test.*', '**/*.spec.*'], minCoverage: 1 },
    adr: { dir: 'docs/adr' },
    agentsMd: { requireForRiskTiers: ['high', 'critical'], maxBytes: 12000 },
    memory: { ledger: 'progress.md', archive: 'progress.archive.md', maxLedgerBytes: 24000, keepDone: 40, keepNotes: 30, recapBudget: 6000 },
    modules: modules.map(m => ({
      id: m.id,
      paths: m.paths,
      layer: 'tier-' + (maxLevel - (level.get(m.id) || 0) + 1),
      riskTier: 'medium',
      dependsOn: [...(deps.get(m.id) || [])].sort(),
    })),
  }

  const needsDecision = [
    { field: 'modules[].riskTier', why: 'every module was proposed as "medium". A tier is a statement about what a failure here costs, which cannot be read from the code.' },
    { field: 'modules[].attributes', why: 'no quality attribute was assigned. Guessing "security: critical" would block the gate arbitrarily; guessing "low" would make it theatre. Declare them where they matter, starting with the modules that handle credentials, personal data, money or physical actuation.' },
    { field: 'modules[].forbiddenDependencies', why: 'no edge was forbidden. A prohibition is a commitment about what must never happen, not an observation about what has not happened yet.' },
    { field: 'layers', why: 'layers were named positionally (tier-1 outermost). Rename them to your own vocabulary and confirm the direction is the one you intend.' },
    { field: 'project.name', why: 'taken from the directory name.' },
  ]
  if (commands.length === 0) {
    needsDecision.unshift({ field: 'checks', why: 'no build manifest was recognised, so no check command could be detected. Until a check exists, every gate reports BLOCKED, which is correct: nothing ran.' })
  }

  return {
    ok: true,
    draft,
    attributeProposals: proposeAttributes(modules),
    trackedPaths: t.paths.length,
    proposedModules: modules.length,
    detectedCommands: commands,
    realEdges: arch.undeclared.length,
    unresolvedSpecifiers: arch.unresolved,
    stillUnmapped: stillUnmapped.slice(0, 50),
    stillUnmappedCount: stillUnmapped.length,
    needsDecision,
  }
}
