#!/usr/bin/env node
// Instruction files are executable-adjacent input, and they are an active attack
// surface: credential leakage and base-URL redirection have been found inside
// AI instruction files in the wild, and README/instruction injection is a
// documented technique for hijacking a coding assistant.
//
// This scanner treats AGENTS.md, CLAUDE.md, SKILL.md and every per-IDE rule file
// as UNTRUSTED, because a cloned repository can carry them and the harness will
// load them without asking. It claims the security attribute, so it can never be
// waived and never fast-skipped.
//
//   node .dsh/base/audit/scan-instructions.mjs [--staged]

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

// Everything a harness may load as instructions without a human opening it.
const INSTRUCTION_PATTERNS = [
  /(^|\/)AGENTS(\.local)?\.md$/i,
  /(^|\/)CLAUDE(\.local)?\.md$/i,
  /(^|\/)GEMINI\.md$/i,
  /(^|\/)\.cursorrules$/i,
  /(^|\/)\.cursor\/rules\//i,
  /(^|\/)\.github\/copilot-instructions\.md$/i,
  /(^|\/)\.windsurfrules$/i,
  /(^|\/)skills?\/[^/]+\/SKILL\.md$/i,
  /(^|\/)\.dsh\/skills\//i,
  /(^|\/)\.agents\//i,
]

