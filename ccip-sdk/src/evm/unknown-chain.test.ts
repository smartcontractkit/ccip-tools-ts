import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { ZeroAddress, ZeroHash } from 'ethers'

import { CCIPChainNotFoundError } from '../errors/pure.ts'
import { clearNetworkInfoCaches, registerChains } from '../networks.ts'
import SELECTORS from '../selectors.ts'
import { interfaces } from './const.ts'
import { encodeMessageV1 } from './messageCodec.ts'
import { EVMChain } from './index.ts'

import '../index.ts'

// the scratch-mode local devnet: source 1337 is bundled (geth-testnet), dest 2337 is not
const SRC_SELECTOR = 3379446385462418246n
const DST_CHAIN_ID = 2337
const DST_SELECTOR = 12922642891491394802n

function v2MessageSentLog(destChainSelector: bigint) {
  const encodedMessage = encodeMessageV1({
    sourceChainSelector: SRC_SELECTOR,
    destChainSelector,
    messageNumber: 7n,
    executionGasLimit: 0,
    ccipReceiveGasLimit: 200_000,
    finality: '0x00000000',
    ccvAndExecutorHash: ZeroHash,
    onRampAddress: ZeroHash,
    offRampAddress: '0xe60c1d654283252623e448f53f648663a701cd7b',
    sender: ZeroHash,
    receiver: '0x161d23c30b5ae2899c3d4d969ba2b82026f3954a',
    data: '0xabcd',
  })
  const fragment = interfaces.OnRamp_v2_0.getEvent('CCIPMessageSent')!
  return interfaces.OnRamp_v2_0.encodeEventLog(fragment, [
    destChainSelector,
    ZeroAddress, // sender
    ZeroHash, // messageId
    ZeroAddress, // feeToken
    0n, // tokenAmountBeforeTokenPoolFees
    encodedMessage,
    [], // receipts
    [], // verifierBlobs
  ])
}

describe('EVMChain.decodeMessage on an unbundled chain', () => {
  afterEach(() => {
    delete SELECTORS[String(DST_CHAIN_ID)]
    clearNetworkInfoCaches()
  })

  it('surfaces the real CHAIN_NOT_FOUND instead of masking it as MESSAGE_INVALID', () => {
    const log = v2MessageSentLog(DST_SELECTOR)
    assert.throws(
      () => EVMChain.decodeMessage(log),
      (err: unknown) => {
        assert.ok(
          err instanceof CCIPChainNotFoundError,
          `expected CHAIN_NOT_FOUND, got ${String(err)}`,
        )
        assert.equal(err.context.chainIdOrSelector, DST_SELECTOR)
        return true
      },
    )
  })

  it('decodes the same log once the chain is registered', () => {
    registerChains([
      { chainId: DST_CHAIN_ID, chainSelector: DST_SELECTOR, name: 'local-anvil-dst' },
    ])
    const message = EVMChain.decodeMessage(v2MessageSentLog(DST_SELECTOR))
    assert.ok(message)
    assert.equal(message.sourceChainSelector, SRC_SELECTOR)
    assert.equal((message as { destChainSelector: bigint }).destChainSelector, DST_SELECTOR)
  })
})
