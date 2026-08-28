import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress, id, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { interfaces } from '../../../../evm/const.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { RegisterAdmin } from './register-admin.ts'

const TOKEN = '0x' + '11'.repeat(20)
const REGISTRY_MODULE = '0x' + '22'.repeat(20)
const ROUTER = '0x' + '33'.repeat(20)
const TAR = '0x' + '44'.repeat(20)
// Deliberately letter-bearing, so its checksummed and lowercase spellings differ. The
// already-registered assertions below feed the stub a lowercase administrator and assert the
// error carries the checksummed form — which is what pins `readTokenAdminRegistryConfig`'s
// checksumming. With an all-digit fixture the two spellings coincide and that guarantee is
// silently untested.
const ADMIN = getAddress('0x' + 'ad'.repeat(20))
const OTHER = '0x' + '66'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const ROLE = '0x' + '00'.repeat(32) // OZ's DEFAULT_ADMIN_ROLE constant (bytes32(0))

// Module-call golden vectors, written by hand against a locally-declared Interface rather than
// the vendored REGISTRY_MODULE_OWNER_CUSTOM_ABI, so this stays an independent check: swapping the
// encoded argument (e.g. registryModule instead of token) or the wrong moduleFn would show up here
// even though it'd also validate cleanly against the (correct) vendored ABI.
const GOLDEN_MODULE_INTERFACE = new Interface([
  'function registerAdminViaOwner(address token)',
  'function registerAdminViaGetCCIPAdmin(address token)',
  'function registerAccessControlDefaultAdmin(address token)',
])
const OWNER_DATA = GOLDEN_MODULE_INTERFACE.encodeFunctionData('registerAdminViaOwner', [TOKEN])
const CCIP_ADMIN_DATA = GOLDEN_MODULE_INTERFACE.encodeFunctionData('registerAdminViaGetCCIPAdmin', [
  TOKEN,
])
const ACCESS_CONTROL_DATA = GOLDEN_MODULE_INTERFACE.encodeFunctionData(
  'registerAccessControlDefaultAdmin',
  [TOKEN],
)

// TAR-side selectors probed by pre-tx validation.
const IS_REGISTRY_MODULE_SELECTOR =
  interfaces.TokenAdminRegistry.getFunction('isRegistryModule')!.selector
const GET_TOKEN_CONFIG_SELECTOR =
  interfaces.TokenAdminRegistry.getFunction('getTokenConfig')!.selector

// Token-side selectors, independently derived via `id(...)` rather than read back from the
// throwaway Interfaces the op itself builds — so a wrong-getter mutation in the op can't also
// silently rewrite the expectation.
const OWNER_GETTER_SELECTOR = id('owner()').slice(0, 10)
const CCIP_ADMIN_GETTER_SELECTOR = id('getCCIPAdmin()').slice(0, 10)
const DEFAULT_ADMIN_ROLE_SELECTOR = id('DEFAULT_ADMIN_ROLE()').slice(0, 10)
const HAS_ROLE_SELECTOR = id('hasRole(bytes32,address)').slice(0, 10)

/** Throwaway single-fragment interface for a token getter, mirroring the op's own probe. */
const getterInterface = (name: string) =>
  new Interface([`function ${name}() view returns (address)`])
/** Mirrors the op's own throwaway AccessControl interface, used to decode recorded calls. */
const accessControlInterface = new Interface([
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  'function hasRole(bytes32, address) view returns (bool)',
])

type TokenConfig = { administrator: string; pendingAdministrator: string; tokenPool: string }

const UNREGISTERED: TokenConfig = {
  administrator: ZeroAddress,
  pendingAdministrator: ZeroAddress,
  tokenPool: ZeroAddress,
}

/** A recorded `provider.call`: its target and raw calldata, for asserting *where* a probe went. */
type RecordedCall = { to: string | undefined; data: string }

