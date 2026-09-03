// A rule that names an enforcement point which does not exist is a phantom:
// it reads as enforced while enforcing nothing, which is worse than admitting
// to being unenforced. The audit must name it.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dsb, tempDir, rmDir } from './helpers.mjs'

function repo () {
  const dir = tempDir('phantom')
  const run = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', windowsHide: true })
  run(['init', '-q', '-b', 'main'])
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 1\n')
  fs.mkdirSync(path.join(dir, '.dsh', 'base'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.dsh', 'base', 'catalog.json'), JSON.stringify({
    version: 1, global: [], ignored: [{ path: '.dsh/**', reason: 'x' }],
    riskChecks: { low: [] }, checks: {},
    modules: [{ id: 'core', paths: ['src/**'], riskTier: 'low' }],
  }, null, 2))
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
    '# constitution',
    '',
    '## Rules',
    '',
    '- Every decision is enforced by \x60dsb gate\x60.',
    '- Every decision is enforced by \x60dsb phantasm\x60.',
    '- Every decision is enforced by \x60.dsh/base/audit/phantasm.mjs\x60.',
    '',
  ].join('\n'))
  run(['add', '-A']); run(['commit', '-q', '-m', 'fixture'])
  return { dir }
}

test('the rule audit names phantoms and counts them separately from silence', () => {
  const { dir } = repo()
  try {
    const r = dsb(['rules-audit'], { cwd: dir })
    assert.equal(r.code, 0, 'advisory by default: ' + JSON.stringify(r.json))
    assert.ok((r.json.counts.phantom || 0) >= 2, JSON.stringify(r.json.counts))
    const phantoms = (r.json.findings || []).filter(f => f.code === 'RULE_PHANTOM')
    assert.ok(phantoms.some(f => f.message.includes('phantasm')), JSON.stringify(phantoms))
    assert.ok((r.json.counts.enforced || 0) >= 1, 'the real command still counts as enforced')
  } finally { rmDir(dir) }
})
