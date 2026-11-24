/** Tests for the Aptos statics that read CCIP 2.0 data: messages, receipts, extra args, errors. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AptosApiError, AptosApiType } from '@aptos-labs/ts-sdk'

import '../index.ts'
import { getMessageVersion } from '../requests.ts'
import { type CCIPMessage, type CCIPVersion, CCIPVersion as Versions } from '../types.ts'
import { AptosChain } from './index.ts'

const APTOS_TESTNET = 743186221051783445n
const SEPOLIA = 16015286601757825753n

// `CCIPMessageSent` data of aptos-testnet tx version 548935261 (without its receipts): to Sepolia
const SENT = {
  dest_chain_selector: '16015286601757825753',
  encoded_message:
    '0x010a5053ee33c1a915de41ba4fc9d91ad9000000000000000500077ba000030d4000000000fbe3333c19e304547311504a2e8919b0d0cb568a41954af6323ccfaa339d9a212021cb562592180cdf573cd142dd96321bd47d78f32e34ea277725cee9a23b97a1146d817bb162b36be1cf33b55977a9fc8bd18a342c20311cea5ace5299669444abd99fc787ddb0894e297ca0f21331aa4e0c5950ec5e141b03fb65877cdb7dabdb73e72b11ba1651ac754800000000000568656c6c6f',
  fee_token: '0xa',
  message_id: '0xc6594982827ab1947a44d20d4784244eb7d50883350edad5487efd116474b1fd',
  sender: '0x311cea5ace5299669444abd99fc787ddb0894e297ca0f21331aa4e0c5950ec5e',
  token_amount_before_token_pool_fees: '0',
}

describe('AptosChain 2.0 statics', () => {
  it('decodes a CCIPMessageSent event from its encoded message and event fields', () => {
    const { message_id: _, ...withoutId } = SENT
    const message = AptosChain.decodeMessage({
      data: { ...withoutId, future_field: '12' },
    }) as CCIPMessage<typeof CCIPVersion.V2_0> & Record<string, unknown>

    assert.equal(getMessageVersion(message), Versions.V2_0)
    // the id defaults to the hash of the encoded message
    assert.equal(message.messageId, SENT.message_id)
    assert.equal(message.encodedMessage, SENT.encoded_message)
    assert.equal(message.sourceChainSelector, APTOS_TESTNET)
    assert.equal(message.destChainSelector, SEPOLIA)
    assert.equal(message.sequenceNumber, 5n)
    assert.equal(
      message.onRampAddress,
      '0x21cb562592180cdf573cd142dd96321bd47d78f32e34ea277725cee9a23b97a1',
    )
    assert.equal(message.offRampAddress, '0x6D817BB162b36be1Cf33b55977a9Fc8BD18a342c')
    assert.equal(message.receiver, '0x1b03FB65877cdb7dAbdB73e72B11Ba1651aC7548')
    assert.equal(message.data, '0x68656c6c6f')
    assert.equal(message.executionGasLimit, 490400n)
    // event fields pass through, camelCase, integers as bigints
    assert.equal(message.tokenAmountBeforeTokenPoolFees, 0n)
    assert.equal(message.futureField, 12n)
  })

  it('decodes a 2.0 receipt, giving its message_number as sequenceNumber', () => {
    // ExecutionStateChanged data of aptos-testnet tx version 567359658 (OffRamp 2.0.0)
    const data = {
      message_id: '0x6ff0adcef484c80ee36f3c5e354aadaa325a6859e9309f85089d6a7b2fc37ab8',
      message_number: '8',
      source_chain_selector: '16015286601757825753',
      state: 2,
    }
    assert.deepEqual(AptosChain.decodeReceipt({ data }), {
      messageId: data.message_id,
      messageNumber: 8n,
      sequenceNumber: 8n,
      sourceChainSelector: SEPOLIA,
      state: 2,
    })
  })

  it('round-trips GenericExtraArgsV3 with 32-byte Aptos addresses', () => {
    const args = {
      gasLimit: 100_000n,
      finality: 'safe' as const,
      ccvs: [`0x${'e1'.repeat(32)}`],
      ccvArgs: ['0x01'],
      executor: `0x${'ab'.repeat(20)}`, // a shorter address is left-padded to 32 bytes
      executorArgs: '0x',
      tokenReceiver: `0x${'cd'.repeat(32)}`,
      tokenArgs: '0x',
    }
    const encoded = AptosChain.encodeExtraArgs(args)

    assert.ok(encoded.includes(`20${'00'.repeat(12)}${'ab'.repeat(20)}`))
    assert.deepEqual(AptosChain.decodeExtraArgs(encoded), { _tag: 'GenericExtraArgsV3', ...args })
  })

  it('parses the node answer of an aborted view', () => {
    const data = {
      message: 'Move abort in 0x1::fungible_asset: EINSUFFICIENT_BALANCE(0x10004): ',
      error_code: 'invalid_input',
      vm_error_code: 4016,
    }
    const url = 'https://fullnode.testnet.aptoslabs.com/v1/view'
    const err = new AptosApiError({
      apiType: AptosApiType.FULLNODE,
      aptosRequest: { url, method: 'POST' },
      aptosResponse: { status: 400, statusText: 'Bad Request', data, url, headers: {} },
    } as unknown as ConstructorParameters<typeof AptosApiError>[0])

    assert.deepEqual(AptosChain.parse(err), data)
    assert.equal(AptosChain.parse(new Error('fetch failed')), undefined)
  })
})
