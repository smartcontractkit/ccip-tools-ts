import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { extractCreatedContractId } from './events.ts'

describe('extractCreatedContractId', () => {
  it('finds CCIPReceiver contract id in gRPC-style Created events', () => {
    const tx = {
      events: [
        {
          CreatedEvent: {
            contractId: 'cid-receiver-new',
            templateId: {
              entityName: 'CCIPReceiver',
            },
          },
        },
      ],
    }
    assert.equal(extractCreatedContractId(tx, 'CCIPReceiver'), 'cid-receiver-new')
  })

  it('returns undefined when no matching template is created', () => {
    const tx = {
      events: [
        {
          CreatedEvent: {
            contractId: 'cid-other',
            templateId: { entityName: 'PerPartyRouter' },
          },
        },
      ],
    }
    assert.equal(extractCreatedContractId(tx, 'CCIPReceiver'), undefined)
  })
})
