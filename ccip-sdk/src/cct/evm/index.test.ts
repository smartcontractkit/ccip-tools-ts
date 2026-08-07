import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, id } from 'ethers'

import { EVMTokenManager } from './index.ts'
import { CCIPWalletInvalidError } from '../../errors/index.ts'
import { interfaces } from '../../evm/const.ts'
import type { EVMChain } from '../../evm/index.ts'
import { ChainFamily } from '../../networks.ts'
import { CCTContractTypeInvalidError, CCTParamsInvalidError } from '../errors.ts'

const TOKEN = '0x' + '11'.repeat(20)
const POOL = '0x' + '22'.repeat(20)
const ROUTER = '0x' + '33'.repeat(20)
const TAR = '0x' + '44'.repeat(20)
const REGISTRY_MODULE = '0x' + '55'.repeat(20)
const ADMIN = '0x' + '66'.repeat(20)
// Distinct from ADMIN/REGISTRY_MODULE on purpose: sharing a value would let an assertion pass
// against the wrong address.
const CURRENT_ADMIN = '0x' + '77'.repeat(20)
const NEW_ADMIN = '0x' + '88'.repeat(20)

/** Encodes a `getTokenConfig` result the way the on-chain TAR would. */
function encodeTokenConfig(administrator: string, pendingAdministrator = ZeroAddress) {
  return interfaces.TokenAdminRegistry.encodeFunctionResult('getTokenConfig', [
    [administrator, pendingAdministrator, ZeroAddress],
  ])
}

/** Minimal EVMChain stub — only the members EVMTokenManager touches. */
function stubChain(overrides: Partial<EVMChain> = {}, poolVersion = '1.5.1'): EVMChain {
  return {
    provider: { call: async () => encodeTokenConfig(CURRENT_ADMIN) },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    getTokenAdminRegistryFor: (_address: string) => Promise.resolve(TAR),
    typeAndVersion: (address: string) =>
      Promise.resolve(
        address === REGISTRY_MODULE
          ? ['RegistryModuleOwnerCustom', '1.6.0']
          : ['BurnMintTokenPool', poolVersion],
      ),
    nextNonce: async () => 0,
    rollbackNonce: () => {},
    ...overrides,
  } as unknown as EVMChain
}

const HASH = '0x' + 'ab'.repeat(32)

/** Fake ethers Signer whose broadcast resolves to a confirmed receipt. */
function fakeSigner(address = TOKEN) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(address),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({ hash: HASH, wait: () => Promise.resolve({ status: 1 }) }),
  }
}

const REGISTER_ADMIN_SELECTOR = id('registerAdminViaOwner(address)').slice(0, 10)
const IS_REGISTRY_MODULE_SELECTOR =
  interfaces.TokenAdminRegistry.getFunction('isRegistryModule')!.selector
const GET_TOKEN_CONFIG_SELECTOR =
  interfaces.TokenAdminRegistry.getFunction('getTokenConfig')!.selector
const OWNER_SELECTOR = new Interface(['function owner() view returns (address)']).getFunction(
  'owner',
)!.selector

/**
 * Selector-aware `provider.call` for `registerAdmin`'s on-chain checks: the module is
 * registered, the token is unregistered, and `owner()` resolves to `ADMIN`.
 */
function registerAdminProvider() {
  return {
    call: async (tx: { data?: string }) => {
      const sel = (tx.data ?? '0x').slice(0, 10)
      if (sel === IS_REGISTRY_MODULE_SELECTOR)
        return interfaces.TokenAdminRegistry.encodeFunctionResult('isRegistryModule', [true])
      if (sel === GET_TOKEN_CONFIG_SELECTOR)
        return interfaces.TokenAdminRegistry.encodeFunctionResult('getTokenConfig', [
          [ZeroAddress, ZeroAddress, ZeroAddress],
        ])
      if (sel === OWNER_SELECTOR)
        return new Interface(['function owner() view returns (address)']).encodeFunctionResult(
          'owner',
          [ADMIN],
        )
      throw new Error(`registerAdminProvider: unexpected call, selector ${sel}`)
    },
  }
}

