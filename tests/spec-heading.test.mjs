// Only a heading declares a requirement. A prose mention of an id is a
// citation, and counting it as a declaration manufactures a phantom
// requirement that every downstream gate then chases.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { tempDir, rmDir, REPO } from './helpers.mjs'

test('spec-lint counts only heading declarations, not prose citations', () => {
  const dir = tempDir('spechead')
  try {
    fs.mkdirSync(path.join(dir, 'docs', 'requirements'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docs', 'requirements', 'PRODUCT-SPEC.md'), [
      '# spec',
      '',
      '### ' + 'REQ-' + 'HEAD-001' + ' - one',
      '',
      'WHEN the program runs, the system SHALL return one.',
      '',
      'Acceptance: the value is 1.',
      '',
      'See also ' + 'REQ-' + 'PROSE-001' + ' for the legacy behaviour, superseded by the above.',
      '',
      'resilience security safety privacy reliability are declared in scope with tests.',
    ].join('\n'))
    // The engine ROOT is fixed at import, so lint inside a fixture-cwd subprocess.
    const probe = "import('" + pathToFileURL(path.join(REPO, '.dsh', 'base', 'lib', 'scan.mjs')).href + "').then(m => console.log(JSON.stringify(m.specLint({ trace: { requirementDirs: ['docs/requirements'] } }))))"
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: dir, encoding: 'utf8', windowsHide: true })
    const out = JSON.parse(r.stdout)
    assert.equal(out.ids.length, 1, 'the prose mention must not declare a requirement: ' + JSON.stringify(out.ids))
    assert.equal(out.ids[0].id, 'REQ-' + 'HEAD-001')
  } finally { rmDir(dir) }
})
