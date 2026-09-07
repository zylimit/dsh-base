// The bridge contract: a business-facing skill opts in with frontmatter
// bridge: true and must then carry dialogue examples, the fact-vs-inference
// marking convention, and a handoff block. Machine-enforced, so the bridge
// cannot be thinned into slogans later.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { tempDir, rmDir, REPO } from './helpers.mjs'

function writeSkill (dir, name, frontmatter, body) {
  const skillDir = path.join(dir, 'skills', name)
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\n' + frontmatter + '\n---\n\n' + body)
}

function lint (dir) {
  const url = pathToFileURL(path.join(REPO, '.dsh', 'base', 'lib', 'scan.mjs')).href
  const probe = "import('" + url + "').then(m => console.log(JSON.stringify(m.skillsLint(['skills']))))"
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: dir, encoding: 'utf8', windowsHide: true })
  return JSON.parse(r.stdout)
}

const FM = 'name: bridge-test\ndescription: Use when a bridge test needs linting.\nbridge: true'
const BRIDGE_SECTIONS = [
  '## Dialogue examples',
  '',
  'User: the first turn.',
  'AI: the follow-up question that unblocks a decision.',
  '',
  '## Facts vs inference',
  '',
  'F: user-confirmed fact, with pointer.',
  'I: AI inference, restated in context for checking.',
  '',
  '## Handoff',
  '',
  'The next role receives the spec.',
  'Open questions carry owner and deadline.',
]

test('a bridge skill without the three bridge sections fails the lint', () => {
  const dir = tempDir('bridge')
  try {
    writeSkill(dir, 'bridge-test', FM, '## Purpose\nbody\n')
    const r = lint(dir)
    assert.equal(r.ok, false, JSON.stringify(r.findings))
    assert.ok(r.findings.some(f => f.code === 'BRIDGE_SECTION_MISSING'), JSON.stringify(r.findings))
  } finally { rmDir(dir) }
})

test('a bridge skill with all three sections passes', () => {
  const dir = tempDir('bridge2')
  try {
    writeSkill(dir, 'bridge-test', FM, BRIDGE_SECTIONS.join('\n'))
    const r = lint(dir)
    assert.equal(r.ok, true, JSON.stringify(r.findings))
  } finally { rmDir(dir) }
})

test('a non-bridge skill is not required to carry the sections', () => {
  const dir = tempDir('bridge3')
  try {
    writeSkill(dir, 'plain-test', 'name: plain-test\ndescription: Use when plain.', '## Purpose\nbody\n')
    const r = lint(dir)
    assert.equal(r.ok, true, JSON.stringify(r.findings))
  } finally { rmDir(dir) }
})
