#!/usr/bin/env node
// Test launcher for every supported Node version.
//
// Node 20's test runner does not expand glob patterns; "node --test
// tests/*.test.mjs" fails there as a literal path while Node 22+ glob it
// themselves. This launcher expands the pattern with the standard library and
// passes explicit file arguments, so the same command works on 20, 22 and 24,
// on Windows and on Linux.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const dir = path.join(root, 'tests')
if (!fs.existsSync(dir)) {
  process.stderr.write('run-tests: no tests directory at ' + dir + '\n')
  process.exit(3)
}
const files = fs.readdirSync(dir)
  .filter(f => /\.test\.mjs$/.test(f))
  .sort()
  .map(f => path.join('tests', f))

if (files.length === 0) {
  process.stderr.write('run-tests: no *.test.mjs files under tests/; nothing ran, so nothing is proven\n')
  process.exit(3)
}

const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(r.status === null ? 1 : r.status)
