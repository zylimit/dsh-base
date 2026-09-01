// deepseek-base :: the fleet layer.
//
// One repository per service, each small enough that a single agent holds its
// whole model, is a good answer to context. It is not a free one: the complexity
// does not vanish, it moves from file-to-file dependencies to repo-to-repo
// contracts. That surface is where distributed monoliths are born, and nothing
// in a single repository can see it.
//
// This module governs that surface with the same rules the single-repo engine
// uses: an explicit declared graph, a measured reality, and a refusal to report
// a clean result when it measured nothing.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { readJson, readText, exists, nowIso } from './core.mjs'

export const FLEET_FILE = 'fleet.json'

const CONTRACT_KINDS = ['http', 'grpc', 'event', 'schema', 'library', 'file', 'other']
const CONTRACT_STATUS = ['active', 'deprecated', 'retired']

/**
 * Locate the fleet manifest: an explicit path, the DSB_FLEET environment, or the
 * nearest ancestor of the working directory that carries one.
 */
export function findFleet (start = process.cwd(), explicit = null) {
  const candidate = explicit || process.env.DSB_FLEET || null
  if (candidate) {
    const p = path.resolve(candidate)
    const file = p.endsWith('.json') ? p : path.join(p, FLEET_FILE)
    return fs.existsSync(file) ? file : null
  }
  let dir = path.resolve(start)
  for (;;) {
    const file = path.join(dir, FLEET_FILE)
    if (fs.existsSync(file)) return file
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function loadFleet (start = process.cwd(), explicit = null) {
  const file = findFleet(start, explicit)
  if (!file) return { present: false, file: null, fleet: null }
  const fleet = readJson(path.relative(process.cwd(), file) || file, undefined)
  const parsed = fleet === undefined ? null : fleet
  if (parsed === null) {
    let raw = null
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { raw = null }
    if (raw === null) return { present: true, file, fleet: null, parseError: 'fleet.json is not valid JSON' }
    return { present: true, file, fleet: raw, root: path.dirname(file) }
  }
  return { present: true, file, fleet: parsed, root: path.dirname(file) }
}

const repoPath = (fleetRoot, repo) => path.resolve(fleetRoot, repo.path || repo.id)

/** Every contract id a repository publishes, with its declared versions. */
function providerIndex (fleet) {
  const index = new Map()
  for (const repo of fleet.repos || []) {
    for (const p of repo.provides || []) {
      if (!p || !p.contract) continue
      if (!index.has(p.contract)) index.set(p.contract, [])
      index.get(p.contract).push({ repo: repo.id, ...p })
    }
  }
  return index
}

/** A consumed version selector matches an offered version. */
function versionMatches (offered, wanted) {
  if (!wanted || wanted === '*' || wanted === 'any') return true
  if (offered === wanted) return true
  // "2.x" and "2" accept any 2.* offering. Nothing cleverer: a fleet manifest is
  // a declaration, and a resolver that guesses would hide a real mismatch.
  const w = String(wanted).replace(/\.x$/i, '')
  return String(offered) === w || String(offered).startsWith(w + '.')
}

// ── lint ────────────────────────────────────────────────────────────────────

export function fleetLint (state) {
  const fleet = state.fleet
  const findings = []
  const add = (severity, code, message, extra = {}) => findings.push({ severity, code, message, ...extra })

  if (!Array.isArray(fleet.repos) || fleet.repos.length === 0) {
    add('error', 'NO_REPOS', 'the fleet declares no repositories; there is nothing to govern')
    return { ok: false, findings, counts: { error: 1, warning: 0, repos: 0, contracts: 0 } }
  }

  const ids = new Set()
  for (const repo of fleet.repos) {
    if (!repo.id) { add('error', 'REPO_ID_MISSING', 'a repository entry has no id'); continue }
    if (ids.has(repo.id)) add('error', 'DUPLICATE_REPO', 'duplicate repository id "' + repo.id + '"', { repo: repo.id })
    ids.add(repo.id)
    if (!Array.isArray(repo.owners) || repo.owners.length === 0) {
      add('warning', 'NO_OWNER', 'repository "' + repo.id + '" declares no owners; a contract without an owner has no one to negotiate its change', { repo: repo.id })
    }
    const p = repoPath(state.root, repo)
    if (!fs.existsSync(p)) {
      add('error', 'REPO_MISSING', 'repository "' + repo.id + '" is declared at ' + repo.path + ' but that path does not exist', { repo: repo.id })
    } else if (!fs.existsSync(path.join(p, '.git'))) {
      add('warning', 'REPO_NOT_GIT', 'repository "' + repo.id + '" is not a git worktree; its own governance will degrade', { repo: repo.id })
    }
    for (const c of repo.provides || []) {
      if (!c.contract) { add('error', 'CONTRACT_ID_MISSING', 'repository "' + repo.id + '" provides a contract with no id', { repo: repo.id }); continue }
      if (!c.version) add('error', 'CONTRACT_NO_VERSION', 'contract "' + c.contract + '" in "' + repo.id + '" declares no version', { repo: repo.id })
      if (c.kind && !CONTRACT_KINDS.includes(c.kind)) add('error', 'UNKNOWN_CONTRACT_KIND', 'contract "' + c.contract + '" has unknown kind "' + c.kind + '"', { repo: repo.id })
      if (c.status && !CONTRACT_STATUS.includes(c.status)) add('error', 'UNKNOWN_CONTRACT_STATUS', 'contract "' + c.contract + '" has unknown status "' + c.status + '"', { repo: repo.id })
      if (c.status === 'deprecated' && !c.sunset) {
        add('error', 'DEPRECATED_WITHOUT_SUNSET', 'contract "' + c.contract + '@' + c.version + '" is deprecated with no sunset date; a deprecation nobody has to act on is permanent', { repo: repo.id })
      }
      if (!c.adr && c.status !== 'retired') {
        add('warning', 'CONTRACT_WITHOUT_ADR', 'contract "' + c.contract + '@' + c.version + '" names no ADR; a published contract is an architectural commitment', { repo: repo.id })
      }
    }
  }

  const providers = providerIndex(fleet)
  for (const [contract, list] of providers) {
    const owners = new Set(list.map(l => l.repo))
    if (owners.size > 1) {
      add('error', 'CONTRACT_MULTIPLE_OWNERS', 'contract "' + contract + '" is provided by ' + [...owners].join(', ') + '; ownership must be unambiguous', { contract })
    }
  }

  const consumedBy = new Map()
  for (const repo of fleet.repos) {
    for (const c of repo.consumes || []) {
      if (!c || !c.contract) { add('error', 'CONSUME_ID_MISSING', 'repository "' + repo.id + '" consumes a contract with no id', { repo: repo.id }); continue }
      if (!consumedBy.has(c.contract)) consumedBy.set(c.contract, [])
      consumedBy.get(c.contract).push({ repo: repo.id, version: c.version })

      const offers = providers.get(c.contract)
      if (!offers) {
        if (c.external) continue
        add('error', 'DANGLING_CONSUME', 'repository "' + repo.id + '" consumes "' + c.contract + '" which no repository in this fleet provides; declare the provider, or mark the entry external', { repo: repo.id, contract: c.contract })
        continue
      }
      const match = offers.find(o => versionMatches(o.version, c.version))
      if (!match) {
        add('error', 'UNPROVIDED_VERSION', 'repository "' + repo.id + '" consumes "' + c.contract + '@' + (c.version || 'any') + '" but the provider offers only ' + offers.map(o => o.version).join(', '), { repo: repo.id, contract: c.contract })
        continue
      }
      if (match.status === 'retired') {
        add('error', 'CONSUMING_RETIRED', 'repository "' + repo.id + '" consumes retired "' + c.contract + '@' + match.version + '"', { repo: repo.id, contract: c.contract })
      } else if (match.status === 'deprecated') {
        const past = match.sunset && new Date(match.sunset) < new Date()
        add(past ? 'error' : 'warning', past ? 'SUNSET_PASSED' : 'CONSUMING_DEPRECATED',
          'repository "' + repo.id + '" consumes deprecated "' + c.contract + '@' + match.version + '"' +
          (match.sunset ? ' (sunset ' + match.sunset + (past ? ', already passed' : '') + ')' : ''),
          { repo: repo.id, contract: c.contract })
      }
    }
  }

  for (const [contract, list] of providers) {
    if (!consumedBy.has(contract) && !list.some(l => l.external || l.public)) {
      add('warning', 'ORPHAN_CONTRACT', 'contract "' + contract + '" is provided by "' + list[0].repo + '" and consumed by nobody in this fleet; retire it or mark it public', { contract })
    }
  }

  // A cycle in the contract graph is the signature of a distributed monolith:
  // the services cannot be released independently, which was the whole point.
  const cycles = contractCycles(fleet)
  for (const c of cycles) {
    add('warning', 'CONTRACT_CYCLE', 'contract cycle across repositories: ' + c.join(' -> ') + '; these repositories cannot be released independently')
  }

  const errors = findings.filter(f => f.severity === 'error')
  return {
    ok: errors.length === 0,
    findings,
    counts: {
      error: errors.length,
      warning: findings.length - errors.length,
      repos: fleet.repos.length,
      contracts: providers.size,
      cycles: cycles.length,
    },
  }
}

export function contractCycles (fleet) {
  const providers = providerIndex(fleet)
  const edges = new Map()
  for (const repo of fleet.repos || []) {
    const to = new Set()
    for (const c of repo.consumes || []) {
      const offers = providers.get(c.contract)
      if (!offers) continue
      for (const o of offers) if (o.repo !== repo.id) to.add(o.repo)
    }
    edges.set(repo.id, [...to])
  }
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
    for (const n of edges.get(id) || []) if (edges.has(n)) visit(n)
    stack.pop(); state.set(id, 2)
  }
  for (const id of edges.keys()) visit(id)
  return cycles
}

// ── impact ──────────────────────────────────────────────────────────────────

/**
 * Which repositories a contract change reaches.
 *
 * Direct consumers first, then the transitive closure through the contracts
 * those consumers themselves publish: a breaking change to a low-level contract
 * surfaces at the edge, and the coordination cost is the size of this set.
 */
export function fleetImpact (state, contractId) {
  const fleet = state.fleet
  const providers = providerIndex(fleet)
  const offers = providers.get(contractId)
  if (!offers) {
    return { ok: false, degraded: true, reason: 'no repository in this fleet provides "' + contractId + '"', known: [...providers.keys()].sort() }
  }

  const byRepo = new Map((fleet.repos || []).map(r => [r.id, r]))
  const consumersOf = (contract) => (fleet.repos || [])
    .filter(r => (r.consumes || []).some(c => c.contract === contract))
    .map(r => r.id)

  const direct = consumersOf(contractId)
  const reached = new Set(direct)
  const queue = [...direct]
  const chain = []
  while (queue.length) {
    const id = queue.shift()
    const repo = byRepo.get(id)
    if (!repo) continue
    for (const p of repo.provides || []) {
      for (const next of consumersOf(p.contract)) {
        if (reached.has(next)) continue
        reached.add(next)
        queue.push(next)
        chain.push({ via: p.contract, from: id, to: next })
      }
    }
  }

  const owner = offers[0].repo
  return {
    ok: true,
    contract: contractId,
    provider: owner,
    versions: offers.map(o => ({ version: o.version, status: o.status || 'active', sunset: o.sunset || null })),
    directConsumers: direct.sort(),
    transitiveConsumers: [...reached].filter(r => !direct.includes(r)).sort(),
    affectedRepos: [owner, ...[...reached]].filter((v, i, a) => a.indexOf(v) === i).sort(),
    propagation: chain,
    coordinationCost: reached.size + 1,
    advice: reached.size === 0
      ? 'no consumer in this fleet; the change is local to ' + owner
      : 'a breaking change here is a coordinated release across ' + (reached.size + 1) + ' repositories. Publish the new version alongside the old, declare a sunset date, and retire only when every consumer has moved.',
  }
}

// ── status and recap ────────────────────────────────────────────────────────

function runIn (dir, args, timeoutMs = 120000) {
  const engine = path.join(dir, '.dsh', 'base', 'dsb.mjs')
  if (!fs.existsSync(engine)) return { installed: false, code: null, json: null }
  const r = spawnSync(process.execPath, [engine, ...args], {
    cwd: dir, encoding: 'utf8', windowsHide: true, timeout: timeoutMs,
    env: { ...process.env, DSB_ROOT: dir, DSB_BASE: '' },
  })
  let json = null
  const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop()
  if (line) { try { json = JSON.parse(line) } catch { json = null } }
  return { installed: true, code: r.status, json }
}

/** One bounded line per repository: is it governed, healthy, and in step. */
export function fleetStatus (state, { deep = false } = {}) {
  const rows = []
  for (const repo of state.fleet.repos || []) {
    const dir = repoPath(state.root, repo)
    const row = { id: repo.id, path: repo.path, exists: fs.existsSync(dir), installed: false }
    if (!row.exists) { rows.push(row); continue }
    const doc = runIn(dir, ['doctor'])
    row.installed = doc.installed
    if (doc.json) {
      row.governanceEnabled = doc.json.enabled
      row.modules = doc.json.modules
      row.skills = doc.json.skills
      row.doctorFailing = doc.json.failing
      row.ledgerOk = doc.json.ledger && doc.json.ledger.ok
    }
    if (deep && row.installed) {
      const dod = runIn(dir, ['dod'], 600000)
      row.dod = dod.code
      const sync = runIn(dir, ['sync-check'])
      row.syncCheck = sync.code
    }
    rows.push(row)
  }
  const problems = rows.filter(r => !r.exists || !r.installed || r.governanceEnabled === false ||
    (r.doctorFailing && r.doctorFailing.length) || (deep && (r.dod !== 0 || r.syncCheck !== 0)))
  return {
    ok: problems.length === 0,
    repos: rows.length,
    rows,
    problems: problems.map(r => r.id),
    deep,
  }
}

/** The fleet-wide answer to "where are we", one bounded block per repository. */
export function fleetRecap (state, { budget = 8000, perRepo = 700 } = {}) {
  const blocks = []
  let truncated = false
  for (const repo of state.fleet.repos || []) {
    const dir = repoPath(state.root, repo)
    if (!fs.existsSync(dir)) { blocks.push('## ' + repo.id + '\n- MISSING at ' + repo.path); continue }
    const r = runIn(dir, ['recap', '--budget', String(perRepo)])
    if (!r.installed) { blocks.push('## ' + repo.id + '\n- not installed (no .dsh/base/dsb.mjs)'); continue }
    const text = r.json && r.json.text ? r.json.text : '- recap unavailable'
    const position = text.split('\n').filter(l => l.startsWith('- ')).slice(0, 5).join('\n')
    blocks.push('## ' + repo.id + '\n' + (position || '- no memory recorded'))
  }
  let body = '# Fleet recap - ' + nowIso() + '\n\n' + blocks.join('\n\n') + '\n'
  if (body.length > budget) { body = body.slice(0, budget) + '\n\n...[fleet recap truncated at ' + budget + ' chars]\n'; truncated = true }
  return { ok: true, repos: (state.fleet.repos || []).length, chars: body.length, budget, truncated, text: body }
}
