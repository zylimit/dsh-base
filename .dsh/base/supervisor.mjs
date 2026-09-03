#!/usr/bin/env node
// dsh-base :: dev-process supervisor. Zero dependencies, Node standard library.
//
// Guards a long-running development process: a crash is restarted with
// exponential backoff, an optional HTTP health probe kills a wedged-but-alive
// child, and a restart storm trips a circuit breaker that fails visibly
// instead of looping forever. It is a dev guardrail, not a production init:
// the real answer to availability is systemd/k8s, and this file says so.
//
//   node .dsh/base/supervisor.mjs start [--name n] [--health-url u]
//       [--max-restarts n] [--backoff-ms n] [--probe-interval-ms n] -- <prog> [args...]
//   node .dsh/base/supervisor.mjs status [--name n]
//   node .dsh/base/supervisor.mjs stop   [--name n]
//
// status reports pid liveness, not recorded state: a supervisor killed by
// kill -9 leaves a stale file behind, and stale is not alive.

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'

const BASE = path.join(process.cwd(), '.dsh', 'base')
const STATE_DIR = path.join(BASE, 'state')

const args = process.argv.slice(2)
const cmd = args[0]
let name = 'default'
let healthUrl = null
let maxRestarts = 5
let backoffMs = 1000
let probeIntervalMs = 3000
const childCmd = []
let i = 1
while (i < args.length) {
  const a = args[i]
  if (a === '--') { childCmd.push(...args.slice(i + 1)); break }
  if (a === '--name') name = args[++i]
  else if (a === '--health-url') healthUrl = args[++i]
  else if (a === '--max-restarts') maxRestarts = Number(args[++i])
  else if (a === '--backoff-ms') backoffMs = Number(args[++i])
  else if (a === '--probe-interval-ms') probeIntervalMs = Number(args[++i])
  else childCmd.push(a)
  i++
}

const statePath = (n) => path.join(STATE_DIR, 'supervisor-' + n + '.json')
const stopPath = (n) => path.join(STATE_DIR, 'supervisor-' + n + '.stop')

function readState (n) {
  try { return JSON.parse(fs.readFileSync(statePath(n), 'utf8')) } catch { return null }
}
function writeState (n, s) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.writeFileSync(statePath(n), JSON.stringify(s, null, 2))
}
function alive (pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
function probe (url) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: 2000 }, res => { res.resume(); resolve(res.statusCode < 500) })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

function out (obj) { process.stdout.write(JSON.stringify(obj) + '\n') }

if (cmd === 'status') {
  const s = readState(name)
  if (!s) { out({ command: 'supervisor', name, running: false, state: 'absent' }); process.exit(0) }
  const running = s.state === 'running' && alive(s.pid)
  out({ command: 'supervisor', name, running, state: running ? 'running' : (s.state || 'stopped'), pid: s.pid, restarts: s.restarts, probeKills: s.probeKills || 0, lastExit: s.lastExit ?? null, cmd: s.cmd })
  process.exit(running || s.state === 'stopped' ? 0 : 1)
}

if (cmd === 'stop') {
  const s = readState(name)
  fs.writeFileSync(stopPath(name), String(Date.now()))
  if (s && alive(s.pid)) { try { process.kill(s.pid) } catch { /* already gone */ } }
  out({ command: 'supervisor', name, stopRequested: true })
  process.exit(0)
}

if (cmd === 'start') {
  if (childCmd.length === 0) {
    process.stderr.write('supervisor: usage: supervisor.mjs start [options] -- <program> [args...]\n')
    process.exit(2)
  }
  fs.rmSync(stopPath(name), { force: true })
  let restarts = 0
  let probeKills = 0
  let consecutiveProbeFails = 0
  let lastExit = null
  let child = null
  let probeTimer = null

  // Every child gets its own exit handler: a listener attached only to the
  // first child lets the process drain its event loop and exit 0 on the
  // second crash, which is the exact false green this loop exists to prevent.
  const launch = () => {
    child = spawn(childCmd[0], childCmd.slice(1), { stdio: 'inherit', windowsHide: false })
    writeState(name, { state: 'running', pid: child.pid, startedAt: new Date().toISOString(), restarts, probeKills, lastExit, cmd: childCmd.join(' ') })
    child.on('exit', (code, signal) => {
      lastExit = code === null ? 'signal:' + signal : code
      if (fs.existsSync(stopPath(name))) {
        writeState(name, { ...readState(name), state: 'stopped', lastExit })
        if (probeTimer) clearInterval(probeTimer)
        process.exit(0)
      }
      restarts++
      if (restarts > maxRestarts) {
        writeState(name, { ...readState(name), state: 'crashed', restarts, lastExit })
        if (probeTimer) clearInterval(probeTimer)
        process.stderr.write('supervisor: restart storm (' + restarts + ' restarts, cap ' + maxRestarts + '); last exit ' + lastExit + '. This is a fail-visible breaker, not a loop.\n')
        process.exit(1)
      }
      const delay = Math.min(30000, backoffMs * Math.pow(2, restarts - 1))
      setTimeout(() => launch(), delay)
    })
    return child
  }

  launch()
  if (healthUrl) {
    probeTimer = setInterval(async () => {
      const ok = await probe(healthUrl)
      if (ok) { consecutiveProbeFails = 0; return }
      consecutiveProbeFails++
      if (consecutiveProbeFails >= 3) {
        consecutiveProbeFails = 0
        probeKills++
        writeState(name, { ...readState(name), probeKills })
        try { child.kill() } catch { /* already gone */ }
      }
    }, probeIntervalMs)
  }
} else {
  process.stderr.write('supervisor: usage: supervisor.mjs start|stop|status [options]\n')
  process.exit(2)
}
