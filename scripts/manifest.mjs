#!/usr/bin/env node
// Integrity manifest over the distributable surface.
//
//   --write  regenerate FRAMEWORK-MANIFEST.json
//   --check  fail when a managed asset drifted from its recorded hash
//
// Hashes are computed over LF-normalised bytes so Windows and CI agree.
import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const MANAGED = [
  /^AGENTS\.md$/,
  /^\.dsh\/base\/dsb\.mjs$/,
  /^\.dsh\/base\/lib\/.*\.mjs$/,
  /^\.dsh\/base\/githooks\//,
  // The adapter table and the example catalog are distributed assets whose
  // integrity matters: an edited adapter entry could point a check that claims
  // the security attribute at a command that proves nothing.
  /^\.dsh\/base\/adapters\.json$/,
  /^\.dsh\/base\/catalog\.example\.json$/,
  /^\.dsh\/skills\/.*\/SKILL\.md$/,
  /^\.dsh\/templates\//,
  /^\.dsh\/workflows\//,
  /^scripts\/.*\.mjs$/,
  /^setup\.(ps1|sh)$/,
  /^docs\//,
]

const sha256Lf = (buf) => crypto.createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n')).digest('hex')

function tracked () {
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\u0000').filter(Boolean)
  } catch { return null }
}

const all = tracked()
if (all === null) {
  process.stderr.write('manifest: not a git repository; refusing to guess the file set\n')
  process.exit(3)
}

const managed = all.filter(f => MANAGED.some(re => re.test(f))).sort()
const entries = managed.map(f => {
  const buf = fs.readFileSync(f)
  return { path: f, sha256: sha256Lf(buf), bytes: buf.length }
})
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const digest = crypto.createHash('sha256').update(entries.map(e => e.path + ':' + e.sha256).join('\n')).digest('hex')
const doc = { schema: 'sha256-lf-v1', version: pkg.version, managedFiles: entries.length, digest, files: entries }

if (process.argv.includes('--write')) {
  fs.writeFileSync('FRAMEWORK-MANIFEST.json', JSON.stringify(doc, null, 2) + '\n')
  process.stdout.write(JSON.stringify({ command: 'manifest', ok: true, wrote: 'FRAMEWORK-MANIFEST.json', files: entries.length, digest }) + '\n')
  process.stderr.write('manifest: wrote ' + entries.length + ' entries, digest ' + digest.slice(0, 12) + '\n')
  process.exit(0)
}

if (!fs.existsSync('FRAMEWORK-MANIFEST.json')) {
  process.stderr.write('manifest: FRAMEWORK-MANIFEST.json is absent; run "node scripts/manifest.mjs --write"\n')
  process.stdout.write(JSON.stringify({ command: 'manifest', ok: false, reason: 'manifest-absent' }) + '\n')
  process.exit(1)
}

const prev = JSON.parse(fs.readFileSync('FRAMEWORK-MANIFEST.json', 'utf8'))
const prevMap = new Map((prev.files || []).map(e => [e.path, e.sha256]))
const nowMap = new Map(entries.map(e => [e.path, e.sha256]))
const changed = [], added = [], removed = []
for (const [p, h] of nowMap) {
  if (!prevMap.has(p)) added.push(p)
  else if (prevMap.get(p) !== h) changed.push(p)
}
for (const p of prevMap.keys()) if (!nowMap.has(p)) removed.push(p)

const ok = changed.length === 0 && added.length === 0 && removed.length === 0
for (const p of changed) process.stderr.write('DRIFT    ' + p + '\n')
for (const p of added) process.stderr.write('ADDED    ' + p + '\n')
for (const p of removed) process.stderr.write('REMOVED  ' + p + '\n')
if (!ok) process.stderr.write('manifest: run "node scripts/manifest.mjs --write" and review the diff before committing\n')
process.stdout.write(JSON.stringify({ command: 'manifest', ok, changed, added, removed, digest }) + '\n')
process.exit(ok ? 0 : 1)
