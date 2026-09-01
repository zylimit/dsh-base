// deepseek-base :: static scanners.
//
//   fitness      - zero-dependency anti-pattern rules for the five key attributes
//   adrCheck     - every live decision must name a real enforcement point
//   specLint     - requirement documents must be decidable, not adjectival
//   skillsLint   - .dsh/skills must satisfy the DeepSeek Harness skill contract
//   agentsLint   - nested AGENTS.md coverage: the module contract the harness auto-loads
//   trace        - REQ/NFR -> ADR -> module -> test traceability matrix

import path from 'node:path'
import fs from 'node:fs'
import {
  ATTRIBUTES, classifyPath, trackedFiles, readText, readJson, abs, exists,
  listFiles, matchesAny, DSH_HOME,
} from './core.mjs'

// ════════════════════════════════════════════════════════════════════════════
// fitness
// ════════════════════════════════════════════════════════════════════════════

const SUPPRESS = /dsb-fitness:ignore/

const RULE_DEFS = [
  {
    id: 'no-secret-literal',
    attribute: 'security',
    severity: 'error',
    message: 'Hard-coded credential/key material. Inject secrets at runtime from a managed store.',
    patterns: [
      '(?i)(aws_secret_access_key|api[_-]?key|client[_-]?secret|private[_-]?key|passwd|password|token)\\s*[:=]\\s*["\x27][^"\x27\\s]{8,}["\x27]',
      '-----BEGIN [A-Z ]*PRIVATE KEY-----',
      '(?i)\\bghp_[A-Za-z0-9]{20,}',
      '(?i)\\bsk-[A-Za-z0-9]{20,}',
    ],
    allow: ['(?i)(example|sample|placeholder|dummy|redacted|xxxx|<[^>]+>|process\\.env|os\\.environ|getenv|vault|\\$\\s*\\{)'],
  },
  {
    id: 'no-pii-in-logs',
    attribute: 'privacy',
    severity: 'error',
    message: 'Personal data reaching a log sink. Log a stable pseudonymous id, never the raw identifier.',
    patterns: [
      '(?i)(console\\.(log|info|warn|error)|logger?\\.(debug|info|warn|error)|print|printf|fmt\\.Print|log\\.(Printf|Println))\\s*\\([^)\\n]{0,200}(email|e_mail|phone|mobile|id_card|idcard|ssn|passport|birth|address|full_?name|credit_?card|iban)',
    ],
    allow: ['(?i)(hash|mask|redact|pseudonym|anonym|\\*\\*\\*)'],
  },
  {
    id: 'no-silent-failure',
    attribute: 'reliability',
    severity: 'error',
    message: 'Error swallowed without handling. Either handle it, or propagate it with context.',
    patterns: [
      'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}',
      'catch\\s*\\{\\s*\\}',
      '(?m)^\\s*except[^:]*:\\s*(pass|\\.\\.\\.)\\s*$',
      'if\\s+err\\s*!=\\s*nil\\s*\\{\\s*\\}',
    ],
    allow: ['(?i)(intentional|deliberate|best-effort|dsb-fitness)'],
  },
  {
    id: 'no-unbounded-retry',
    attribute: 'resilience',
    severity: 'warning',
    minimumTier: 'high',
    message: 'Retry without a bound, backoff or jitter. Unbounded retry turns a blip into a self-inflicted outage.',
    patterns: [
      '(?i)while\\s*\\(\\s*true\\s*\\)[^\\n]{0,80}(retry|reconnect|fetch|request|connect)',
      '(?i)for\\s*\\(\\s*;\\s*;\\s*\\)[^\\n]{0,80}(retry|reconnect|request)',
      '(?i)(retry|retries)\\s*[:=]\\s*(Infinity|-1|None|true)\\b',
      '(?i)while\\s+True\\s*:[^\\n]{0,80}(retry|reconnect|request)',
    ],
    allow: ['(?i)(backoff|jitter|max_?attempts|maxRetries|deadline|circuit|budget)'],
  },
  {
    id: 'no-unreferenced-deferral',
    attribute: 'safety',
    severity: 'warning',
    minimumTier: 'high',
    message: 'Deferred work with no tracking anchor. In a safety-relevant module every TODO must name an issue, REQ or ADR.',
    patterns: ['(?i)\\b(todo|fixme|hack|xxx)\\b'],
    allow: ['(?i)(REQ-|NFR-|ADR-|HAZ-|THR-|#\\d+|issue[ /-]?\\d+|[A-Z]{2,}-\\d+)'],
  },
  {
    id: 'no-insecure-transport',
    attribute: 'security',
    severity: 'error',
    message: 'TLS verification disabled or plaintext transport. Confidentiality and integrity are both lost.',
    patterns: [
      '(?i)rejectUnauthorized\\s*:\\s*false',
      '(?i)verify\\s*=\\s*False',
      '(?i)InsecureSkipVerify\\s*:\\s*true',
      '(?i)NODE_TLS_REJECT_UNAUTHORIZED\\s*=\\s*["\x27]?0',
      '(?i)curl[^\\n]{0,60}(\\s-k\\b|--insecure)',
    ],
    allow: ['(?i)(localhost|127\\.0\\.0\\.1|test|fixture|mock)'],
  },
  {
    id: 'no-unsafe-dynamic-exec',
    attribute: 'security',
    severity: 'error',
    message: 'Dynamic execution of interpolated input. This is the classic injection sink.',
    patterns: [
      '(?i)\\beval\\s*\\(',
      '(?i)new\\s+Function\\s*\\(',
      '(?i)os\\.system\\s*\\(',
      '(?i)subprocess\\.[A-Za-z_]+\\([^)\\n]{0,120}shell\\s*=\\s*True',
      '(?i)Runtime\\.getRuntime\\(\\)\\.exec\\s*\\(',
    ],
    allow: ['(?i)(dsb-fitness|sandbox|safe:)'],
  },
  {
    id: 'no-weak-crypto',
    attribute: 'security',
    severity: 'error',
    message: 'Weak primitive where a cryptographic guarantee is expected (MD5/SHA1/DES/RC4, or Math.random for tokens).',
    patterns: [
      '(?i)createHash\\s*\\(\\s*["\x27](md5|sha1)["\x27]',
      '(?i)hashlib\\.(md5|sha1)\\s*\\(',
      '(?i)Math\\.random\\s*\\(\\s*\\)[^\\n]{0,60}(token|secret|key|nonce|salt|password|session)',
    ],
    allow: ['(?i)(checksum|etag|cache|non-?crypto|dedup|fingerprint)'],
  },
  {
    id: 'no-unbounded-resource',
    attribute: 'resilience',
    severity: 'warning',
    minimumTier: 'high',
    message: 'Outbound call without a timeout or size bound. One slow dependency then consumes every worker.',
    patterns: [
      '(?i)\\bfetch\\s*\\([^)\\n]{0,160}\\)',
      '(?i)requests\\.(get|post|put|delete)\\s*\\(',
    ],
    allow: ['(?i)(timeout|signal|deadline|AbortController|WithTimeout)'],
  },
]

