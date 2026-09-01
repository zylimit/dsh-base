#!/usr/bin/env node
// Secret and provenance audit over the distributable surface.
//
// Three independent questions:
//   1. Is a file that must never be tracked actually tracked?
//   2. Does any tracked text contain credential-shaped material?
//   3. Does any distributable file leak a developer's absolute home path?
//
// Any yes is exit 1. This check claims the security and privacy attributes,
// so it can never be waived or fast-skipped.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const FORBIDDEN_TRACKED = [
  /(^|\/)\.env$/, /(^|\/)\.env\.(?!example|sample|template)/,
  /\.pem$/, /\.key$/, /\.p12$/, /\.pfx$/, /\.jks$/, /\.keystore$/,
  /(^|\/)id_rsa/, /(^|\/)id_ed25519/, /(^|\/)\.ssh\//, /(^|\/)\.aws\//, /(^|\/)\.npmrc$/,
]

const SECRET_PATTERNS = [
  { id: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'github-token', re: /\bghp_[A-Za-z0-9]{20,}/ },
  { id: 'openai-style-key', re: /\bsk-[A-Za-z0-9]{24,}/ },
  { id: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'generic-assignment', re: /(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["'][^"'\s]{12,}["']/i },
]

const ALLOW_CONTEXT = /(example|sample|placeholder|dummy|redacted|xxxx|your[-_]|<[^>]+>|process\.env|os\.environ|getenv|interpolated|env:)/i

const HOME_PATH_PATTERNS = [
  { id: 'windows-home', re: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/ },
  { id: 'unix-home', re: /\/home\/[A-Za-z0-9._-]+\// },
  { id: 'macos-home', re: /\/Users\/[A-Za-z0-9._-]+\// },
]

const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.woff', '.woff2', '.ttf', '.mp4', '.bin', '.exe', '.dll'])

const staged = process.argv.includes('--staged')

function fileList () {
  const args = staged
    ? ['-c', 'core.quotePath=false', 'diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']
    : ['-c', 'core.quotePath=false', 'ls-files', '-z']
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\u0000').filter(Boolean)
  } catch {
    return null
  }
}

const files = fileList()
if (files === null) {
  process.stderr.write('scan-secrets: not a git repository; refusing to guess the file set\n')
  process.exit(3)
}

const findings = []

for (const f of files) {
  for (const re of FORBIDDEN_TRACKED) {
    if (re.test(f)) findings.push({ kind: 'forbidden-tracked-file', file: f, detail: 'this path class must never be committed' })
  }
}

for (const f of files) {
  if (SKIP_EXT.has(path.extname(f).toLowerCase())) continue
  let text
  try {
    if (fs.statSync(f).size > 1024 * 1024) continue
    text = fs.readFileSync(f, 'utf8')
  } catch { continue }
  if (text.indexOf('\u0000') >= 0) continue
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/scan-secrets:ignore/.test(line)) continue
    for (const p of SECRET_PATTERNS) {
      if (!p.re.test(line)) continue
      if (ALLOW_CONTEXT.test(line)) continue
      findings.push({ kind: 'secret-literal', rule: p.id, file: f, line: i + 1, excerpt: line.trim().slice(0, 120) })
    }
    for (const p of HOME_PATH_PATTERNS) {
      if (!p.re.test(line)) continue
      if (/scan-secrets:ignore|example|placeholder/i.test(line)) continue
      findings.push({ kind: 'home-path-leak', rule: p.id, file: f, line: i + 1, excerpt: line.trim().slice(0, 120) })
    }
  }
}

for (const f of findings) {
  process.stderr.write(f.kind.toUpperCase() + '  ' + f.file + (f.line ? ':' + f.line : '') + '  ' + (f.rule || f.detail || '') + '\n')
}
process.stdout.write(JSON.stringify({ command: 'scan-secrets', ok: findings.length === 0, scanned: files.length, staged, findings: findings.slice(0, 100) }) + '\n')
process.stderr.write('scan-secrets: ' + files.length + ' file(s), ' + findings.length + ' finding(s)\n')
process.exit(findings.length === 0 ? 0 : 1)
