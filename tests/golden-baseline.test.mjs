// The golden baseline pins the full stdout-JSON and exit-code contract of
// every subcommand across a matrix of repo states. It is the one assertion
// that catches a change which keeps every individual test green while quietly
// moving the machine-readable surface the hooks and CI consume.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { REPO } from './helpers.mjs'

test('the golden baseline holds: every subcommand contract is byte-stable', () => {
  const r = spawnSync(process.execPath, [REPO + '/tests/golden-baseline.mjs', '--check'], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const json = JSON.parse(r.stdout)
  assert.equal(json.ok, true, JSON.stringify(json.drift))
})
