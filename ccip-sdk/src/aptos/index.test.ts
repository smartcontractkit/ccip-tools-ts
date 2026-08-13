/**
 * Tests for AptosChain methods that resolve a Move module from a caller-supplied address.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { networkInfo } from '../networks.ts'
import { AptosChain } from './index.ts'

const CHAIN_ID = 2 // Aptos Testnet
const PACKAGE = '0xc748b8e0c5b7e0e4b4e4b0e1c2d3e4f5a6b7c8d9eabcdef0123456789abcdef0'

/** An AptosChain whose provider records the view functions it is asked for. */
function chainWithViewSpy(response = 'Router 1.6.0') {
  const functions: string[] = []
  const provider = {
    view: ({ payload }: { payload: { function: string } }) => {
      functions.push(payload.function)
      return Promise.resolve([response])
    },
    getTransactionByVersion: () => Promise.resolve(undefined),
  } as unknown as Aptos
  return { chain: new AptosChain(provider, networkInfo(`aptos:${CHAIN_ID}`)), functions }
}

void describe('AptosChain.typeAndVersion', () => {
  void it('defaults a bare package address to the ::router module', async () => {
    const { chain, functions } = chainWithViewSpy()

    assert.deepEqual(await chain.typeAndVersion(PACKAGE), ['Router', '1.6.0', 'Router 1.6.0'])
    assert.deepEqual(functions, [`${PACKAGE}::router::type_and_version`])
  })

  void it('leaves an address that already carries a ::<module> suffix untouched', async () => {
    const { chain, functions } = chainWithViewSpy('OffRamp 1.6.0')

    assert.deepEqual(await chain.typeAndVersion(`${PACKAGE}::offramp`), [
      'OffRamp',
      '1.6.0',
      'OffRamp 1.6.0',
    ])
    assert.deepEqual(functions, [`${PACKAGE}::offramp::type_and_version`])
  })
})
