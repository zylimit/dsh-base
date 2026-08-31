// deepseek-base :: catalog lint, impact closure, architecture guard, drift ratchet.
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
  trackedFiles, readText, rel, abs, writeJsonAtomic, readJson, nowIso,
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

export function recordTrend (result) {
  const p = TREND_PATH()
  const entry = {
    at: nowIso(),
    metrics: Object.fromEntries(RATCHET_METRICS.map(k => [k, result.metrics[k] || 0])),
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
  return raw.split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

/**
 * The ratchet turns one way only: historical debt is tolerated, new debt is not.
 * The gate fails when the newest measurement exceeds the best ever recorded.
 */
export function trendGate (current, history = readTrend()) {
  if (history.length === 0) {
    return { ok: true, baseline: true, reason: 'no baseline recorded yet; run "dsb arch-check --record" first' }
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
