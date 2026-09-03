// The path contract (the siblings' 19g/3eb1948 lesson): a path inside the
// repository renders repo-relative; a path outside keeps its original spelling.
// path.relative of an outside path is a '../etc/nope' artifact that means
// nothing to anyone, and emitting it into stdout JSON is a silent lie about
// where a finding lives.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { rel, ROOT } from '../.dsh/base/lib/core.mjs'

test('an out-of-repo absolute path keeps its spelling, never ../ garbage', () => {
  const outside = path.resolve(path.join(process.cwd(), '..', '..', 'etc', 'nope', 'x.json'))
  const r = rel(outside)
  assert.ok(!r.startsWith('..'), 'path.relative garbage: ' + r)
  assert.equal(r, path.resolve(outside))
})

test('an in-repo path still renders repo-relative', () => {
  assert.equal(rel(path.join(ROOT, 'src', 'x.ts')), 'src/x.ts')
  assert.equal(rel(ROOT), '')
})
