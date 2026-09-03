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
  for (const d of ['.dsh/base/state', '.dsh/base/receipts', '.dsh/base/waivers', '.dsh/base/evidence']) {
    assert.ok(DIFF_EXCLUDED.some(p => p === d + '/**'), d + ' must be in DIFF_EXCLUDED')
    assert.ok(denied(d + '/x.json'), d + ' must be denied from context packs')
  }
  assert.ok(DIFF_EXCLUDED.includes('.dsh/base/trend/**'), 'trend stays out of the fingerprint')
  assert.equal(denied('.dsh/base/trend/arch-trend.jsonl'), false, 'trend is the committed shared debt ledger and stays packable')
})

test('the fingerprint exclusion really applies to runtime paths', () => {
  assert.ok(matchesAny('.dsh/base/state/ledger.jsonl', DIFF_EXCLUDED))
  assert.ok(matchesAny('.dsh/base/evidence/gate-1.log', DIFF_EXCLUDED))
  assert.equal(matchesAny('src/a.mjs', DIFF_EXCLUDED), false)
})
