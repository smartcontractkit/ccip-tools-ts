import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { manualExecSchema } from '../schemas/manual-exec.schema.ts'
import { GROUP_ORDER } from './groups.ts'

describe('CLI Builder option groups', () => {
  it('should render the group holding the verification flags', () => {
    // The builder renders only the groups in GROUP_ORDER and drops the rest with no error, so a
    // flag in an unregistered group is invisible on the page.
    const verification = manualExecSchema.options.filter((opt) => opt.group === 'verification')
    assert.deepEqual(verification.map((opt) => opt.name).sort(), ['ccv-data', 'verifier'])
    assert.ok(GROUP_ORDER.includes('verification'))
  })
})
