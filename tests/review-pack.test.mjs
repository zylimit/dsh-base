// The review evidence pack must force reviewers past what left, not only what
// arrived: a budgeted removed-lines section and a renames section, in addition
// to the deletion file list.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir } from './helpers.mjs'

function repo () {
  const dir = tempDir('pack')
  const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 't@e.invalid'])
  run(['config', 'user.name', 't'])
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'gone.mjs'), 'const GONE_LINE_MARKER = 42\n')
  fs.writeFileSync(path.join(dir, 'src', 'x.mjs'), 'const x = 1\n')
  run(['add', '-A']); run(['commit', '-q', '-m', 'base'])
  fs.rmSync(path.join(dir, 'src', 'gone.mjs'))
  run(['mv', 'src/x.mjs', 'src/y.mjs'])
  return { dir }
}

test('the review pack shows what left: removed lines and renames have their own sections', () => {
  const { dir } = repo()
  try {
    const r = dsb(['review-pack', '--base', 'HEAD'], { cwd: dir })
    assert.equal(r.code, 0, JSON.stringify(r.json))
    const pack = fs.readFileSync(path.join(dir, r.json.packPath), 'utf8')
    assert.match(pack, /## Removed lines/, 'the pack must render removed content, not only file names')
    assert.match(pack, /GONE_LINE_MARKER/, 'the deleted line itself must appear: ' + pack.slice(0, 600))
    assert.match(pack, /## Renames/)
    assert.match(pack, /gone\.mjs/, 'the deletion audit names the deleted file')
    assert.match(pack, /x\.mjs -> y\.mjs|y\.mjs/, 'the rename is visible')
  } finally { rmDir(dir) }
})
