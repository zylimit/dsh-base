// Shared test helpers. Node standard library only (see tests/AGENTS.md).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'

export const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')

/** Run a dsb subcommand and return its exit code plus the parsed stdout JSON. */
export function dsb (args, opts = {}) {
  const r = spawnSync(process.execPath, [path.join(REPO, '.dsh', 'base', 'dsb.mjs'), ...args], {
    cwd: opts.cwd || REPO,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, DSB_ROOT: opts.cwd || REPO },
    input: opts.input,
  })
  let json = null
  const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop()
  if (line) { try { json = JSON.parse(line) } catch { json = null } }
  return { code: r.status, json, stdout: r.stdout || '', stderr: r.stderr || '' }
}

export function script (name, args = [], opts = {}) {
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', name), ...args], {
    cwd: opts.cwd || REPO, encoding: 'utf8', windowsHide: true,
  })
  let json = null
  const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop()
  if (line) { try { json = JSON.parse(line) } catch { json = null } }
  return { code: r.status, json, stdout: r.stdout || '', stderr: r.stderr || '' }
}

/** A throwaway directory outside the repository. Never mutate the host tree. */
export function tempDir (label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsb-' + label + '-'))
}

export function rmDir (dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* the OS reclaims it */ }
}
