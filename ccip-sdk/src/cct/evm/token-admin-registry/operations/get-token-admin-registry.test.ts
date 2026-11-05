import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress, makeError } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { GetTokenAdminRegistry } from './get-token-admin-registry.ts'

const TOKEN = '0x' + '11'.repeat(20)
const ROUTER = '0x' + '22'.repeat(20)
const TAR = '0x' + '33'.repeat(20)
// Mixed-case hex, unlike TOKEN/ROUTER/TAR above: their EIP-55 checksums re-case letters, so
// asserting `getAddress(FIXTURE)` below only proves normalization happens if the raw fixture
// isn't already in checksummed form. A digit-only fixture would pass even if the op forgot to
// checksum (or lowercased) its output.
const ADMINISTRATOR = '0xabcdef1234567890abcdef1234567890abcdef12'
const PENDING_ADMINISTRATOR = '0x1234567890abcdef1234567890abcdef12345678'
const POOL = '0xfedcba9876543210fedcba9876543210fedcba98'

const IFACE = new Interface([
  'function getTokenConfig(address token) view returns (tuple(address administrator, address pendingAdministrator, address tokenPool))',
])

/**
 * EVMChain stub: `getTokenAdminRegistryFor` reports `registry`, and the provider answers
 * `eth_call` with `getTokenConfig` encoded as `(administrator, pendingAdministrator, tokenPool)` —
 * but only for a call to `registry` decoding to `TOKEN`; any other call, target, or argument
 * reverts (or fails the assertion), so a read that mixes up its target or argument is caught
 * rather than silently returning the fixture data.
 */
function stubChain({
  registry = TAR,
  administrator = ADMINISTRATOR,
  pendingAdministrator = PENDING_ADMINISTRATOR,
  tokenPool = POOL,
}: {
  registry?: string
  administrator?: string
  pendingAdministrator?: string
  tokenPool?: string
} = {}): EVMChain {
  const encoded = IFACE.encodeFunctionResult('getTokenConfig', [
    [administrator, pendingAdministrator, tokenPool],
  ])
  const selector = IFACE.getFunction('getTokenConfig')!.selector

  return {
    provider: {
      call: async ({ to, data }: { to?: string; data: string }) => {
        if (data.slice(0, 10) !== selector)
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: null, data },
            invocation: null,
            revert: null,
          })
        // Selector-only matching can't tell a correct read from one with the call target or the
        // decoded token argument swapped (e.g. reading a different contract's, or a different
        // token's, config) — both would still hit this branch and get `encoded` back. Assert the
        // resolved registry and the decoded argument so either mix-up fails loudly instead of
        // silently returning the fixture data.
        assert.equal(to, getAddress(registry), 'calls the resolved TAR, not `address`')
        const [token] = IFACE.decodeFunctionData('getTokenConfig', data)
        assert.equal(token, getAddress(TOKEN), 'reads the config for `tokenAddress`')
        return encoded
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    getTokenAdminRegistryFor: () => Promise.resolve(registry),
  } as unknown as EVMChain
}

describe('GetTokenAdminRegistry (cct/evm token-admin-registry query)', () => {
  it('reads administrator, pendingAdministrator, and tokenPool', async () => {
    const config = await new GetTokenAdminRegistry().query(stubChain(), {
      address: ROUTER,
      tokenAddress: TOKEN,
    })

    assert.deepEqual(config, {
      administrator: getAddress(ADMINISTRATOR),
      pendingAdministrator: getAddress(PENDING_ADMINISTRATOR),
      tokenPool: getAddress(POOL),
    })
  })

  it('resolves the TAR from `address` before reading', async () => {
    let seen: string | undefined
    const chain = stubChain()
    chain.getTokenAdminRegistryFor = (address: string) => {
      seen = address
      return Promise.resolve(TAR)
    }

    await new GetTokenAdminRegistry().query(chain, { address: ROUTER, tokenAddress: TOKEN })

    assert.equal(seen, ROUTER)
  })

  it(
    'reports a zero administrator rather than throwing — the pending-registration state ' +
      'EVMChain.getRegistryTokenConfig cannot observe',
    async () => {
      const config = await new GetTokenAdminRegistry().query(
        stubChain({ administrator: ZeroAddress }),
        { address: ROUTER, tokenAddress: TOKEN },
      )

      assert.equal(config.administrator, ZeroAddress)
      assert.equal(config.pendingAdministrator, getAddress(PENDING_ADMINISTRATOR))
    },
  )

  it('omits pendingAdministrator when zero', async () => {
    const config = await new GetTokenAdminRegistry().query(
      stubChain({ pendingAdministrator: ZeroAddress }),
      { address: ROUTER, tokenAddress: TOKEN },
    )

    assert.ok(!('pendingAdministrator' in config))
  })

  it('omits tokenPool when zero', async () => {
    const config = await new GetTokenAdminRegistry().query(stubChain({ tokenPool: ZeroAddress }), {
      address: ROUTER,
      tokenAddress: TOKEN,
    })

    assert.ok(!('tokenPool' in config))
  })

  it('omits both optional fields for an unregistered token', async () => {
    const config = await new GetTokenAdminRegistry().query(
      stubChain({
        administrator: ZeroAddress,
        pendingAdministrator: ZeroAddress,
        tokenPool: ZeroAddress,
      }),
      { address: ROUTER, tokenAddress: TOKEN },
    )

    assert.deepEqual(config, { administrator: ZeroAddress })
  })

  describe('validation', () => {
    it('rejects an invalid `address` before any RPC', async () => {
      let called = false
      const chain = stubChain()
      chain.getTokenAdminRegistryFor = () => {
        called = true
        return Promise.resolve(TAR)
      }

      await assert.rejects(
        () => new GetTokenAdminRegistry().query(chain, { address: 'nope', tokenAddress: TOKEN }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'getTokenAdminRegistry' &&
          err.context.param === 'address',
      )
      assert.equal(called, false, 'validation fails before TAR discovery')
    })

    it('rejects an invalid `tokenAddress` before any RPC', async () => {
      await assert.rejects(
        () =>
          new GetTokenAdminRegistry().query(stubChain(), {
            address: ROUTER,
            tokenAddress: 'nope',
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'getTokenAdminRegistry' &&
          err.context.param === 'tokenAddress',
      )
    })
  })
})
