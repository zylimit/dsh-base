// The runtime-directory tables must not drift apart silently: the four runtime
// dirs are excluded from the fingerprint AND denied from context packs, while
// trend is deliberately fingerprint-excluded but pack-allowable. Move anything
// between these sets by changing this test in the same commit - the siblings'
// lesson is that duplicated rule tables drift, and drift is always silent.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DIFF_EXCLUDED, matchesAny } from '../.dsh/base/lib/core.mjs'
import { denied } from '../.dsh/base/lib/context.mjs'

test('every runtime dir excluded from the fingerprint is denied from packs, except trend by design', () => {
  // The sibling lesson (their 9c5cc2e): a guard that checks a fixed list of
  // names gives false security - an arm added to one table without the other
  // sails past it. Iterate the tables exhaustively so a one-sided addition
  // fails loudly.
  const runtimeInFingerprint = DIFF_EXCLUDED.filter(p => p.startsWith('.dsh/base/'))
  assert.ok(runtimeInFingerprint.length >= 5, 'the fingerprint table must name the runtime dirs')
  for (const p of runtimeInFingerprint) {
    const dir = p.replace(/\/\*\*$/, '')
    if (dir === '.dsh/base/trend') continue
    assert.ok(denied(dir + '/x.json'), dir + ' is fingerprint-excluded but packable; add it to CONTEXT_DENY or change this test')
  }
  assert.ok(DIFF_EXCLUDED.includes('.dsh/base/trend/**'), 'trend stays out of the fingerprint')
  assert.equal(denied('.dsh/base/trend/arch-trend.jsonl'), false, 'trend is the committed shared debt ledger and stays packable')
  // The reverse direction: a runtime dir denied from packs must be excluded
  // from the fingerprint too, or receipts would bind evidence that can never
  // be packed.
  const denyRuntime = ['.dsh/base/state', '.dsh/base/receipts', '.dsh/base/waivers', '.dsh/base/evidence']
  for (const d of denyRuntime) {
    assert.ok(denied(d + '/x.json'), d + ' must be denied from context packs')
    assert.ok(DIFF_EXCLUDED.includes(d + '/**'), d + ' is pack-denied but fingerprint-included')
  }
})

test('the fingerprint exclusion really applies to runtime paths', () => {
  assert.ok(matchesAny('.dsh/base/state/ledger.jsonl', DIFF_EXCLUDED))
  assert.ok(matchesAny('.dsh/base/evidence/gate-1.log', DIFF_EXCLUDED))
  assert.equal(matchesAny('src/a.mjs', DIFF_EXCLUDED), false)
})
