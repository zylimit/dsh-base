// A receipt that cannot be parsed is evidence loss, not evidence absence.
// Verifying receipts must report it, refuse a green verdict, and quarantine
// the file - a hand-edited receipt that disappears silently would make the
// tamper-evidence chain a chain of what survived.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir } from './helpers.mjs'

function repo () {
  const dir = tempDir('rcpt')
  const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 't@e.invalid'])
  run(['config', 'user.name', 't'])
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 1\n')
  run(['add', '-A']); run(['commit', '-q', '-m', 'base'])
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 2\n')
  return { dir }
}

test('an unreadable receipt fails the verdict and is quarantined, never dropped', () => {
  const { dir } = repo()
  try {
    const w = dsb(['receipt', 'write'], { cwd: dir, input: JSON.stringify({ taskId: 'T-1', reviewer: 'me', verdict: 'ACCEPT', scope: 'src' }) })
    assert.equal(w.code, 0, JSON.stringify(w.json))
    fs.writeFileSync(path.join(dir, '.dsh', 'base', 'receipts', 'broken.json'), '{ not json')
    const r = dsb(['receipt', 'verify'], { cwd: dir })
    assert.notEqual(r.code, 0, 'an unreadable receipt must not leave the verdict green: ' + JSON.stringify(r.json))
    assert.ok((r.json.unreadable || []).some(p => String(p).endsWith('broken.json')), JSON.stringify(r.json))
    assert.equal(r.json.ok, false)
    const leftovers = fs.readdirSync(path.join(dir, '.dsh', 'base', 'receipts')).filter(f => f.startsWith('broken.json.corrupt-'))
    assert.equal(leftovers.length, 1, 'the unreadable receipt is moved aside, not deleted')
    const q = fs.readFileSync(path.join(dir, '.dsh', 'base', 'state', 'quarantine.jsonl'), 'utf8')
    assert.match(q, /unreadable receipt/)
  } finally { rmDir(dir) }
})