const RULES = [
  {
    id: 'endpoint-override',
    severity: 'error',
    message: 'redirects the model or tool endpoint. An instruction file that moves the API base URL sends every prompt and every credential to somewhere the reader did not choose.',
    re: /\b(ANTHROPIC_BASE_URL|OPENAI_BASE_URL|OPENAI_API_BASE|GEMINI_BASE_URL|LLM_BASE_URL|HTTPS?_PROXY|ALL_PROXY)\b\s*[:=]/i,
  },
  {
    id: 'embedded-credential',
    severity: 'error',
    message: 'carries credential-shaped material. Instruction files are copied between repositories and pasted into issues; a key here is a key published.',
    re: /\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    id: 'instruction-override',
    severity: 'error',
    message: 'attempts to override higher-authority instructions. Repository-supplied text is the lowest authority there is; text that argues otherwise is an injection attempt.',
    re: /\b(ignore (all )?(previous|prior|above|earlier) (instructions|rules|prompts)|disregard (the )?(system|previous|above)|you are now [a-z]|forget (everything|all previous)|override (the )?(system|safety))\b/i,
  },
  {
    id: 'exfiltration-command',
    severity: 'error',
    message: 'instructs the agent to send repository content to a network endpoint. An instruction file may describe how to build; it has no reason to describe how to upload.',
    re: /\b(curl|wget|Invoke-WebRequest|iwr)\b[^\n]{0,120}\b(-d|--data|--upload-file|-F|-T|-Method\s+Post)\b|\bnc\b\s+-[a-z]*\s*\d{1,5}\b/i,
  },
  {
    id: 'silent-execution',
    severity: 'error',
    message: 'pipes a downloaded script straight into a shell. Nothing that must be read before it runs should arrive this way.',
    re: /\b(curl|wget)\b[^\n|]{0,200}\|\s*(sudo\s+)?(ba)?sh\b|\biex\s*\(\s*(new-object|iwr|invoke-webrequest)/i,
  },
  {
    id: 'hidden-characters',
    severity: 'error',
    message: 'contains zero-width or bidirectional control characters. Text a human cannot see but a model reads is, by construction, an instruction meant to escape review.',
    re: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/,
  },
  {
    id: 'gate-disable-instruction',
    severity: 'error',
    message: 'instructs the agent to bypass verification. A repository that tells an agent to skip its own gates is describing the exploit, not the build.',
    re: /\b(--no-verify|--no-gpg-sign\s+--no-verify|skip[- ]?(the )?(hook|gate|check|test)s?|disable (the )?(hook|gate|lint|check)s?)\b/i,
  },
  {
    id: 'secret-file-read',
    severity: 'warning',
    message: 'names a secret-bearing path. An instruction file should never need to point at one.',
    re: /(^|[\s"'\x60])(\.env(\.[a-z]+)?|id_rsa|id_ed25519|\.ssh\/|\.aws\/credentials|\.npmrc)\b/i,
  },
]

const SUPPRESS = /scan-instructions:ignore/
const BOUND = /scan-instructions:ignore\s+sha256:([0-9a-fA-F]{64})/
const HASH_TOKEN = /\ssha256:[0-9a-fA-F]{64}/g
const hashOnly = process.argv.includes('--hash')
const staged = process.argv.includes('--staged')

const stripCr = (s) => String(s == null ? '' : s).replace(/\r/g, '')

/**
 * The window a bound exemption covers: the marker line plus both neighbours.
 * The marker's own hash token is stripped before hashing, so writing the token
 * cannot break the hash it carries; editing any other byte of the window (the
 * exempted content or its context) voids the exemption.
 */
function windowHash (lines, i) {
  const win = [lines[i - 1], lines[i], lines[i + 1]].map(l => {
    const t = stripCr(l)
    return SUPPRESS.test(t) ? t.replace(HASH_TOKEN, '') : t
  })
  return crypto.createHash('sha256').update(win.join('\n')).digest('hex')
}

function fileList () {
  const args = staged
    ? ['-c', 'core.quotePath=false', 'diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']
    : ['-c', 'core.quotePath=false', 'ls-files', '-z']
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\u0000').filter(Boolean)
  } catch { return null }
}

const all = fileList()
if (all === null) {
  process.stderr.write('scan-instructions: not a git repository; refusing to guess the file set\n')
  process.exit(3)
}

const targets = all.filter(f => INSTRUCTION_PATTERNS.some(re => re.test(f)))
const findings = []
const hashes = []

for (const f of targets) {
  let text
  try {
    if (fs.statSync(f).size > 1024 * 1024) {
      findings.push({ file: f, rule: 'oversized', severity: 'warning', line: 0, message: 'instruction file larger than 1 MB was not scanned' })
      continue
    }
    text = fs.readFileSync(f, 'utf8')
  } catch { continue }

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const markerHere = SUPPRESS.test(line)
    const markerAbove = i > 0 && SUPPRESS.test(lines[i - 1])
    if (hashOnly) {
      if (markerHere && !BOUND.test(line)) hashes.push({ file: f, line: i + 1, sha256: windowHash(lines, i) })
      continue
    }
    if (markerHere || markerAbove) {
      let voided = false
      for (const ml of [i, i - 1]) {
        if (ml < 0 || !SUPPRESS.test(lines[ml])) continue
        const bm = BOUND.exec(lines[ml])
        if (bm && windowHash(lines, ml) !== bm[1].toLowerCase()) {
          voided = true
          findings.push({
            file: f, line: ml + 1, rule: 'suppression-stale', severity: 'error',
            message: 'the ignored content or one of its neighbours changed since this exemption was bound; the exemption is void - re-review the line and re-bind it with "node .dsh/base/audit/scan-instructions.mjs --hash"',
            excerpt: lines[ml].trim().slice(0, 120),
          })
        }
      }
      if (!voided) continue
    }
    for (const rule of RULES) {
      if (!rule.re.test(line)) continue
      findings.push({
        file: f,
        line: i + 1,
        rule: rule.id,
        severity: rule.severity,
        message: rule.message,
        excerpt: line.trim().slice(0, 120),
      })
    }
  }
}

for (const f of findings) {
  process.stderr.write((f.severity === 'error' ? ' ERR  ' : ' warn ') + f.rule.padEnd(24) + f.file + ':' + f.line + '  ' + f.excerpt + '\n')
}
const errors = findings.filter(f => f.severity === 'error')
process.stdout.write(JSON.stringify({
  command: 'scan-instructions',
  ok: errors.length === 0,
  scanned: targets.length,
  staged,
  findings: findings.slice(0, 100),
  hashes,
  counts: { error: errors.length, warning: findings.length - errors.length },
}) + '\n')
process.stderr.write('scan-instructions: ' + targets.length + ' instruction file(s), ' +
  errors.length + ' error(s), ' + (findings.length - errors.length) + ' warning(s)\n')
process.exit(errors.length === 0 ? 0 : 1)