const SET_POOL_SELECTOR = id('setPool(address,address)').slice(0, 10)
const TRANSFER_ADMIN_ROLE_SELECTOR = id('transferAdminRole(address,address)').slice(0, 10)
const EXPECTED_TRANSFER_ADMIN = new Interface([
  'function transferAdminRole(address localToken, address newAdmin)',
]).encodeFunctionData('transferAdminRole', [TOKEN, NEW_ADMIN])
const EXPECTED_DATA = new Interface([
  'function setPool(address localToken, address pool)',
]).encodeFunctionData('setPool', [TOKEN, POOL])
const EXPECTED_TRANSFER = new Interface([
  'function transferOwnership(address to)',
]).encodeFunctionData('transferOwnership', [TOKEN])
const ACCEPT_ADMIN_SELECTOR = id('acceptAdminRole(address)').slice(0, 10)
const EXPECTED_ACCEPT_ADMIN = new Interface([
  'function acceptAdminRole(address localToken)',
]).encodeFunctionData('acceptAdminRole', [TOKEN])

/** Fake provider whose `call` answers `getTokenConfig` with `pendingAdministrator = TOKEN`. */
function acceptAdminProvider(pendingAdministrator: string) {
  return {
    call: () =>
      Promise.resolve(
        interfaces.TokenAdminRegistry.encodeFunctionResult('getTokenConfig', [
          [ZeroAddress, pendingAdministrator, ZeroAddress],
        ]),
      ),
  }
}