/**
 * Minimal EVMChain stub with a selector-aware `provider.call`, mirroring `finality-preflight.test.ts`.
 * Pass `calls` to record every call `{ to, data }` — needed because the per-method getter mapping
 * is otherwise untestable: `encodeFunctionResult` for a `() view returns (address)` fragment
 * produces identical bytes regardless of the function name, so only the *request* (selector +
 * target), not the stubbed response, can prove which getter was actually probed. Any selector this
 * stub doesn't recognise throws (rather than falling back to a generic response), so a probe aimed
 * at the wrong function or the wrong address fails loudly instead of returning a plausible value.
 */
function stubChain(
  opts: {
    isModule?: boolean
    tokenConfig?: TokenConfig
    getter?: string
    getterAddress?: string
    hasRole?: boolean
    moduleTypeAndVersion?: [string, string]
    calls?: RecordedCall[]
    overrides?: Partial<EVMChain>
  } = {},
): EVMChain {
  const isModule = opts.isModule ?? true
  const tokenConfig = opts.tokenConfig ?? UNREGISTERED
  const getter = opts.getter ?? 'owner'
  const getterAddress = opts.getterAddress ?? ADMIN
  const hasRole = opts.hasRole ?? true
  const [moduleType, moduleVersion] = opts.moduleTypeAndVersion ?? [
    'RegistryModuleOwnerCustom',
    '1.6.0',
  ]

  const provider = {
    call: async (tx: { to?: string; data?: string }) => {
      const data = tx.data ?? '0x'
      const sel = data.slice(0, 10)
      opts.calls?.push({ to: tx.to, data })
      // Recording alone leaves the TAR-side probes unpinned unless a test bothers to inspect
      // `calls`. Asserting here instead pins them for EVERY test: without this, swapping an
      // argument (e.g. `getTokenConfig(registryModule)`, which silently disables the
      // already-registered guard) or aiming a probe at the wrong contract keeps the suite green.
      const at = (label: string, expected: string) =>
        assert.equal(getAddress(tx.to ?? ZeroAddress), getAddress(expected), `${label} target`)
      if (sel === IS_REGISTRY_MODULE_SELECTOR) {
        at('isRegistryModule', TAR)
        const [mod] = interfaces.TokenAdminRegistry.decodeFunctionData(
          'isRegistryModule',
          data,
        ) as unknown as [string]
        assert.equal(
          getAddress(mod),
          getAddress(REGISTRY_MODULE),
          'isRegistryModule asks about `registryModule`',
        )
        return interfaces.TokenAdminRegistry.encodeFunctionResult('isRegistryModule', [isModule])
      }
      if (sel === GET_TOKEN_CONFIG_SELECTOR) {
        at('getTokenConfig', TAR)
        const [tok] = interfaces.TokenAdminRegistry.decodeFunctionData(
          'getTokenConfig',
          data,
        ) as unknown as [string]
        assert.equal(getAddress(tok), getAddress(TOKEN), 'getTokenConfig asks about `tokenAddress`')
        return interfaces.TokenAdminRegistry.encodeFunctionResult('getTokenConfig', [
          [tokenConfig.administrator, tokenConfig.pendingAdministrator, tokenConfig.tokenPool],
        ])
      }
      // Every token-side probe must read the token itself, never the module or the registry.
      if (sel === DEFAULT_ADMIN_ROLE_SELECTOR) {
        at('DEFAULT_ADMIN_ROLE', TOKEN)
        return accessControlInterface.encodeFunctionResult('DEFAULT_ADMIN_ROLE', [ROLE])
      }
      if (sel === HAS_ROLE_SELECTOR) {
        at('hasRole', TOKEN)
        return accessControlInterface.encodeFunctionResult('hasRole', [hasRole])
      }
      if (sel === getterInterface(getter).getFunction(getter)!.selector) {
        at(`${getter}()`, TOKEN)
        return getterInterface(getter).encodeFunctionResult(getter, [getterAddress])
      }
      throw new Error(`stubChain: unrecognised selector ${sel} at ${tx.to ?? '(no to)'}`)
    },
  }

  return {
    provider,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    getTokenAdminRegistryFor: (_address: string) => Promise.resolve(TAR),
    typeAndVersion: (_address: string) =>
      Promise.resolve([moduleType, moduleVersion, `${moduleType} ${moduleVersion}`]),
    nextNonce: async () => 0,
    rollbackNonce: () => {},
    ...opts.overrides,
  } as unknown as EVMChain
}

