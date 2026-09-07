// The correction-visibility loop, machine-enforced: a lesson marked graduated
// claims the fix was applied, and the constitution says a correction the user
// cannot see is an apology with extra steps. skills-lint fails a graduated
// lesson whose "What changed" block is still the unfilled template.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { tempDir, rmDir, REPO } from './helpers.mjs'

function lint (dir) {
  const url = pathToFileURL(path.join(REPO, '.dsh', 'base', 'lib', 'scan.mjs')).href
  const probe = "import('" + url + "').then(m => console.log(JSON.stringify(m.skillsLint(['skills']))))"
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: dir, encoding: 'utf8', windowsHide: true })
  return JSON.parse(r.stdout)
}

function writeLesson (dir, slug, graduated, whatChanged) {
  const lessonDir = path.join(dir, '.dsh', 'base', 'feedback')
  fs.mkdirSync(lessonDir, { recursive: true })
  const body = [
    '---',
    'title: the behaviour to change',
    'source: human-correction',
    'occurrences: 4',
    'first_seen: 2026-09-01',
    'last_seen: 2026-09-07',
    'graduated: ' + graduated,
    'skipped: false',
    '---',
    '',
    '## Observed',
    'the wrong behaviour with an evidence pointer.',
    '',
    '## Expected',
    'the decidable behaviour that should have occurred.',
    '',
    '## Candidate mechanism',
    'skill:feedback-and-evolution',
    '',
    '## What changed (shown to the human)',
    whatChanged,
  ].join('\n')
  fs.writeFileSync(path.join(lessonDir, slug + '.md'), body)
}

test('a graduated lesson without a filled What changed block fails the lint', () => {
  const dir = tempDir('lesson')
  try {
    writeLesson(dir, 'swallowed-correction', 'skill:feedback-and-evolution', '- file: <before> -> <after>   (template, never filled)')
    const r = lint(dir)
    assert.equal(r.ok, false, JSON.stringify(r.findings))
    assert.ok(r.findings.some(f => f.code === 'LESSON_WHAT_CHANGED_MISSING'), JSON.stringify(r.findings))
  } finally { rmDir(dir) }
})

test('a graduated lesson with a real before/after line passes', () => {
  const dir = tempDir('lesson2')
  try {
    writeLesson(dir, 'swallowed-correction', 'skill:feedback-and-evolution', '- file: .dsh/base/lib/scan.mjs: skillsLint gained the lesson pass -> LESSON_WHAT_CHANGED_MISSING')
    const r = lint(dir)
    assert.equal(r.ok, true, JSON.stringify(r.findings))
  } finally { rmDir(dir) }
})

test('an ungraduated lesson is exempt: nothing was applied, nothing to show', () => {
  const dir = tempDir('lesson3')
  try {
    writeLesson(dir, 'open-lesson', 'false', '- file: <before> -> <after>   (template, never filled)')
    const r = lint(dir)
    assert.equal(r.ok, true, JSON.stringify(r.findings))
  } finally { rmDir(dir) }
})

test('a repo without the feedback directory stays exempt', () => {
  const dir = tempDir('lesson4')
  try {
    const r = lint(dir)
    assert.equal(r.ok, true, JSON.stringify(r.findings))
  } finally { rmDir(dir) }
})
