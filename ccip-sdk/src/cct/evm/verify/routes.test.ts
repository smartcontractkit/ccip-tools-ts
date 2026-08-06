import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ETHERSCAN_V2_API_URL, SOURCIFY_API_URL, explorerUrlFor, resolveRoute } from './routes.ts'
import { networkInfo } from '../../../networks.ts'
import { CCTParamsInvalidError } from '../../errors.ts'

/** Every chain the first-release table claims to serve. */
const TABLE_CHAIN_IDS = [
  1, 11155111, 10, 11155420, 56, 97, 137, 80002, 8453, 84532, 42161, 421614, 43114, 43113,
]

void describe('resolveRoute', () => {
  void it('routes every table chain to the Etherscan v2 single endpoint', () => {
    for (const chainId of TABLE_CHAIN_IDS) {
      const route = resolveRoute(chainId)
      assert.equal(route.verifier, 'etherscan-v2', String(chainId))
      assert.equal(route.apiUrl, ETHERSCAN_V2_API_URL)
      assert.ok(route.explorerBase.startsWith('https://'))
    }
  })

  void it('is consistent with the SDK chain list', () => {
    for (const chainId of TABLE_CHAIN_IDS) {
      assert.equal(networkInfo(chainId).family, 'EVM', String(chainId))
    }
  })

  void it('throws for an unlisted chain, naming the escape hatch, before any network call', () => {
    assert.throws(
      () => resolveRoute(1234567),
      (error: unknown) => {
        assert.ok(error instanceof CCTParamsInvalidError)
        assert.match(error.message, /opts\.route/)
        return true
      },
    )
  })

  void it("accepts the 'sourcify' shorthand as a keyless route", () => {
    const route = resolveRoute(1234567, 'sourcify')
    assert.equal(route.verifier, 'sourcify')
    assert.equal(route.apiUrl, SOURCIFY_API_URL)
  })

  void it('lets an explicit route object override the table', () => {
    const override = {
      verifier: 'etherscan-v2' as const,
      apiUrl: 'https://example.test/api',
      explorerBase: 'https://explorer.example.test',
    }
    assert.deepEqual(resolveRoute(1, override), override)
  })
})

void describe('explorerUrlFor', () => {
  void it('builds an Etherscan contract-code link', () => {
    const route = resolveRoute(84532)
    assert.equal(
      explorerUrlFor(route, 84532, '0xabc'),
      'https://sepolia.basescan.org/address/0xabc#code',
    )
  })

  void it('builds a Sourcify repo link from chainId and address', () => {
    const route = resolveRoute(84532, 'sourcify')
    assert.equal(
      explorerUrlFor(route, 84532, '0xabc'),
      'https://sourcify.dev/server/repo-ui/84532/0xabc',
    )
  })
})