const TIER_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'critical']

function compileRules (extra) {
  const defs = extra && extra.replace ? (extra.rules || []) : RULE_DEFS.concat((extra && extra.rules) || [])
  // JavaScript has no inline flag groups, so a leading "(?ims)" prefix is
  // translated into real RegExp flags. An unsupported letter is rejected loudly
  // rather than silently producing a rule that never matches.
  const build = (p) => {
    const m = /^\(\?([a-z]+)\)/.exec(p)
    if (!m) return new RegExp(p)
    const flags = m[1]
    for (const ch of flags) {
      if (!'imsu'.includes(ch)) throw new Error('unsupported inline regex flag "' + ch + '" in fitness pattern: ' + p)
    }
    return new RegExp(p.slice(m[0].length), flags)
  }
  return defs.map(d => ({
    ...d,
    _patterns: (d.patterns || []).map(build),
    _allow: (d.allow || []).map(build),
  }))
}

const SCAN_SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tar', '.7z',
  '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.wav', '.bin', '.exe', '.dll', '.so', '.dylib', '.class', '.jar',
  '.lock', '.snap', '.map'])

export function fitness (catalog, { paths = null, all = false, maxFiles = 5000, maxFindings = 500 } = {}) {
  const extra = readJson('.dsh/base/fitness-rules.json', null)
  const rules = compileRules(extra)
  let files = paths
  if (!files) files = all ? trackedFiles(catalog.maxTrackedPaths).paths : []
  files = files.filter(f => !SCAN_SKIP_EXT.has(path.extname(f).toLowerCase()))
  const scanned = []
  const findings = []
  let truncated = false

  outer:
  for (const f of files.slice(0, maxFiles)) {
    let content
    try {
      const st = fs.statSync(abs(f))
      if (st.size > 1024 * 1024) continue
      content = fs.readFileSync(abs(f), 'utf8')
    } catch { continue }
    if (content.indexOf('\u0000') >= 0) continue
    scanned.push(f)
    const cls = classifyPath(catalog, f)
    const mod = cls.kind === 'module' ? (catalog.modules || []).find(m => m.id === cls.moduleId) : null
    const lines = content.split('\n')

    for (const rule of rules) {
      if (rule.minimumTier) {
        const tier = mod && mod.attributes ? mod.attributes[rule.attribute] : undefined
        if (TIER_ORDER.indexOf(tier || 'none') < TIER_ORDER.indexOf(rule.minimumTier)) continue
      }
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (SUPPRESS.test(line) || (i > 0 && SUPPRESS.test(lines[i - 1]))) continue
        if (!rule._patterns.some(re => re.test(line))) continue
        const window = lines.slice(Math.max(0, i - 2), i + 3).join('\n')
        if (rule._allow.some(re => re.test(window))) continue
        findings.push({
          rule: rule.id,
          attribute: rule.attribute,
          severity: rule.severity,
          file: f,
          line: i + 1,
          module: mod ? mod.id : null,
          excerpt: line.trim().slice(0, 200),
          message: rule.message,
        })
        if (findings.length >= maxFindings) { truncated = true; break outer }
      }
    }
  }

  const errors = findings.filter(f => f.severity === 'error')
  return {
    ok: errors.length === 0,
    scanned: scanned.length,
    truncated,
    findings,
    counts: { error: errors.length, warning: findings.length - errors.length },
    rules: rules.map(r => r.id),
  }
}

