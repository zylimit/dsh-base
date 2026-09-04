// Evidence must bind the engine that produced it, and a truncated
// measurement must not read as a pass. Both come from the siblings'
// own absorption lists - we preempt them before they land.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir, REPO } from './helpers.mjs'
import { pathToFileURL } from 'node:url'

function repo () {
  const dir = tempDir('bind')
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

test('a receipt records the engine identity and verifies under the same engine', () => {
  const { dir } = repo()
  try {
    const w = dsb(['receipt', 'write'], { cwd: dir, input: JSON.stringify({ taskId: 'T-1', reviewer: 'me', verdict: 'ACCEPT', scope: 'src' }) })
    assert.equal(w.code, 0, JSON.stringify(w.json))
    assert.match(w.json.receipt.engineHash, /^[0-9a-f]{64}$/, 'the receipt must bind the engine that produced it')
    const v = dsb(['receipt', 'verify'], { cwd: dir })
    assert.equal(v.code, 0, JSON.stringify(v.json))
  } finally { rmDir(dir) }
})

test('a receipt fails the verdict under a different engine identity', () => {
  const { dir } = repo()
  try {
    const w = dsb(['receipt', 'write'], { cwd: dir, input: JSON.stringify({ taskId: 'T-1', reviewer: 'me', verdict: 'ACCEPT', scope: 'src' }) })
    assert.equal(w.code, 0, JSON.stringify(w.json))
    const v = dsb(['receipt', 'verify'], { cwd: dir })
    assert.equal(v.code, 0)
    // The engine changed under the receipt: evidence produced by a different
    // tool cannot certify this one. The engine's ROOT is fixed at import, so
    // the check runs in a subprocess whose cwd is the fixture.
    const probe = "import('" + pathToFileURL(path.join(REPO, '.dsh', 'base', 'lib', 'quality.mjs')).href + "').then(m => console.log(JSON.stringify(m.verifyReceipts({ engineHash: 'deadbeef' }))))"
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: dir, encoding: 'utf8', windowsHide: true })
    const changed = JSON.parse(r.stdout)
    assert.equal(changed.ok, false)
    assert.ok((changed.engineMismatch || []).some(p => String(p).includes('T-1')), JSON.stringify(changed))
  } finally { rmDir(dir) }
})
