import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey } from '@solana/web3.js'
import { hexlify } from 'ethers'

import { CCIPAddressInvalidError } from '../errors/specialized.ts'
import { EVMChain } from '../evm/index.ts'
import {
  type GenericExtraArgsV3,
  type SVMExtraArgsV1,
  GenericExtraArgsV3Tag,
} from '../extra-args.ts'
import { SolanaChain } from './index.ts'

describe('SolanaChain.buildMessageForDest', () => {
  it('should populate SVMExtraArgsV1 with computeUnits from gasLimit', () => {
    const message = {
      receiver: 'So11111111111111111111111111111111111111112',
      data: '0x1234',
      extraArgs: {
        gasLimit: 100000n,
      },
    }

    const result = SolanaChain.buildMessageForDest(message)

    assert.ok(result.extraArgs)
    const extraArgs = result.extraArgs as SVMExtraArgsV1
    assert.equal(extraArgs.computeUnits, 100000n)
    assert.equal(extraArgs.allowOutOfOrderExecution, true)
    assert.equal(extraArgs.tokenReceiver, '11111111111111111111111111111111')
    assert.deepEqual(extraArgs.accounts, [])
    assert.equal(extraArgs.accountIsWritableBitmap, 0n)
  })

  it('should use computeUnits if provided directly', () => {
    const message = {
      receiver: 'So11111111111111111111111111111111111111112',
      data: '0x1234',
      extraArgs: {
        computeUnits: 250000n,
      } as any,
    }

    const result = SolanaChain.buildMessageForDest(message)

    const extraArgs = result.extraArgs as SVMExtraArgsV1
    assert.equal(extraArgs.computeUnits, 250000n)
  })

  it('should prefer computeUnits over gasLimit if both provided', () => {
    const message = {
      receiver: 'So11111111111111111111111111111111111111112',
      data: '0x1234',
      extraArgs: {
        computeUnits: 150000n,
        gasLimit: 100000n,
      },
    }

    const result = SolanaChain.buildMessageForDest(message)

    const extraArgs = result.extraArgs as SVMExtraArgsV1
    assert.equal(extraArgs.computeUnits, 150000n)
  })

  it('should use DEFAULT_GAS_LIMIT for computeUnits when data present and no gas specified', () => {
    const message = {
      receiver: 'So11111111111111111111111111111111111111112',
      data: '0xabcd',
    }

    const result = SolanaChain.buildMessageForDest(message)

    const extraArgs = result.extraArgs as SVMExtraArgsV1
    assert.equal(extraArgs.computeUnits, 200000n) // DEFAULT_GAS_LIMIT
  })

  it('should set computeUnits to 0 when no data', () => {
    const message = {
      receiver: 'So11111111111111111111111111111111111111112',
    }

    const result = SolanaChain.buildMessageForDest(message)

    const extraArgs = result.extraArgs as SVMExtraArgsV1
    assert.equal(extraArgs.computeUnits, 0n)
  })

  it('should throw on unknown fields for SVMExtraArgsV1', () => {
    const message = {
      receiver: 'So11111111111111111111111111111111111111112',
      data: '0x1234',
      extraArgs: {
        gasLimit: 100000n,
        someOtherField: 'should not appear',
      },
    }

    assert.throws(
      () => SolanaChain.buildMessageForDest(message),
      /unknown field.*SVMExtraArgsV1.*"someOtherField"/i,
    )
  })

  it('should use custom tokenReceiver when provided', () => {
    const customReceiver = 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C'
    const message = {
      receiver: 'So11111111111111111111111111111111111111112',
      data: '0x1234',
      extraArgs: {
        tokenReceiver: customReceiver,
      } as any,
    }

    const result = SolanaChain.buildMessageForDest(message)

    const extraArgs = result.extraArgs as SVMExtraArgsV1
    assert.equal(extraArgs.tokenReceiver, customReceiver)
  })

  it('should set tokenReceiver to receiver when tokenAmounts present', () => {
    const receiverAddr = '11111111111111111111111111111112' // Valid base58 Solana address
    const message = {
      receiver: receiverAddr,
      tokenAmounts: [{ token: 'TokenMint123', amount: 100n }],
    }

    const result = SolanaChain.buildMessageForDest(message)

    const extraArgs = result.extraArgs as SVMExtraArgsV1
    assert.equal(extraArgs.tokenReceiver, receiverAddr)
    assert.equal(result.receiver, '11111111111111111111111111111111') // default PublicKey when tokens
  })

  it('should throw error when sending tokens with data but no tokenReceiver', () => {
    const message = {
      receiver: 'So11111111111111111111111111111111111111112',
      data: '0x1234',
      tokenAmounts: [{ token: 'TokenMint123', amount: 100n }],
    }

    assert.throws(
      () => SolanaChain.buildMessageForDest(message),
      /tokenReceiver.*required when sending tokens with data to Solana/i,
    )
  })

  it('should accept accounts array', () => {
    const accounts = [
      'Account1111111111111111111111111111111111112',
      'Account2222222222222222222222222222222222212',
    ]
    const message = {
      receiver: 'So11111111111111111111111111111111111111112',
      data: '0x1234',
      extraArgs: {
        accounts,
      } as any,
    }

    const result = SolanaChain.buildMessageForDest(message)

    const extraArgs = result.extraArgs as SVMExtraArgsV1
    assert.deepEqual(extraArgs.accounts, accounts)
  })

  it('should accept accountIsWritableBitmap', () => {
    const bitmap = 0b1010n
    const message = {
      receiver: 'So11111111111111111111111111111111111111112',
      data: '0x1234',
      extraArgs: {
        accountIsWritableBitmap: bitmap,
      } as any,
    }

    const result = SolanaChain.buildMessageForDest(message)

    const extraArgs = result.extraArgs as SVMExtraArgsV1
    assert.equal(extraArgs.accountIsWritableBitmap, bitmap)
  })

  it('should accept explicit receiver', () => {
    const message = {
      receiver: 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C',
      tokenAmounts: [{ token: 'TokenMint123', amount: 100n }],
      extraArgs: {
        tokenReceiver: 'So11111111111111111111111111111111111111112',
      },
    }

    const result = SolanaChain.buildMessageForDest(message)

    assert.equal(result.receiver, 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C')
  })

  it('should allow custom allowOutOfOrderExecution', () => {
    const message = {
      receiver: PublicKey.default.toBase58(),
      data: '0x1234',
      extraArgs: {
        allowOutOfOrderExecution: false,
      } as any,
    }

    const result = SolanaChain.buildMessageForDest(message)

    const extraArgs = result.extraArgs as SVMExtraArgsV1
    assert.equal(extraArgs.allowOutOfOrderExecution, false)
  })

  it('should throw CCIPAddressInvalidError for malformed Solana receiver', () => {
    // A valid EVM address passed to a Solana destination should be rejected
    const message = {
      receiver: '0x1234567890123456789012345678901234567890',
    }

    assert.throws(
      () => SolanaChain.buildMessageForDest(message),
      (err: unknown) => err instanceof CCIPAddressInvalidError && err.context.family === 'SVM',
    )
  })

  describe('GenericExtraArgsV3, for CCIP 2.0 lanes', () => {
    const wallet = 'GVuEzxzvpVQr9RTwNguw4AcZSZmGiP9EWaRPkp8x6Xrx'
    const noExecutor = '0xEBa517d200000000000000000000000000000000'
    // SVMExecutorArgsV1: tag, useATA (derive and create), writable bitmap (u64 BE), no accounts
    const noAccounts = '0x1a2b3c4d' + '00' + '00'.repeat(8) + '00'

    it('is built for any field SVMExtraArgsV1 lacks, like executor', () => {
      const result = SolanaChain.buildMessageForDest({
        receiver: wallet,
        tokenAmounts: [{ token: 'TokenMint123', amount: 100n }],
        extraArgs: {
          executor: noExecutor,
          ccvs: ['0x0849847ff1d46E2dca6DB46Bc36A69E228709805'],
        },
      })

      // tokens without tokenReceiver go to the receiver, which is left out, as for SVMExtraArgsV1
      assert.equal(result.receiver, PublicKey.default.toBase58())
      assert.deepEqual(result.extraArgs, {
        gasLimit: 0n,
        finality: 'finalized',
        ccvs: ['0x0849847ff1d46E2dca6DB46Bc36A69E228709805'],
        ccvArgs: [],
        executor: noExecutor,
        executorArgs: noAccounts,
        tokenReceiver: wallet,
        tokenArgs: '0x',
      })
    })

    it("puts the receiver's accounts in the executorArgs", () => {
      const accounts = [
        'Account1111111111111111111111111111111111112',
        'Account2222222222222222222222222222222222212',
      ]
      const result = SolanaChain.buildMessageForDest({
        receiver: wallet,
        data: '0x1234',
        extraArgs: {
          finality: 'safe',
          accounts,
          accountIsWritableBitmap: 0b10n,
        },
      })
      const extraArgs = result.extraArgs as GenericExtraArgsV3

      assert.equal(result.receiver, wallet)
      assert.equal(extraArgs.gasLimit, 200000n) // DEFAULT_GAS_LIMIT, for the data
      assert.equal(extraArgs.finality, 'safe')
      assert.equal(extraArgs.tokenReceiver, '')
      assert.equal(
        extraArgs.executorArgs,
        '0x1a2b3c4d' +
          '00' +
          '0000000000000002' +
          '02' +
          accounts.map((a) => hexlify(new PublicKey(a).toBytes()).slice(2)).join(''),
      )
    })

    it('keeps explicit executorArgs and computeUnits', () => {
      const result = SolanaChain.buildMessageForDest({
        receiver: wallet,
        data: '0x1234',
        extraArgs: {
          executor: noExecutor,
          executorArgs: '0x1234',
          computeUnits: 5n,
        } as any,
      })
      const extraArgs = result.extraArgs as GenericExtraArgsV3
      assert.equal(extraArgs.executorArgs, '0x1234')
      assert.equal(extraArgs.gasLimit, 5n)
    })

    it('encodes as GenericExtraArgsV3 from EVM', () => {
      const { extraArgs } = SolanaChain.buildMessageForDest({
        receiver: wallet,
        extraArgs: { executor: noExecutor },
      })
      const encoded = EVMChain.encodeExtraArgs(extraArgs)
      assert.ok(encoded.startsWith(GenericExtraArgsV3Tag))
      assert.deepEqual(EVMChain.decodeExtraArgs(encoded), {
        ...extraArgs,
        _tag: 'GenericExtraArgsV3',
      })
    })

    it('rejects allowOutOfOrderExecution, which 2.0 lanes lack', () => {
      assert.throws(
        () =>
          SolanaChain.buildMessageForDest({
            receiver: wallet,
            extraArgs: { executor: noExecutor, allowOutOfOrderExecution: true },
          }),
        /unknown field.*GenericExtraArgsV3.*"allowOutOfOrderExecution"/i,
      )
    })
  })
})