export const FITNESS_RULE_IDS = RULE_DEFS.map(r => r.id)

// ════════════════════════════════════════════════════════════════════════════
// ADR enforcement audit
// ════════════════════════════════════════════════════════════════════════════

const RETIRED = /(superseded|deprecated|rejected|withdrawn|retired)/i
const ENGINE_CAPABILITIES = new Set([
  'arch-check', 'arch-trend', 'catalog-lint', 'impact', 'verify', 'gate', 'fitness',
  'attributes', 'receipt', 'waiver', 'budget', 'trace', 'agents-lint', 'skills-lint',
  'spec-lint', 'adr-check', 'context-pack', 'layers', 'forbiddenDependencies',
])
const BACKTICK = String.fromCharCode(96)
const STRIP_FENCE = new RegExp('^[' + BACKTICK + ']+|[' + BACKTICK + ']+$', 'g')

export function adrCheck (catalog) {
  const dir = (catalog.adr && catalog.adr.dir) || 'docs/adr'
  if (!exists(dir)) return { ok: true, adrs: 0, live: 0, manualOnly: 0, reason: 'no ADR directory at ' + dir, findings: [], counts: { error: 0, warning: 0 } }
  const files = listFiles(dir).filter(p => /\.md$/i.test(p) && !/README/i.test(p))
  const fitnessIds = new Set(compileRules(readJson('.dsh/base/fitness-rules.json', null)).map(r => r.id))
  const checkIds = new Set(Object.keys(catalog.checks || {}))
  const findings = []
  let live = 0, manualOnly = 0

  for (const f of files) {
    const text = readText(f, '')
    const idMatch = /ADR-(\d{1,5})/i.exec(text) || /ADR-(\d{1,5})/i.exec(f)
    const id = idMatch ? 'ADR-' + idMatch[1] : path.basename(f)
    const statusMatch = /(?:^|\n)\s*(?:\*\*)?Status(?:\*\*)?\s*[:：]\s*([^\n]+)/i.exec(text)
    const status = statusMatch ? statusMatch[1].trim() : 'unknown'
    if (RETIRED.test(status)) continue
    live++
    const enforcedMatch = /(?:^|\n)\s*(?:\*\*)?Enforced-by(?:\*\*)?\s*[:：]\s*([^\n]+)/i.exec(text)
    if (!enforcedMatch) {
      findings.push({ adr: id, file: f, severity: 'error', code: 'NO_ENFORCEMENT', message: 'live ADR has no "Enforced-by:" line; an unenforced decision drifts by default' })
      continue
    }
    const raw = enforcedMatch[1]
    const tokens = raw.split(/[,;|]/).map(t => t.trim()).filter(Boolean)
    const resolved = []
    const unrecognized = []
    for (const t of tokens) {
      const bare = t.replace(STRIP_FENCE, '').trim()
      if (/^manual\s*[:：]/i.test(bare) || /^(manual|review|人工|评审)$/i.test(bare)) { resolved.push({ token: bare, kind: 'manual' }); continue }
      if (checkIds.has(bare)) { resolved.push({ token: bare, kind: 'check' }); continue }
      if (fitnessIds.has(bare)) { resolved.push({ token: bare, kind: 'fitness' }); continue }
      if (ENGINE_CAPABILITIES.has(bare)) { resolved.push({ token: bare, kind: 'capability' }); continue }
      unrecognized.push(bare)
    }
    if (resolved.length === 0) {
      findings.push({ adr: id, file: f, severity: 'error', code: 'PHANTOM_ENFORCEMENT', unrecognized, message: 'Enforced-by names nothing that exists (' + raw.trim() + '); a phantom reference is worse than none because it reads as enforced' })
    } else {
      if (resolved.every(r => r.kind === 'manual')) manualOnly++
      if (unrecognized.length) {
        findings.push({ adr: id, file: f, severity: 'warning', code: 'UNRECOGNIZED_TOKEN', unrecognized, message: 'unrecognized enforcement token(s): ' + unrecognized.join(', ') })
      }
    }
  }
  const errors = findings.filter(f => f.severity === 'error')
  return { ok: errors.length === 0, adrs: files.length, live, manualOnly, findings, counts: { error: errors.length, warning: findings.length - errors.length } }
}

