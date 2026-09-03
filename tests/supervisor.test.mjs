// The dev-process supervisor: a crash restarts with backoff, a wedged-but-alive
// child is killed by the health probe, a restart storm fails visibly, and stop
// terminates the child cleanly. Status reports pid liveness, not stale records.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { tempDir, rmDir, REPO } from './helpers.mjs'

const SUP = path.join(REPO, '.dsh', 'base', 'supervisor.mjs')

function fixture (script) {
  const dir = tempDir('sup')
  fs.mkdirSync(path.join(dir, '.dsh', 'base'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'child.mjs'), script)
  return dir
}

function sup (dir, args, opts = {}) {
  return spawnSync(process.execPath, [SUP, ...args], { cwd: dir, encoding: 'utf8', windowsHide: true, ...opts })
}

test('a corrupt supervisor state file is quarantined and reported, never read as absent', () => {
  const dir = fixture('setInterval(() => {}, 1000)\n')
  try {
    fs.mkdirSync(path.join(dir, '.dsh', 'base', 'state'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.dsh', 'base', 'state', 'supervisor-z.json'), '{ not json')
    const r = sup(dir, ['status', '--name', 'z'])
    assert.equal(r.status, 1, 'a corrupt state must not read as a clean absence: ' + r.stdout + r.stderr)
    const json = JSON.parse(r.stdout)
    assert.equal(json.state, 'corrupt')
    assert.equal(json.running, false)
    const leftovers = fs.readdirSync(path.join(dir, '.dsh', 'base', 'state')).filter(f => f.startsWith('supervisor-z.json.corrupt-'))
    assert.equal(leftovers.length, 1, 'the corrupt state is moved aside, not deleted')
    const q = fs.readFileSync(path.join(dir, '.dsh', 'base', 'state', 'quarantine.jsonl'), 'utf8')
    assert.match(q, /corrupt supervisor state/)
  } finally { rmDir(dir) }
})

test('a crashing child restarts with backoff and the storm breaker fails visibly', () => {
  const dir = fixture('process.exit(1)\n')
  try {
    const r = sup(dir, ['start', '--name', 'crash', '--max-restarts', '3', '--backoff-ms', '20', '--', process.execPath, 'child.mjs'], { timeout: 20000 })
    assert.equal(r.status, 1, 'the storm breaker is a fail-visible exit, not a loop: ' + r.stdout + r.stderr)
    const s = JSON.parse(fs.readFileSync(path.join(dir, '.dsh', 'base', 'state', 'supervisor-crash.json'), 'utf8'))
    assert.equal(s.state, 'crashed')
    assert.ok(s.restarts > 3, 'restarts counted: ' + JSON.stringify(s))
  } finally { rmDir(dir) }
})

test('a wedged-but-alive child is killed by the health probe', () => {
  const dir = fixture([
    "const http = require('http')",
    "http.createServer((q, s) => { s.statusCode = 500; s.end() }).listen(Number(process.env.PORT))",
  ].join('\n'))
  try {
    const port = freePort()
    const r = sup(dir, ['start', '--name', 'wedged', '--max-restarts', '2', '--backoff-ms', '20', '--probe-interval-ms', '40', '--health-url', 'http://127.0.0.1:' + port + '/health', '--', process.execPath, 'child.mjs'],
      { timeout: 20000, env: { ...process.env, PORT: String(port) } })
    assert.equal(r.status, 1)
    const s = JSON.parse(fs.readFileSync(path.join(dir, '.dsh', 'base', 'state', 'supervisor-wedged.json'), 'utf8'))
    assert.equal(s.state, 'crashed')
    assert.ok(s.probeKills >= 1, 'the probe must kill the wedged child: ' + JSON.stringify(s))
  } finally { rmDir(dir) }
})

test('stop during the backoff window is honoured: no relaunch after the flag lands', async () => {
  const dir = fixture('process.exit(1)\n')
  try {
    const p = spawn(process.execPath, [SUP, 'start', '--name', 'bw', '--max-restarts', '5', '--backoff-ms', '2000', '--', process.execPath, 'child.mjs'], { cwd: dir, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] })
    let state = null
    for (let i = 0; i < 200 && !(state && state.restarts >= 1); i++) {
      await new Promise(r => setTimeout(r, 25))
      try { state = JSON.parse(fs.readFileSync(path.join(dir, '.dsh', 'base', 'state', 'supervisor-bw.json'), 'utf8')) } catch { state = null }
    }
    assert.ok(state && state.restarts >= 1, 'the child must have crashed once: ' + JSON.stringify(state))
    const pidAfterFirstCrash = state.pid
    const st = sup(dir, ['stop', '--name', 'bw'])
    assert.equal(st.status, 0, st.stdout + st.stderr)
    const code = await new Promise(resolve => {
      const t = setTimeout(() => resolve('timeout'), 8000)
      p.on('exit', (c) => { clearTimeout(t); resolve(c) })
    })
    assert.equal(code, 0, 'stop must win over the pending backoff timer')
    const after = JSON.parse(fs.readFileSync(path.join(dir, '.dsh', 'base', 'state', 'supervisor-bw.json'), 'utf8'))
    assert.equal(after.state, 'stopped')
    assert.equal(after.pid, pidAfterFirstCrash, 'the backoff timer must not have relaunched the child after the stop flag landed')
  } finally {
    sup(dir, ['stop', '--name', 'bw'])
    rmDir(dir)
  }
})

test('stop terminates the child and the supervisor exits cleanly', async () => {
  const dir = fixture('setInterval(() => {}, 1000)\n')
  try {
    const p = spawn(process.execPath, [SUP, 'start', '--name', 'long', '--', process.execPath, 'child.mjs'], { cwd: dir, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] })
    let state = null
    for (let i = 0; i < 100 && !(state && state.state === 'running'); i++) {
      await new Promise(r => setTimeout(r, 50))
      try { state = JSON.parse(fs.readFileSync(path.join(dir, '.dsh', 'base', 'state', 'supervisor-long.json'), 'utf8')) } catch { state = null }
    }
    assert.ok(state && state.state === 'running', 'the supervisor must be running the child')
    assert.ok(state.pid > 0)
    const st = sup(dir, ['stop', '--name', 'long'])
    assert.equal(st.status, 0, st.stdout + st.stderr)
    const code = await new Promise(resolve => {
      const t = setTimeout(() => resolve('timeout'), 5000)
      p.on('exit', (c) => { clearTimeout(t); resolve(c) })
    })
    assert.equal(code, 0, 'the supervisor exits cleanly after stop')
    const after = JSON.parse(fs.readFileSync(path.join(dir, '.dsh', 'base', 'state', 'supervisor-long.json'), 'utf8'))
    assert.equal(after.state, 'stopped')
    const st2 = sup(dir, ['status', '--name', 'long'])
    assert.equal(st2.status, 0)
    assert.equal(JSON.parse(st2.stdout).running, false)
  } finally {
    sup(dir, ['stop', '--name', 'long'])
    rmDir(dir)
  }
})

function freePort () {
  const r = spawnSync(process.execPath, ['-e', "require('net').createServer().listen(0, function(){ process.stdout.write(String(this.address().port)); this.close() })"], { encoding: 'utf8', windowsHide: true })
  return Number(r.stdout.trim())
}