/** Fake ethers Signer for a plain (non-deployment) tx. */
function fakeSigner(opts: { address?: string; waitError?: Error } = {}) {
  const address = opts.address ?? ADMIN
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(address),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({
        hash: HASH,
        wait: () =>
          opts.waitError
            ? Promise.reject(opts.waitError)
            : Promise.resolve({ status: 1, contractAddress: null }),
      }),
  }
}

describe('RegisterAdmin (cct/evm token-admin-registry operation)', () => {
  describe('generate (golden vectors)', () => {
    it('defaults to owner and encodes registerAdminViaOwner(token) to the module', async () => {
      const unsigned = await new RegisterAdmin().generate(stubChain(), {
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
      // Full calldata, not just the selector — catches a wrong-argument encode (e.g. the
      // registryModule address instead of the token) that `startsWith(selector)` would miss.
      assert.equal(tx.data, OWNER_DATA)
    })

    it('encodes registerAdminViaGetCCIPAdmin(token) for ccip-admin', async () => {
      const unsigned = await new RegisterAdmin().generate(stubChain({ getter: 'getCCIPAdmin' }), {
        tokenAddress: TOKEN,
        registryModule: REGISTRY_MODULE,
        address: ROUTER,
        registrationMethod: 'ccip-admin',
        sender: ADMIN,
      })
      assert.equal(unsigned.transactions[0]!.data, CCIP_ADMIN_DATA)
    })

    it('encodes registerAccessControlDefaultAdmin(token) for access-control-default-admin', async () => {
      const unsigned = await new RegisterAdmin().generate(stubChain(), {
        tokenAddress: TOKEN,
        registryModule: REGISTRY_MODULE,
        address: ROUTER,
        registrationMethod: 'access-control-default-admin',
        sender: ADMIN,
      })
      assert.equal(unsigned.transactions[0]!.data, ACCESS_CONTROL_DATA)
    })

    it('discovers the TAR from the router address', async () => {
      let seen: string | undefined
      const unsigned = await new RegisterAdmin().generate(
        stubChain({
          overrides: {
            getTokenAdminRegistryFor: (address: string) => {
              seen = address
              return Promise.resolve(TAR)
            },
          },
        }),
        { tokenAddress: TOKEN, registryModule: REGISTRY_MODULE, address: ROUTER },
      )
      assert.equal(seen, ROUTER)
      assert.ok(unsigned)
    })

    it('omits `from` when no sender is given (and skips the getter probe)', async () => {
      const unsigned = await new RegisterAdmin().generate(stubChain(), {
        tokenAddress: TOKEN,
        registryModule: REGISTRY_MODULE,
        address: ROUTER,
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })
  })

  describe('per-method token-side probe', () => {
    // These assert the *request* (selector + target), not just a stubbed return value, since
    // `stubChain`'s per-method responses are otherwise indistinguishable (see its doc comment).
    // This is the coverage that would have caught the `access-control-default-admin` blocker: a
    // probe against the wrong selector (`defaultAdmin()`) shows up directly instead of being
    // absorbed by a catch-all stub response.

    it('probes owner() at the token (not the module) for the default method', async () => {
      const calls: RecordedCall[] = []
      await new RegisterAdmin().generate(stubChain({ calls }), {
        tokenAddress: TOKEN,
        registryModule: REGISTRY_MODULE,
        address: ROUTER,
        sender: ADMIN,
      })
      const probe = calls.find((c) => c.data.slice(0, 10) === OWNER_GETTER_SELECTOR)
      assert.ok(probe, 'owner() was probed')
      assert.equal(probe.to, TOKEN)
    })

    it('probes getCCIPAdmin() at the token for ccip-admin', async () => {
      const calls: RecordedCall[] = []
      await new RegisterAdmin().generate(stubChain({ getter: 'getCCIPAdmin', calls }), {
        tokenAddress: TOKEN,
        registryModule: REGISTRY_MODULE,
        address: ROUTER,
        registrationMethod: 'ccip-admin',
        sender: ADMIN,
      })
      const probe = calls.find((c) => c.data.slice(0, 10) === CCIP_ADMIN_GETTER_SELECTOR)
      assert.ok(probe, 'getCCIPAdmin() was probed')
      assert.equal(probe.to, TOKEN)
    })

    it('probes DEFAULT_ADMIN_ROLE()/hasRole(role, sender) at the token for access-control-default-admin', async () => {
      const calls: RecordedCall[] = []
      await new RegisterAdmin().generate(stubChain({ calls }), {
        tokenAddress: TOKEN,
        registryModule: REGISTRY_MODULE,
        address: ROUTER,
        registrationMethod: 'access-control-default-admin',
        sender: ADMIN,
      })

      const roleCall = calls.find((c) => c.data.slice(0, 10) === DEFAULT_ADMIN_ROLE_SELECTOR)
      assert.ok(roleCall, 'DEFAULT_ADMIN_ROLE() was probed')
      assert.equal(roleCall.to, TOKEN)

      const hasRoleCall = calls.find((c) => c.data.slice(0, 10) === HAS_ROLE_SELECTOR)
      assert.ok(hasRoleCall, 'hasRole(role, sender) was probed')
      assert.equal(hasRoleCall.to, TOKEN)
      const [role, account] = accessControlInterface.decodeFunctionData('hasRole', hasRoleCall.data)
      assert.equal(role, ROLE)
      assert.equal(account, ADMIN)
    })
  })

  describe('validation', () => {
    it('rejects an invalid tokenAddress before any RPC', async () => {
      let called = false
      await assert.rejects(
        () =>
          new RegisterAdmin().generate(
            stubChain({
              overrides: {
                getTokenAdminRegistryFor: () => ((called = true), Promise.resolve(TAR)),
              },
            }),
            { tokenAddress: 'nope', registryModule: REGISTRY_MODULE, address: ROUTER },
          ),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'registerAdmin' &&
          err.context.param === 'tokenAddress',
      )
      assert.equal(called, false, 'validation fails before TAR discovery')
    })

    it('rejects an invalid registryModule', async () => {
      await assert.rejects(
        () =>
          new RegisterAdmin().generate(stubChain(), {
            tokenAddress: TOKEN,
            registryModule: 'nope',
            address: ROUTER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'registryModule',
      )
    })

    it('rejects an invalid address', async () => {
      await assert.rejects(
        () =>
          new RegisterAdmin().generate(stubChain(), {
            tokenAddress: TOKEN,
            registryModule: REGISTRY_MODULE,
            address: 'nope',
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'address',
      )
    })

    it('rejects an unrecognised registrationMethod', async () => {
      await assert.rejects(
        () =>
          new RegisterAdmin().generate(stubChain(), {
            tokenAddress: TOKEN,
            registryModule: REGISTRY_MODULE,
            address: ROUTER,
            registrationMethod: 'nope' as never,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'registrationMethod',
      )
    })

    it('rejects a registryModule the TAR does not recognise', async () => {
      await assert.rejects(
        () =>
          new RegisterAdmin().generate(stubChain({ isModule: false }), {
            tokenAddress: TOKEN,
            registryModule: REGISTRY_MODULE,
            address: ROUTER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'registerAdmin' &&
          err.context.param === 'registryModule',
      )
    })

    it('rejects a declared version that disagrees with the module on-chain', async () => {
      // `registryModuleVersion` defaults to 1.6.0, so this declares 1.6.0 against a 1.5.0 module.
      // Both versions encode the shared functions identically, so nothing downstream would notice —
      // the resolved version is what makes the compile-time narrowing true.
      await assert.rejects(
        () =>
          new RegisterAdmin().generate(
            stubChain({ moduleTypeAndVersion: ['RegistryModuleOwnerCustom', '1.5.0'] }),
            {
              tokenAddress: TOKEN,
              registryModule: REGISTRY_MODULE,
              address: ROUTER,
              registrationMethod: 'access-control-default-admin',
            },
          ),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'registryModuleVersion' &&
          typeof err.context.reason === 'string' &&
          err.context.reason.includes('v1.5.0'),
      )
    })

    it('accepts a v1.5.0 module when that version is declared', async () => {
      // The union removes `access-control-default-admin` from `registrationMethod` here, so only
      // the two getter-derived paths are even expressible.
      const unsigned = await new RegisterAdmin().generate(
        stubChain({ moduleTypeAndVersion: ['RegistryModuleOwnerCustom', '1.5.0'] }),
        {
          tokenAddress: TOKEN,
          registryModule: REGISTRY_MODULE,
          address: ROUTER,
          registryModuleVersion: '1.5.0',
          sender: ADMIN,
        },
      )
      assert.equal(unsigned.transactions[0]!.data, OWNER_DATA)
    })

    it('rejects an address that is not a RegistryModuleOwnerCustom', async () => {
      await assert.rejects(
        () =>
          new RegisterAdmin().generate(
            stubChain({ moduleTypeAndVersion: ['TokenPool', '1.6.0'] }),
            {
              tokenAddress: TOKEN,
              registryModule: REGISTRY_MODULE,
              address: ROUTER,
            },
          ),
        (err: unknown) => err instanceof CCTContractTypeInvalidError,
      )
    })

    it('rejects a module reporting an unknown version', async () => {
      await assert.rejects(
        () =>
          new RegisterAdmin().generate(
            stubChain({ moduleTypeAndVersion: ['RegistryModuleOwnerCustom', '9.9.9'] }),
            { tokenAddress: TOKEN, registryModule: REGISTRY_MODULE, address: ROUTER },
          ),
        (err: unknown) => err instanceof CCTContractVersionUnsupportedError,
      )
    })

    it('rejects when sender does not match the token getter for the method', async () => {
      await assert.rejects(
        () =>
          new RegisterAdmin().generate(stubChain({ getterAddress: OTHER }), {
            tokenAddress: TOKEN,
            registryModule: REGISTRY_MODULE,
            address: ROUTER,
            sender: ADMIN,
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects when sender lacks DEFAULT_ADMIN_ROLE for access-control-default-admin', async () => {
      await assert.rejects(
        () =>
          new RegisterAdmin().generate(stubChain({ hasRole: false }), {
            tokenAddress: TOKEN,
            registryModule: REGISTRY_MODULE,
            address: ROUTER,
            registrationMethod: 'access-control-default-admin',
            sender: ADMIN,
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects a token already registered (administrator set)', async () => {
      await assert.rejects(
        () =>
          new RegisterAdmin().generate(
            stubChain({
              tokenConfig: {
                administrator: ADMIN.toLowerCase(),
                pendingAdministrator: ZeroAddress,
                tokenPool: ZeroAddress,
              },
            }),
            { tokenAddress: TOKEN, registryModule: REGISTRY_MODULE, address: ROUTER },
          ),
        // The two already-registered cases carry different remediation (hand the role over vs
        // wait for the pending admin to accept), so each pins its own message — asserting only
        // `param` would let the branches be swapped without any test noticing.
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'tokenAddress' &&
          typeof err.context.reason === 'string' &&
          err.context.reason.includes('already has registry administrator') &&
          err.context.reason.includes(ADMIN),
      )
    })

    it('rejects a token with a pending registration (administrator still zero)', async () => {
      await assert.rejects(
        () =>
          new RegisterAdmin().generate(
            stubChain({
              tokenConfig: {
                administrator: ZeroAddress,
                pendingAdministrator: ADMIN.toLowerCase(),
                tokenPool: ZeroAddress,
              },
            }),
            { tokenAddress: TOKEN, registryModule: REGISTRY_MODULE, address: ROUTER },
          ),
        // Stricter than the contract on purpose: proposeAdministrator would silently overwrite a
        // pending proposal (it only reverts once `administrator` is non-zero), so this guard is
        // the SDK's, and its message must name the address waiting to accept.
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'tokenAddress' &&
          typeof err.context.reason === 'string' &&
          err.context.reason.includes('already pending') &&
          err.context.reason.includes(ADMIN),
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      const result = await new RegisterAdmin().execute(stubChain(), {
        tokenAddress: TOKEN,
        registryModule: REGISTRY_MODULE,
        address: ROUTER,
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('throws CCIPExecTxRevertedError when the tx reverts on-chain', async () => {
      await assert.rejects(
        () =>
          new RegisterAdmin().execute(stubChain(), {
            tokenAddress: TOKEN,
            registryModule: REGISTRY_MODULE,
            address: ROUTER,
            wallet: fakeSigner({ waitError: makeError('execution reverted', 'CALL_EXCEPTION') }),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'registerAdmin',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () =>
          new RegisterAdmin().execute(stubChain(), {
            tokenAddress: TOKEN,
            registryModule: REGISTRY_MODULE,
            address: ROUTER,
            wallet: {},
          }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })

    it('defaults sender to the wallet address, rejecting a wallet that is not the token owner', async () => {
      // The default `execute({ ...params, wallet })` shape — no explicit `sender` — is exactly
      // the path that must not skip the authority check (see `RegisterAdmin.execute`'s doc
      // comment). `stubChain()`'s owner() resolves to ADMIN; this wallet is OTHER.
      await assert.rejects(
        () =>
          new RegisterAdmin().execute(stubChain(), {
            tokenAddress: TOKEN,
            registryModule: REGISTRY_MODULE,
            address: ROUTER,
            wallet: fakeSigner({ address: OTHER }),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'registerAdmin' &&
          err.context.param === 'sender',
      )
    })

    it('rejects a sender that differs from the signing wallet', async () => {
      // Uniform with transferAdmin/acceptAdmin: the module gates on the wallet's msg.sender, so
      // honouring a divergent `sender` would reduce the authority pre-check to advice — the call
      // would pass every local guard and still revert on-chain. Offline/multisig signers use
      // generateUnsignedRegisterAdmin, where `sender` is trusted as given.
      await assert.rejects(
        () =>
          new RegisterAdmin().execute(stubChain(), {
            tokenAddress: TOKEN,
            registryModule: REGISTRY_MODULE,
            address: ROUTER,
            sender: ADMIN,
            wallet: fakeSigner({ address: OTHER }),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'registerAdmin' &&
          err.context.param === 'sender' &&
          // pins the builder name senderBoundToWallet derives from `this.name`, so the shared
          // helper can't start telling registerAdmin callers to use some other method
          typeof err.context.reason === 'string' &&
          err.context.reason.includes('generateUnsignedRegisterAdmin'),
      )
    })

    it('rejects a malformed sender with CCTParamsInvalidError, not a raw ethers error', async () => {
      // senderBoundToWallet validates before getAddress(), which would otherwise throw a raw
      // ethers TypeError. That guard runs ahead of generate()'s own validate(), so nothing else
      // covers it — without this test, deleting it leaves the suite green and silently breaks the
      // documented error taxonomy for every op sharing the helper.
      await assert.rejects(
        () =>
          new RegisterAdmin().execute(stubChain(), {
            tokenAddress: TOKEN,
            registryModule: REGISTRY_MODULE,
            address: ROUTER,
            sender: 'not-an-address',
            wallet: fakeSigner({ address: ADMIN }),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'registerAdmin' &&
          err.context.param === 'sender',
      )
    })

    it('accepts a sender matching the signing wallet', async () => {
      // The redundant-but-explicit call shape: passing `sender` equal to the wallet is allowed, so
      // callers who thread `sender` through both builders and executors need no special-casing.
      const result = await new RegisterAdmin().execute(stubChain(), {
        tokenAddress: TOKEN,
        registryModule: REGISTRY_MODULE,
        address: ROUTER,
        sender: ADMIN,
        wallet: fakeSigner({ address: ADMIN }),
      })
      assert.deepEqual(result, { hash: HASH })
    })
  })
})