// ════════════════════════════════════════════════════════════════════════════
// requirement document lint
// ════════════════════════════════════════════════════════════════════════════

const AMBIGUOUS = [
  'user-friendly', 'robust', 'scalable', 'efficient', 'appropriate', 'reasonable',
  'as needed', 'and so on', 'flexible', 'easy to use', 'high performance',
  'best effort', 'if possible', 'as fast as possible',
  '尽快', '友好', '合理', '适当', '良好', '灵活', '易用', '尽可能',
]
const PLACEHOLDERS = ['TBD', 'TODO', 'FIXME', '待补充', '待定', '???']
const NORMATIVE = /(SHALL|MUST|必须|不得|应当)/
const EARS = /(\bWHEN\b|\bWHILE\b|\bIF\b|\bWHERE\b|当|若)/i
// A measurable target is a number carrying a unit or a counted noun:
// "250 ms", "99.9 %", "0 committed credential files", "3 attempts".
// Prose with no number at all is what this rejects.
const METRIC = /\b\d+(?:\.\d+)?\s*(?:%|[A-Za-z][A-Za-z/_-]*)/

export function specLint (catalog) {
  const dirs = (catalog.trace && catalog.trace.requirementDirs) || ['docs/requirements']
  const files = dirs.flatMap(d => exists(d) ? listFiles(d).filter(p => /\.md$/i.test(p)) : [])
  if (files.length === 0) {
    return { ok: false, degraded: true, reason: 'no requirement documents found under ' + dirs.join(', '), findings: [], ids: [] }
  }
  const findings = []
  const seen = new Map()
  const ids = []

  for (const f of files) {
    // A template is a skeleton and a changelog cites ids it does not declare.
    // Neither is a requirement source, so neither is linted as one.
    if (/TEMPLATE/i.test(f) || /CHANGELOG/i.test(f)) continue
    const text = readText(f, '')
    const lines = text.split('\n')
    for (const ph of PLACEHOLDERS) {
      const idx = lines.findIndex(l => l.includes(ph))
      if (idx >= 0) findings.push({ file: f, line: idx + 1, severity: 'error', code: 'PLACEHOLDER', message: 'placeholder "' + ph + '" in a requirement document; a half-written requirement is worse than an absent one' })
    }
    for (let i = 0; i < lines.length; i++) {
      const m = /\b((?:REQ|NFR)-[A-Z]{2,6}-\d{3,4})\b/.exec(lines[i])
      if (!m) continue
      const id = m[1]
      if (seen.has(id) && seen.get(id) !== f) {
        findings.push({ file: f, line: i + 1, severity: 'error', code: 'DUPLICATE_ID', message: 'requirement id ' + id + ' also defined in ' + seen.get(id) + '; ids are append-only and never reused' })
      }
      if (seen.has(id)) continue
      seen.set(id, f)
      ids.push({ id, file: f, line: i + 1 })

      const block = lines.slice(i, Math.min(lines.length, i + 14)).join('\n')
      if (!NORMATIVE.test(block)) {
        findings.push({ file: f, line: i + 1, severity: 'error', code: 'NOT_NORMATIVE', id, message: id + ' has no normative keyword (SHALL/MUST/必须); a requirement that obliges nothing cannot be verified' })
      }
      if (id.startsWith('REQ-') && !EARS.test(block)) {
        findings.push({ file: f, line: i + 1, severity: 'warning', code: 'NO_TRIGGER', id, message: id + ' states no trigger or precondition (WHEN/WHILE/IF/WHERE); prefer EARS form so the test case is obvious' })
      }
      if (id.startsWith('NFR-') && !METRIC.test(block)) {
        findings.push({ file: f, line: i + 1, severity: 'error', code: 'NO_METRIC', id, message: id + ' declares no measurable target (number + unit); an unmeasurable quality requirement cannot be gated' })
      }
      const lowered = block.toLowerCase()
      for (const word of AMBIGUOUS) {
        if (lowered.includes(word.toLowerCase())) {
          findings.push({ file: f, line: i + 1, severity: 'warning', code: 'AMBIGUOUS', id, message: id + ' uses the ambiguous term "' + word + '"; replace it with a decidable statement' })
          break
        }
      }
      if (!/(Acceptance|验收|Given|Verification|验证)/i.test(block)) {
        findings.push({ file: f, line: i + 1, severity: 'error', code: 'NO_ACCEPTANCE', id, message: id + ' has no acceptance criteria; without them "done" is an opinion' })
      }
    }
  }

  const allText = files.filter(f => !/TEMPLATE/i.test(f) && !/CHANGELOG/i.test(f)).map(f => readText(f, '')).join('\n').toLowerCase()
  for (const a of ['resilience', 'security', 'safety', 'privacy', 'reliability']) {
    if (!allText.includes(a)) {
      findings.push({ severity: 'error', code: 'ATTRIBUTE_UNADDRESSED', attribute: a, message: 'no requirement addresses "' + a + '"; each key attribute must be stated, or declared out of scope with a written reason' })
    }
  }

  const errors = findings.filter(f => f.severity === 'error')
  return { ok: errors.length === 0, files: files.length, ids, findings, counts: { error: errors.length, warning: findings.length - errors.length, requirements: ids.length } }
}

