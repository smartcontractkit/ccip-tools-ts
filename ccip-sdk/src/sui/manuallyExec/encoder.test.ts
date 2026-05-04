import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ExecutionInput } from '../../types.ts'
import type { CCIPMessage_V1_6_Sui } from '../types.ts'
import { serializeExecutionReport } from './encoder.ts'

describe('Sui manual exec encoder', () => {
  it('accepts TON raw sender addresses', () => {
    const report: ExecutionInput<CCIPMessage_V1_6_Sui> = {
      message: {
        messageId: '0x' + '11'.repeat(32),
        sourceChainSelector: 1399300952838017768n,
        destChainSelector: 21n,
        sequenceNumber: 18n,
        nonce: 0n,
        sender: '0:358280f2b46935d7470439a34fd234cc8617f2019018545383a74b03b9035174',
        receiver: '0x' + '22'.repeat(32),
        data: '0x48656c6c6f',
        extraArgs: '0x',
        gasLimit: 50000n,
        allowOutOfOrderExecution: false,
        tokenReceiver: '0x' + '33'.repeat(32),
        receiverObjectIds: [],
        feeToken: '0x',
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
        tokenAmounts: [],
      },
      offchainTokenData: [],
      proofs: [],
      proofFlagBits: 0n,
      merkleRoot: '0x' + '00'.repeat(32),
    }

    assert.doesNotThrow(() => serializeExecutionReport(report))
  })
})