#!/usr/bin/env node
// Parse every tracked JavaScript module. A file that cannot be parsed cannot be
// trusted to run, so this is the cheapest possible reliability check.
import { spawnSync, execFileSync } from 'node:child_process'
import process from 'node:process'

function tracked () {
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\u0000').filter(Boolean)
  } catch {
    return null
  }
}

const files = tracked()
if (files === null) {
  process.stderr.write('check-syntax: not a git repository; refusing to guess the file set\n')
  process.exit(3)
}

const targets = files.filter(f => /\.(mjs|cjs|js)$/.test(f))
const failures = []
for (const f of targets) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) failures.push({ file: f, error: (r.stderr || '').trim().split('\n').slice(0, 4).join(' | ') })
}

for (const f of failures) process.stderr.write('SYNTAX  ' + f.file + '  ' + f.error + '\n')
process.stdout.write(JSON.stringify({ command: 'check-syntax', ok: failures.length === 0, checked: targets.length, failures }) + '\n')
process.stderr.write('check-syntax: ' + targets.length + ' file(s), ' + failures.length + ' failure(s)\n')
process.exit(failures.length === 0 ? 0 : 1)