describe('EVMTokenManager (cct/evm)', () => {
  describe('construction', () => {
    it('fromChain wraps an existing chain and exposes its provider', () => {
      const chain = stubChain()
      const cct = EVMTokenManager.fromChain(chain)
      assert.ok(cct instanceof EVMTokenManager)
      assert.equal(cct.chain, chain)
      assert.equal(cct.provider, chain.provider)
    })
  })

  describe('generateUnsignedRegisterAdmin', () => {
    it('encodes registerAdminViaOwner(token) to the registry module', async () => {
      const cct = EVMTokenManager.fromChain(
        stubChain({ provider: registerAdminProvider() as never }),
      )
      const unsigned = await cct.generateUnsignedRegisterAdmin({
        tokenAddress: TOKEN,
        registryModule: REGISTRY_MODULE,
        address: ROUTER,
        sender: ADMIN,
      })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, REGISTRY_MODULE)
      assert.equal(tx.from, ADMIN)
      assert.ok(
        tx.data!.startsWith(REGISTER_ADMIN_SELECTOR),
        'data starts with registerAdminViaOwner selector',
      )
    })

    it('rejects an invalid address before any RPC, tagged with the operation', async () => {
      let called = false
      const cct = EVMTokenManager.fromChain(
        stubChain({
          getTokenAdminRegistryFor: () => {
            called = true
            return Promise.resolve(TAR)
          },
        }),
      )
      await assert.rejects(
        () =>
          cct.generateUnsignedRegisterAdmin({
            tokenAddress: 'not-an-address',
            registryModule: REGISTRY_MODULE,
            address: ROUTER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'registerAdmin' &&
          err.context.param === 'tokenAddress',
      )
      assert.equal(called, false, 'validation fails before TAR discovery')
    })
  })

  describe('registerAdmin', () => {
    it('signs and submits, resolving to the confirmed tx hash', async () => {
      const cct = EVMTokenManager.fromChain(
        stubChain({ provider: registerAdminProvider() as never }),
      )
      // `sender` is left off `opts` — `registerAdmin` defaults it to the wallet's own address
      // (see `RegisterAdmin.execute`), which must equal `owner()` (ADMIN, per `registerAdminProvider`).
      const result = await cct.registerAdmin({
        tokenAddress: TOKEN,
        registryModule: REGISTRY_MODULE,
        address: ROUTER,
        wallet: fakeSigner(ADMIN),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-signer wallet', async () => {
      const cct = EVMTokenManager.fromChain(
        stubChain({ provider: registerAdminProvider() as never }),
      )
      await assert.rejects(
        () =>
          cct.registerAdmin({
            tokenAddress: TOKEN,
            registryModule: REGISTRY_MODULE,
            address: ROUTER,
            wallet: {},
          }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })

    it('rejects a wallet that is not the token owner before any tx is submitted', async () => {
      const cct = EVMTokenManager.fromChain(
        stubChain({ provider: registerAdminProvider() as never }),
      )
      // No explicit `sender` — this is the default `registerAdmin({ ...params, wallet })` shape,
      // the exact path the authority check must not skip (it defaults `sender` to the wallet's
      // own address, so a wallet that isn't `owner()` is caught here, pre-tx).
      await assert.rejects(
        () =>
          cct.registerAdmin({
            tokenAddress: TOKEN,
            registryModule: REGISTRY_MODULE,
            address: ROUTER,
            wallet: fakeSigner(), // TOKEN address, not ADMIN — not the token's owner()
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'registerAdmin' &&
          err.context.param === 'sender',
      )
    })
  })

  describe('generateUnsignedSetPool', () => {
    it('encodes setPool(token, pool) to the discovered TAR', async () => {
      const cct = EVMTokenManager.fromChain(stubChain())
      const unsigned = await cct.generateUnsignedSetPool({
        tokenAddress: TOKEN,
        poolAddress: POOL,
        address: ROUTER,
        sender: TOKEN,
      })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)

      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, TAR)
      assert.equal(tx.from, TOKEN)
      assert.ok(tx.data!.startsWith(SET_POOL_SELECTOR), 'data starts with setPool selector')
      assert.equal(tx.data, EXPECTED_DATA)
    })

    it('discovers the TAR from the router address', async () => {
      let seen: string | undefined
      const cct = EVMTokenManager.fromChain(
        stubChain({
          getTokenAdminRegistryFor: (address: string) => {
            seen = address
            return Promise.resolve(TAR)
          },
        }),
      )
      await cct.generateUnsignedSetPool({
        tokenAddress: TOKEN,
        poolAddress: POOL,
        address: ROUTER,
      })
      assert.equal(seen, ROUTER)
    })

    it('omits `from` when no sender is given', async () => {
      const cct = EVMTokenManager.fromChain(stubChain())
      const unsigned = await cct.generateUnsignedSetPool({
        tokenAddress: TOKEN,
        poolAddress: POOL,
        address: ROUTER,
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })

    it('rejects an invalid address before any RPC, tagged with the operation', async () => {
      let called = false
      const cct = EVMTokenManager.fromChain(
        stubChain({
          getTokenAdminRegistryFor: () => {
            called = true
            return Promise.resolve(TAR)
          },
        }),
      )
      await assert.rejects(
        () =>
          cct.generateUnsignedSetPool({
            tokenAddress: 'not-an-address',
            poolAddress: POOL,
            address: ROUTER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setPool' &&
          err.context.param === 'tokenAddress',
      )
      assert.equal(called, false, 'validation fails before TAR discovery')
    })
  })

  describe('setPool', () => {
    it('signs and submits, resolving to the confirmed tx hash', async () => {
      const cct = EVMTokenManager.fromChain(stubChain())
      const result = await cct.setPool({
        tokenAddress: TOKEN,
        poolAddress: POOL,
        address: ROUTER,
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-signer wallet', async () => {
      const cct = EVMTokenManager.fromChain(stubChain())
      await assert.rejects(
        () =>
          cct.setPool({
            tokenAddress: TOKEN,
            poolAddress: POOL,
            address: ROUTER,
            wallet: {},
          }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })

  describe('generateUnsignedTransferAdmin', () => {
    it('encodes transferAdminRole(token, newAdmin) to the discovered TAR', async () => {
      const cct = EVMTokenManager.fromChain(stubChain())
      const unsigned = await cct.generateUnsignedTransferAdmin({
        tokenAddress: TOKEN,
        newAdmin: NEW_ADMIN,
        address: ROUTER,
        sender: CURRENT_ADMIN,
      })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)

      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, TAR)
      assert.equal(tx.from, CURRENT_ADMIN)
      assert.ok(
        tx.data!.startsWith(TRANSFER_ADMIN_ROLE_SELECTOR),
        'data starts with transferAdminRole selector',
      )
      assert.equal(tx.data, EXPECTED_TRANSFER_ADMIN)
    })

    it('rejects a sender that is not the current registry administrator', async () => {
      const cct = EVMTokenManager.fromChain(stubChain())
      await assert.rejects(
        () =>
          cct.generateUnsignedTransferAdmin({
            tokenAddress: TOKEN,
            newAdmin: NEW_ADMIN,
            address: ROUTER,
            sender: NEW_ADMIN,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferAdmin' &&
          err.context.param === 'sender',
      )
    })
  })

  describe('transferAdmin', () => {
    it('signs and submits, resolving to the confirmed tx hash', async () => {
      const cct = EVMTokenManager.fromChain(stubChain())
      const result = await cct.transferAdmin({
        tokenAddress: TOKEN,
        newAdmin: NEW_ADMIN,
        address: ROUTER,
        sender: CURRENT_ADMIN,
        wallet: fakeSigner(CURRENT_ADMIN),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-signer wallet', async () => {
      const cct = EVMTokenManager.fromChain(stubChain())
      await assert.rejects(
        () =>
          cct.transferAdmin({
            tokenAddress: TOKEN,
            newAdmin: NEW_ADMIN,
            address: ROUTER,
            sender: CURRENT_ADMIN,
            wallet: {},
          }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })

  describe('transferOwnership', () => {
    it('probes the pool type/version, then builds transferOwnership to the pool', async () => {
      const probed: string[] = []
      const cct = EVMTokenManager.fromChain(
        stubChain({
          typeAndVersion: ((address: string) => {
            probed.push(address)
            return Promise.resolve(['BurnMintTokenPool', '1.5.1', 'BurnMintTokenPool 1.5.1'])
          }) as unknown as EVMChain['typeAndVersion'],
        }),
      )
      const unsigned = await cct.generateUnsignedTransferOwnership({
        poolAddress: POOL,
        newOwner: TOKEN,
      })
      assert.deepEqual(probed, [POOL]) // resolved the pool's type/version from its own address
      assert.equal(unsigned.transactions[0]!.to, POOL)
      assert.equal(unsigned.transactions[0]!.data, EXPECTED_TRANSFER)
    })

    it('surfaces an unsupported pool type reported by the probe', async () => {
      const cct = EVMTokenManager.fromChain(
        stubChain({
          typeAndVersion: (() =>
            Promise.resolve([
              'NotATokenPool',
              '1.5.1',
              'NotATokenPool 1.5.1',
            ])) as unknown as EVMChain['typeAndVersion'],
        }),
      )
      await assert.rejects(
        cct.generateUnsignedTransferOwnership({ poolAddress: POOL, newOwner: TOKEN }),
        (err: unknown) => err instanceof CCTContractTypeInvalidError,
      )
    })
  })

  describe('getTokenPoolState', () => {
    it('reads through the wrapped chain', async () => {
      const probed: string[] = []
      const cct = EVMTokenManager.fromChain(
        stubChain({
          typeAndVersion: ((address: string) => {
            probed.push(address)
            return Promise.resolve(['BurnMintTokenPool', '2.0.0', 'BurnMintTokenPool 2.0.0'])
          }) as unknown as EVMChain['typeAndVersion'],
        }),
      )

      // the pool getters themselves need a real provider, so this rejects after the probe
      await assert.rejects(cct.getTokenPoolState({ poolAddress: POOL }))
      assert.deepEqual(probed, [POOL], 'probes the requested pool on the wrapped chain')
    })

    it('rejects an invalid pool address before any RPC, tagged with the operation', async () => {
      let probed = false
      const cct = EVMTokenManager.fromChain(
        stubChain({
          typeAndVersion: (() => {
            probed = true
            return Promise.resolve(['BurnMintTokenPool', '2.0.0', 'BurnMintTokenPool 2.0.0'])
          }) as unknown as EVMChain['typeAndVersion'],
        }),
      )

      await assert.rejects(
        () => cct.getTokenPoolState({ poolAddress: 'not-an-address' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'getTokenPoolState' &&
          err.context.param === 'poolAddress',
      )
      assert.equal(probed, false, 'validation fails before the typeAndVersion probe')
    })
  })
  describe('generateUnsignedAcceptAdmin', () => {
    it('encodes acceptAdminRole(token) to the discovered TAR when sender is pending', async () => {
      const cct = EVMTokenManager.fromChain(
        stubChain({ provider: acceptAdminProvider(TOKEN) as never }),
      )
      const unsigned = await cct.generateUnsignedAcceptAdmin({
        tokenAddress: TOKEN,
        address: ROUTER,
        sender: TOKEN,
      })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)

      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, TAR)
      assert.equal(tx.from, TOKEN)
      assert.ok(
        tx.data!.startsWith(ACCEPT_ADMIN_SELECTOR),
        'data starts with acceptAdminRole selector',
      )
      assert.equal(tx.data, EXPECTED_ACCEPT_ADMIN)
    })

    it('rejects an invalid address before any RPC, tagged with the operation', async () => {
      let called = false
      const cct = EVMTokenManager.fromChain(
        stubChain({
          getTokenAdminRegistryFor: () => {
            called = true
            return Promise.resolve(TAR)
          },
        }),
      )
      await assert.rejects(
        () =>
          cct.generateUnsignedAcceptAdmin({
            tokenAddress: 'not-an-address',
            address: ROUTER,
            sender: TOKEN,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'acceptAdmin' &&
          err.context.param === 'tokenAddress',
      )
      assert.equal(called, false, 'validation fails before TAR discovery')
    })

    it('rejects when sender is not the pending administrator', async () => {
      const cct = EVMTokenManager.fromChain(
        stubChain({ provider: acceptAdminProvider(POOL) as never }),
      )
      await assert.rejects(
        cct.generateUnsignedAcceptAdmin({
          tokenAddress: TOKEN,
          address: ROUTER,
          sender: TOKEN,
        }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'acceptAdmin' &&
          err.context.param === 'sender',
      )
    })
  })

  describe('acceptAdmin', () => {
    it('signs and submits, resolving to the confirmed tx hash', async () => {
      const cct = EVMTokenManager.fromChain(
        stubChain({ provider: acceptAdminProvider(TOKEN) as never }),
      )
      const result = await cct.acceptAdmin({
        tokenAddress: TOKEN,
        address: ROUTER,
        sender: TOKEN,
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-signer wallet', async () => {
      const cct = EVMTokenManager.fromChain(
        stubChain({ provider: acceptAdminProvider(TOKEN) as never }),
      )
      await assert.rejects(
        () =>
          cct.acceptAdmin({
            tokenAddress: TOKEN,
            address: ROUTER,
            sender: TOKEN,
            wallet: {},
          }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })

    it('rejects a sender that does not match the executing wallet', async () => {
      // fakeSigner().getAddress() resolves to TOKEN; a `sender` other than TOKEN must be
      // rejected rather than silently accepted and broadcast from the mismatched wallet.
      const cct = EVMTokenManager.fromChain(
        stubChain({ provider: acceptAdminProvider(TOKEN) as never }),
      )
      await assert.rejects(
        () =>
          cct.acceptAdmin({
            tokenAddress: TOKEN,
            address: ROUTER,
            sender: POOL,
            wallet: fakeSigner(),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'acceptAdmin' &&
          err.context.param === 'sender',
      )
    })
  })
  describe('getTokenAdminRegistry', () => {
    const GET_TOKEN_CONFIG_IFACE = new Interface([
      'function getTokenConfig(address token) view returns (tuple(address administrator, address pendingAdministrator, address tokenPool))',
    ])
    const ADMINISTRATOR = '0x' + '77'.repeat(20)

    /**
     * Chain stub whose provider answers `getTokenConfig` with `administrator`/zeroed others —
     * but only for a call to `TAR` decoding to `TOKEN`. Mirrors the target/argument assertions in
     * `token-admin-registry/operations/get-token-admin-registry.test.ts`'s `stubChain`: matching
     * on the selector alone can't tell a correct read from one with the call target or decoded
     * token swapped, since both would still reach this branch and get `encoded` back.
     */
    function stubTarChain(administrator: string) {
      const selector = GET_TOKEN_CONFIG_IFACE.getFunction('getTokenConfig')!.selector
      const encoded = GET_TOKEN_CONFIG_IFACE.encodeFunctionResult('getTokenConfig', [
        [administrator, ZeroAddress, ZeroAddress],
      ])
      return stubChain({
        provider: {
          call: async ({ to, data }: { to?: string; data: string }) => {
            if (data.slice(0, 10) !== selector) return '0x'
            assert.equal(to, TAR, 'calls the resolved TAR, not `address`')
            const [token] = GET_TOKEN_CONFIG_IFACE.decodeFunctionData('getTokenConfig', data)
            assert.equal(token, TOKEN, 'reads the config for `tokenAddress`')
            return encoded
          },
        } as never,
      })
    }

    it('reads through the wrapped chain, resolving the TAR from `address`', async () => {
      const config = await EVMTokenManager.fromChain(
        stubTarChain(ADMINISTRATOR),
      ).getTokenAdminRegistry({
        address: ROUTER,
        tokenAddress: TOKEN,
      })
      assert.deepEqual(config, { administrator: ADMINISTRATOR })
    })

    it('reports a zero administrator rather than throwing', async () => {
      const config = await EVMTokenManager.fromChain(
        stubTarChain(ZeroAddress),
      ).getTokenAdminRegistry({ address: ROUTER, tokenAddress: TOKEN })
      assert.equal(config.administrator, ZeroAddress)
    })

    it('rejects an invalid token address before any RPC, tagged with the operation', async () => {
      let called = false
      const cct = EVMTokenManager.fromChain(
        stubChain({
          getTokenAdminRegistryFor: () => {
            called = true
            return Promise.resolve(TAR)
          },
        }),
      )
      await assert.rejects(
        () => cct.getTokenAdminRegistry({ address: ROUTER, tokenAddress: 'not-an-address' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'getTokenAdminRegistry' &&
          err.context.param === 'tokenAddress',
      )
      assert.equal(called, false, 'validation fails before TAR discovery')
    })
  })
})
