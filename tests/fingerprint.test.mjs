// The evidence fingerprint must be exact: rename detection is disabled so a
// rename can never collapse to a header with an empty body, and a pure rename
// across an excluded boundary still changes the hash. A receipt bound to
// "nothing changed" while a file moved is a false green.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir } from './helpers.mjs'
import { EMPTY_DIFF_HASH } from '../.dsh/base/lib/core.mjs'

test('the fingerprint is identical whether or not git rename detection is enabled', () => {
  const dir = tempDir('fp-rename')
  try {
    const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
    run(['init', '-q', '-b', 'main'])
    run(['config', 'user.email', 't@e.invalid'])
    run(['config', 'user.name', 't'])
    fs.mkdirSync(path.join(dir, '.dsh', 'base', 'evidence'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.dsh', 'base', 'evidence', 'x.log'), 'old log content\n')
    run(['add', '-A']); run(['commit', '-q', '-m', 'base'])
    const before = dsb(['task', 'status'], { cwd: dir })
    assert.equal(before.code, 0, JSON.stringify(before.json))
    assert.equal(before.json.diffHash, EMPTY_DIFF_HASH, 'a clean tree has the named empty identity')
    run(['mv', '.dsh/base/evidence/x.log', 'src/x.mjs'])
    run(['config', 'diff.renames', 'true'])
    const withRenames = dsb(['task', 'status'], { cwd: dir })
    run(['config', 'diff.renames', 'false'])
    const withoutRenames = dsb(['task', 'status'], { cwd: dir })
    assert.equal(withRenames.code, 0, JSON.stringify(withRenames.json))
    assert.equal(withoutRenames.code, 0, JSON.stringify(withoutRenames.json))
    assert.notEqual(withRenames.json.diffHash, EMPTY_DIFF_HASH, 'a rename is a change')
    assert.equal(withRenames.json.diffHash, withoutRenames.json.diffHash,
      'the fingerprint must not depend on the local diff.renames setting: a receipt written on one machine must verify on another')
  } finally { rmDir(dir) }
})

test('renaming into a governed path with edited content exposes the new bytes', () => {
  const dir = tempDir('fp-rename-edit')
  try {
    const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
    run(['init', '-q', '-b', 'main'])
    run(['config', 'user.email', 't@e.invalid'])
    run(['config', 'user.name', 't'])
    fs.mkdirSync(path.join(dir, '.dsh', 'base', 'evidence'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.dsh', 'base', 'evidence', 'x.log'), 'old log content\n')
    run(['add', '-A']); run(['commit', '-q', '-m', 'base'])
    run(['mv', '.dsh/base/evidence/x.log', 'src/x.mjs'])
    fs.writeFileSync(path.join(dir, 'src', 'x.mjs'), 'const RENAMED_LINE = true\n')
    const after = dsb(['task', 'status'], { cwd: dir })
    assert.equal(after.code, 0, JSON.stringify(after.json))
    assert.notEqual(after.json.diffHash, EMPTY_DIFF_HASH)
  } finally { rmDir(dir) }
})