// ════════════════════════════════════════════════════════════════════════════
// skill contract lint (DeepSeek Harness native)
// ════════════════════════════════════════════════════════════════════════════

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const BOOLISH = new Set(['true', 'false', 'yes', 'no', 'on', 'off', '1', '0'])
const CATALOG_DESCRIPTION_CAP = 500

export function parseFrontmatter (text) {
  if (!text.startsWith('---')) return { ok: false, reason: 'missing YAML frontmatter' }
  const end = text.indexOf('\n---', 3)
  if (end < 0) return { ok: false, reason: 'unterminated YAML frontmatter' }
  const raw = text.slice(3, end).replace(/^\r?\n/, '')
  const body = text.slice(end + 4)
  const data = {}
  let currentKey = null
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (m) {
      currentKey = m[1]
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (v === '>-' || v === '>' || v === '|' || v === '|-') v = ''
      data[currentKey] = v
    } else if (currentKey && /^\s+\S/.test(line)) {
      data[currentKey] = (data[currentKey] ? data[currentKey] + ' ' : '') + line.trim()
    }
  }
  return { ok: true, data, body, raw }
}

// Instruction and documentation files that may legitimately sit at a skills root.
// The harness discovers flat "<name>.md" as a skill, so these would otherwise be
// parsed as skills named AGENTS or README; it skips them for want of frontmatter,
// and so does this lint, deliberately and by name rather than by accident.
const SKILL_ROOT_RESERVED = new Set(['AGENTS.md', 'AGENTS.local.md', 'CLAUDE.md', 'CLAUDE.local.md', 'README.md'])

