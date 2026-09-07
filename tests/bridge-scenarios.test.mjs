// Bridge validation battery: every scenario class from the real session
// history must be covered by the skill that owns it, and every bridge skill
// must carry a counterexample showing the default failure it exists to prevent.
// Content-level pins, not simulated conversations: a scripted dialogue would
// prove the test author's expectations, never the skill's behaviour.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from './helpers.mjs'

const SKILL = (name) => fs.readFileSync(path.join(REPO, '.dsh', 'skills', name, 'SKILL.md'), 'utf8')
const BRIDGE_SKILLS = [
  'requirements-elicitation', 'progress-ledger', 'scoped-implementation',
  'work-planning', 'architecture-design', 'dsb-operating-loop', 'feedback-and-evolution',
]

// Scenario classes taken from the real session history (dates in progress.md).
// Each maps to the skill that must carry the compressed real exchange.
const SCENARIOS = [
  { id: 'S1', event: '2026-08/09: "make me a calculator" -> WHY-dig, not solution-jump', skill: 'requirements-elicitation', pattern: /make me a calculator/ },
  { id: 'S2', event: 'user rejects the depth; the correction becomes named edits, not an apology', skill: 'requirements-elicitation', pattern: /cut three things/ },
  { id: 'S3', event: 'user: "算个屁" on the size argument; the law was rewritten, not noted', skill: 'progress-ledger', pattern: /算个屁/ },
  { id: 'S4', event: 'user: "三轮直接往下" autonomy mandate recorded in Pinned so no re-ask', skill: 'progress-ledger', pattern: /三轮直接往下/ },
  { id: 'S5', event: 'tradeoff explained, human chooses, the upgrade trigger is named', skill: 'architecture-design', pattern: /先同步/ },
  { id: 'S6', event: 'correction visibility: the user sees exactly what their instruction changed', skill: 'feedback-and-evolution', pattern: /What changed \(shown to the human\)/ },
  { id: 'S7', event: 'handoff convergence: the next role receives named artifacts, not vibes', skill: 'requirements-elicitation', pattern: /PRODUCT-SPEC\.md/ },
  { id: 'S8', event: 'business-meaning contradiction: fix upstream in the same change, never silently', skill: 'scoped-implementation', pattern: /rewrites an executed FAIL/ },
  { id: 'S9', event: 'memory of rationale: a Decision without the rejected alternative is a status update', skill: 'progress-ledger', pattern: /rejected alternative/ },
  { id: 'S10', event: 'adaptive interaction depth: Advance / Explore / Learn with triggers', skill: 'dsb-operating-loop', pattern: /Advance/ },
]

for (const s of SCENARIOS) {
  test(s.id + ' scenario is covered by ' + s.skill + ' (' + s.event + ')', () => {
    const body = SKILL(s.skill)
    assert.match(body, s.pattern, s.skill + ' must carry the real exchange for this scenario class')
  })
}

test('every bridge skill shows a counterexample: the default failure it prevents', () => {
  for (const name of BRIDGE_SKILLS) {
    const body = SKILL(name)
    assert.match(body, /Counterexample/i, name + ': a bridge skill without a counterexample teaches the right move without naming the wrong one')
    assert.match(body, /-> What happened|-> why/i, name + ': the counterexample must state why the move fails')
  }
})

test('every bridge skill names convergence: the correction ends as a visible change', () => {
  for (const name of BRIDGE_SKILLS) {
    const body = SKILL(name)
    assert.match(body, /-> What happened/i, name + ': each exchange must close with what observably changed')
  }
})
