// The fast-mode loan is capped at 8 hours on the READ side too: a
// hand-edited future until must not turn a dated loan into a permanent
// discount. (The siblings' v3 lesson: anchor the cap on the write-time epoch.)
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { tempDir, rmDir, REPO } from './helpers.mjs'

function probe (dir) {
  const url = pathToFileURL(path.join(REPO, '.dsh', 'base', 'lib', 'quality.mjs')).href
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', "import('" + url + "').then(m => console.log(JSON.stringify(m.fastState())))"], { cwd: dir, encoding: 'utf8', windowsHide: true })
  return JSON.parse(r.stdout)
}

test('a hand-edited future until cannot extend the loan beyond the 8-hour cap', () => {
  const dir = tempDir('fastclamp')
  try {
    fs.mkdirSync(path.join(dir, '.dsh', 'base', 'state'), { recursive: true })
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString()
    const tenDaysAhead = new Date(Date.now() + 10 * 86400000).toISOString()
    fs.writeFileSync(path.join(dir, '.dsh', 'base', 'state', 'fast-mode.json'), JSON.stringify({
      version: 1, reason: 'tampered', by: 'x', minutes: 60, createdAt: threeDaysAgo, until: tenDaysAhead,
    }))
    const s = probe(dir)
    assert.equal(s.active, false, 'the clamp must expire the loan: ' + JSON.stringify(s))
    assert.ok(new Date(s.until) <= new Date(), 'the effective until must be capped')
  } finally { rmDir(dir) }
})

test('a legitimate window stays active within its own cap', () => {
  const dir = tempDir('fastclamp2')
  try {
    fs.mkdirSync(path.join(dir, '.dsh', 'base', 'state'), { recursive: true })
    const now = Date.now()
    fs.writeFileSync(path.join(dir, '.dsh', 'base', 'state', 'fast-mode.json'), JSON.stringify({
      version: 1, reason: 'legit', by: 'x', minutes: 60, createdAt: new Date(now).toISOString(), until: new Date(now + 30 * 60000).toISOString(),
    }))
    const s = probe(dir)
    assert.equal(s.active, true, JSON.stringify(s))
  } finally { rmDir(dir) }
})