export function skillsLint (dirs = null) {
  // Project roots first, then the user-global root the harness also scans, so a
  // privately installed doctrine is linted where it actually lives.
  const roots = dirs || ['.dsh/skills', '.agents/skills', path.posix.join(DSH_HOME.split(path.sep).join('/'), 'skills')]
  const findings = []
  const skills = []
  for (const d of roots) {
    if (!exists(d)) continue
    let entries
    try { entries = fs.readdirSync(abs(d), { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      let file = null
      let expectedName = null
      if (e.isDirectory()) { file = d + '/' + e.name + '/SKILL.md'; expectedName = e.name }
      else if (e.isFile() && SKILL_ROOT_RESERVED.has(e.name)) continue
      else if (e.isFile() && e.name.endsWith('.md')) { file = d + '/' + e.name; expectedName = e.name.replace(/\.md$/, '') }
      else continue
      if (!exists(file)) {
        findings.push({ file: d + '/' + e.name, severity: 'error', code: 'NO_SKILL_MD', message: 'skill directory has no SKILL.md; the harness discovers only <root>/<name>/SKILL.md or <root>/<name>.md, never nested trees' })
        continue
      }
      const text = readText(file, '')
      const fm = parseFrontmatter(text)
      if (!fm.ok) { findings.push({ file, severity: 'error', code: 'BAD_FRONTMATTER', message: fm.reason }); continue }
      const meta = fm.data
      if (!meta.name) findings.push({ file, severity: 'error', code: 'NO_NAME', message: 'frontmatter requires name' })
      else {
        if (!KEBAB.test(meta.name)) findings.push({ file, severity: 'error', code: 'NAME_NOT_KEBAB', message: 'skill name "' + meta.name + '" must be kebab-case; the harness rejects anything else' })
        if (expectedName && meta.name !== expectedName) findings.push({ file, severity: 'error', code: 'NAME_MISMATCH', message: 'frontmatter name "' + meta.name + '" does not match its location "' + expectedName + '"; a mismatch between discovery and load invalidates the provider' })
      }
      if (!meta.description) findings.push({ file, severity: 'error', code: 'NO_DESCRIPTION', message: 'frontmatter requires description; it is the only routing signal the model sees in the catalog' })
      else if (meta.description.length > CATALOG_DESCRIPTION_CAP) findings.push({ file, severity: 'error', code: 'DESCRIPTION_TOO_LONG', message: 'description is ' + meta.description.length + ' chars; the catalog truncates at ' + CATALOG_DESCRIPTION_CAP })
      else if (meta.description.length > 220) findings.push({ file, severity: 'warning', code: 'DESCRIPTION_LONG', message: 'description is ' + meta.description.length + ' chars; every session pays for it on every request' })

      for (const key of Object.keys(meta)) {
        if (key === 'disableModelInvocation' || key === 'userInvocable') {
          findings.push({ file, severity: 'error', code: 'CAMEL_CASE_KEY', message: 'frontmatter key "' + key + '" is camelCase; the harness accepts only "disable-model-invocation" and "user-invocable", and drops the entire skill on a rejected spelling' })
        }
      }
      for (const key of ['disable-model-invocation', 'user-invocable']) {
        if (meta[key] !== undefined && !BOOLISH.has(String(meta[key]).toLowerCase())) {
          findings.push({ file, severity: 'error', code: 'NON_BOOLEAN_INVOCATION', message: key + ' must be boolean-like; an invalid value drops the entire skill from discovery' })
        }
      }
      const bytes = Buffer.byteLength(text, 'utf8')
      if (bytes > 24000) findings.push({ file, severity: 'warning', code: 'SKILL_LARGE', message: 'skill body is ' + bytes + ' bytes and is paid in full on load; move detail into references/ and link it' })
      skills.push({
        name: meta.name || expectedName,
        file,
        bytes,
        description: meta.description || '',
        userInvocable: String(meta['user-invocable'] === undefined ? 'true' : meta['user-invocable']).toLowerCase() !== 'false',
        modelInvocable: String(meta['disable-model-invocation'] === undefined ? 'false' : meta['disable-model-invocation']).toLowerCase() === 'false',
      })
    }
  }
  const names = skills.map(s => s.name)
  for (const n of [...new Set(names.filter((x, i) => names.indexOf(x) !== i))]) {
    findings.push({ severity: 'error', code: 'DUPLICATE_SKILL', message: 'duplicate skill name "' + n + '"; the nearer layer silently shadows the other' })
  }
  const errors = findings.filter(f => f.severity === 'error')
  return { ok: errors.length === 0, skills, findings, counts: { error: errors.length, warning: findings.length - errors.length, skills: skills.length } }
}

// ════════════════════════════════════════════════════════════════════════════
// nested AGENTS.md coverage
// ════════════════════════════════════════════════════════════════════════════

const REQUIRED_MODULE_SECTIONS = ['Purpose', 'Boundaries', 'Invariants', 'Verification']

/**
 * The directory a module contract would live in.
 * Wildcard segments are dropped; a remaining file-shaped tail becomes its parent,
 * so both "src/api/**" and "lib/core.mjs" resolve to a real directory.
 */
export function moduleDirOf (glob) {
  const segments = String(glob).split('/')
  const solid = []
  for (const s of segments) {
    if (s.includes('*') || s.includes('?') || s.includes('{')) break
    solid.push(s)
  }
  if (solid.length && /\.[A-Za-z0-9]{1,8}$/.test(solid[solid.length - 1])) solid.pop()
  return solid.join('/')
}

export function agentsLint (catalog) {
  const findings = []
  const cfg = catalog.agentsMd || {}
  const maxBytes = cfg.maxBytes || 12000
  const requireFor = new Set(cfg.requireForRiskTiers || ['high', 'critical'])

  const globalConstitution = path.posix.join(DSH_HOME.split(path.sep).join('/'), 'AGENTS.md')
  if (!exists('AGENTS.md')) {
    // The harness reads $DSH_HOME/AGENTS.md before any project file, so a
    // user-global constitution is a real one; only a total absence is an error.
    if (exists(globalConstitution)) {
      findings.push({ file: globalConstitution, severity: 'warning', code: 'GLOBAL_ROOT_AGENTS', message: 'no project AGENTS.md; the constitution is user-global at ' + globalConstitution + ' and applies to every repository on this machine' })
    } else {
      findings.push({ severity: 'error', code: 'NO_ROOT_AGENTS', message: 'no AGENTS.md in the project and none at ' + globalConstitution + '; the harness has no constitution to inject' })
    }
  } else {
    const bytes = Buffer.byteLength(readText('AGENTS.md', ''), 'utf8')
    if (bytes > maxBytes) findings.push({ file: 'AGENTS.md', severity: 'warning', code: 'ROOT_AGENTS_LARGE', message: 'root AGENTS.md is ' + bytes + ' bytes and is resent on every request; keep durable invariants here and push procedure into skills' })
  }

  const found = []
  for (const m of catalog.modules || []) {
    // The root AGENTS.md is the project constitution, checked above; it is never
    // a module contract, so a root-level path contributes no candidate here.
    const dirs = [...new Set((m.paths || []).map(moduleDirOf).filter(Boolean))]
    const candidates = [...new Set(dirs.map(d => d + '/AGENTS.md'))]
    const present = candidates.filter(c => exists(c))
    const needed = requireFor.has(m.riskTier || 'medium')
    if (present.length === 0) {
      findings.push({
        module: m.id,
        severity: needed ? 'error' : 'warning',
        code: 'NO_MODULE_AGENTS',
        message: 'module "' + m.id + '" (riskTier ' + (m.riskTier || 'medium') + ') has no AGENTS.md at ' + (candidates.join(' or ') || 'its paths') + '; the harness auto-loads that file whenever an agent touches the module, so it is the cheapest boundary contract available',
      })
      continue
    }
    for (const p of present) {
      const text = readText(p, '')
      const bytes = Buffer.byteLength(text, 'utf8')
      found.push({ module: m.id, file: p, bytes })
      if (bytes > maxBytes) findings.push({ module: m.id, file: p, severity: 'warning', code: 'MODULE_AGENTS_LARGE', message: p + ' is ' + bytes + ' bytes' })
      const missing = REQUIRED_MODULE_SECTIONS.filter(s => !new RegExp('^#{1,4}\\s*' + s, 'im').test(text))
      if (missing.length) findings.push({ module: m.id, file: p, severity: 'warning', code: 'MODULE_AGENTS_INCOMPLETE', message: p + ' is missing section(s): ' + missing.join(', ') })
    }
  }
  const errors = findings.filter(f => f.severity === 'error')
  return { ok: errors.length === 0, moduleContracts: found, findings, counts: { error: errors.length, warning: findings.length - errors.length, contracts: found.length } }
}

// ════════════════════════════════════════════════════════════════════════════
// traceability
// ════════════════════════════════════════════════════════════════════════════

const ID_RE = /\b((?:REQ|NFR|HAZ|THR)-[A-Z]{2,6}-\d{3,4})\b/g

export function trace (catalog) {
  const spec = specLint(catalog)
  if (spec.degraded) return { ok: false, degraded: true, reason: spec.reason }
  const declared = new Map(spec.ids.map(x => [x.id, { id: x.id, file: x.file, adrs: [], tests: [], code: [], modules: new Set() }]))

  const t = trackedFiles(catalog.maxTrackedPaths)
  const reqDirs = (catalog.trace && catalog.trace.requirementDirs) || ['docs/requirements']
  const testGlobs = (catalog.trace && catalog.trace.testGlobs) || ['**/test/**', '**/tests/**', '**/*.test.*', '**/*_test.*', '**/*Test.*', '**/*.spec.*']
  const adrDir = (catalog.adr && catalog.adr.dir) || 'docs/adr'
  // Prose may legitimately cite an illustrative id. A dangling reference from
  // documentation is reported; a dangling reference from code or tests fails,
  // because that one names a requirement that no longer exists.
  const docGlobs = (catalog.trace && catalog.trace.documentationGlobs) || ['docs/**', '.dsh/docs/**', '.dsh/templates/**', '.dsh/skills/**', '*.md']
  const dangling = []
  const danglingInDocs = []

  for (const f of t.paths) {
    if (reqDirs.some(d => f.startsWith(d + '/'))) continue
    if (SCAN_SKIP_EXT.has(path.extname(f).toLowerCase())) continue
    let text
    try {
      const st = fs.statSync(abs(f))
      if (st.size > 512 * 1024) continue
      text = fs.readFileSync(abs(f), 'utf8')
    } catch { continue }
    if (text.indexOf('\u0000') >= 0) continue
    ID_RE.lastIndex = 0
    let m
    const hits = new Set()
    while ((m = ID_RE.exec(text)) !== null) hits.add(m[1])
    if (hits.size === 0) continue
    const cls = classifyPath(catalog, f)
    const isTest = matchesAny(f, testGlobs)
    const isAdr = f.startsWith(adrDir + '/')
    for (const id of hits) {
      const rec = declared.get(id)
      if (!rec) {
        if (matchesAny(f, docGlobs)) danglingInDocs.push({ id, file: f })
        else dangling.push({ id, file: f })
        continue
      }
      if (isAdr) rec.adrs.push(f)
      else if (isTest) rec.tests.push(f)
      else rec.code.push(f)
      if (cls.kind === 'module') rec.modules.add(cls.moduleId)
    }
  }

  const rows = [...declared.values()].map(r => ({
    id: r.id,
    definedIn: r.file,
    adrs: r.adrs,
    tests: r.tests.slice(0, 10),
    testCount: r.tests.length,
    codeCount: r.code.length,
    modules: [...r.modules],
    verified: r.tests.length > 0,
    implemented: r.code.length > 0 || r.modules.size > 0,
  }))
  const unverified = rows.filter(r => !r.verified)
  const orphaned = rows.filter(r => !r.implemented && !r.verified)
  const minCoverage = (catalog.trace && catalog.trace.minCoverage !== undefined) ? catalog.trace.minCoverage : 1
  const coverage = rows.length ? (rows.length - unverified.length) / rows.length : 0

  return {
    ok: coverage >= minCoverage && dangling.length === 0,
    coverage: Number(coverage.toFixed(4)),
    minCoverage,
    total: rows.length,
    verified: rows.length - unverified.length,
    unverified: unverified.map(r => r.id),
    orphaned: orphaned.map(r => r.id),
    dangling: dangling.slice(0, 50),
    danglingInDocs: danglingInDocs.slice(0, 50),
    danglingInDocsCount: danglingInDocs.length,
    rows,
    advice: unverified.length
      ? 'Every requirement must be referenced by at least one test. Put the id in a test name or comment so the link is machine-checkable.'
      : 'Every declared requirement is referenced by at least one test.',
  }
}
