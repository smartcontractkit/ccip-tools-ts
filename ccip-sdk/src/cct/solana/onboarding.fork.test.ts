/**
 * Token pool onboarding against CCIP 2.0 Solana programs, on a Surfpool fork of prod testnet.
 *
 * Validates that the CCIP 1.6 encoders behind {@link SolanaTokenManager} are accepted by the 2.0
 * pool and router programs, and exercises the 2.0-only operations against them.
 *
 * Every onboarding step runs twice: through `execute*` with the wallet signing, and through the
 * external-signer (Squads) path, where `generateUnsigned*` output is serialized with
 * `serializeUnsignedTx` and signed by a separate vault key.
 *
 * Run: `cd ccip-sdk && node --test src/cct/solana/onboarding.fork.test.ts` (needs `surfpool`;
 * `VERBOSE=1` mirrors the fork's logs).
 */
import assert from 'node:assert/strict'
import { Console } from 'node:console'
import { after, before, describe, it } from 'node:test'
import { inspect } from 'node:util'

import { BorshCoder, Wallet as AnchorWallet } from '@coral-xyz/anchor'
import { getAssociatedTokenAddressSync, getMint } from '@solana/spl-token'
import {
  type Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  VersionedMessage,
  VersionedTransaction,
} from '@solana/web3.js'

import { rpcEndpoint } from '../../../../scripts/test-endpoints.ts'
import { useResourceForDescribe } from '../../../../scripts/useResource.ts'
import { networkInfo } from '../../index.ts'
import {
  type SurfpoolInstance,
  VERBOSE,
  isSurfpoolAvailable,
  startFork,
  stopFork,
  surfnetRequest,
} from '../../solana/__tests__/surfpool.ts'
import { IDL as CCIP_ROUTER_V2_IDL } from '../../solana/idl/2.0.0/CCIP_ROUTER.ts'
import { lockReleaseTokenPoolCoder } from '../../solana/idl/token-pool-coder.ts'
import { SolanaChain } from '../../solana/index.ts'
import {
  decodeTokenPoolChainConfigOverride,
  deriveTokenPoolChainConfigOverridePda,
} from '../../solana/token-pool.ts'
import type { UnsignedSolanaTx } from '../../solana/types.ts'
import { CCIPVersion } from '../../types.ts'
import { CCTOperationUnsupportedError } from '../errors.ts'
import { refreshAccountState } from './operation.ts'
import { deriveTokenPoolConfigPda } from './programs/token-pool.ts'
import type { RateLimitConfig } from './token-pool/operations/set-chain-rate-limit.ts'
import { SolanaTokenManager } from './index.ts'

/** The prod testnet CCIP deployment on devnet, running the 2.0 programs. */
const PROD_TESTNET = {
  router: 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C',
  burnMintPool: '41FGToCmdaWa1dgZLKFAjvmx6e6AjVTX7SVRibvsMGVB',
  lockReleasePool: '8eqh8wppT9c5rw4ERqNCffvU6cNFJWff9WmkcYtmGiqC',
  // Sepolia has a 2.0 lane (`dest_chain_state_v2`) on this router
  remoteSelector: networkInfo('ethereum-testnet-sepolia').chainSelector,
}

// Placeholder remote side: the Solana programs store but never dereference these
const REMOTE_TOKEN = '0x1111111111111111111111111111111111111111'
const REMOTE_POOL = '0x2222222222222222222222222222222222222222'
const REMOTE_POOL_2 = '0x3333333333333333333333333333333333333333'
const RECEIVER = '0x9eC0e4A4c411493773E01e2ABF4D42395788846b'

const DECIMALS = 9
const PRE_MINT = 1_000_000n * 10n ** BigInt(DECIMALS)
const RATE_LIMIT: RateLimitConfig = {
  enabled: true,
  capacity: 100_000n * 10n ** BigInt(DECIMALS),
  rate: 10n ** BigInt(DECIMALS),
}

const skip = !!process.env.SKIP_INTEGRATION_TESTS || !isSurfpoolAvailable()

/** Whether a failed send names a program error or log, wherever the SDK or web3.js put the logs. */
const failsWith = (name: string) => (err: unknown) => inspect(err, { depth: 6 }).includes(name)

const testLogger = new Console(process.stdout, process.stderr)
if (!VERBOSE) testLogger.debug = () => {}

describe('Solana CCT onboarding on CCIP 2.0 (devnet fork)', { skip, timeout: 600_000 }, () => {
  useResourceForDescribe(['solana-devnet'])

  const fork: { surfpool?: SurfpoolInstance; connection?: Connection } = {}
  let chain: SolanaChain
  let cct: SolanaTokenManager
  const issuer = Keypair.generate()

  const conn = () => fork.connection!

  async function fund(...keys: Keypair[]) {
    for (const key of keys) {
      const sig = await conn().requestAirdrop(key.publicKey, 10 * LAMPORTS_PER_SOL)
      await conn().confirmTransaction(sig)
    }
  }

  /**
   * Reads a mint as it is now. `getMint` goes through the connection's `getAccountInfo`, which
   * SolanaChain memoizes for 5s, so a plain read right after a write returns the old mint.
   */
  async function readMint(mint: PublicKey) {
    refreshAccountState(chain)
    return getMint(conn(), mint)
  }

  /** Deploys an SPL token pre-minted to the issuer, with the issuer as its mint authority. */
  async function deployToken(): Promise<string> {
    const { tokenAddress } = await cct.deployToken({
      decimals: DECIMALS,
      withMetaplex: false,
      preMint: PRE_MINT,
      preMintRecipient: issuer.publicKey.toBase58(),
      wallet: new AnchorWallet(issuer),
    })
    return tokenAddress
  }

  /** Signs a serialized external-signer message, as Squads would, then lands it. */
  async function signAndSend(unsigned: UnsignedSolanaTx, signer: Keypair): Promise<string> {
    const serialized = await cct.serializeUnsignedTx(
      unsigned,
      signer.publicKey.toBase58(),
      'base64',
    )
    const message = VersionedMessage.deserialize(Buffer.from(serialized, 'base64'))
    const tx = new VersionedTransaction(message)
    tx.sign([signer])
    const signature = await conn().sendTransaction(tx)
    const { lastValidBlockHeight } = await conn().getLatestBlockhash()
    const { value } = await conn().confirmTransaction(
      { signature, blockhash: message.recentBlockhash, lastValidBlockHeight },
      'confirmed',
    )
    assert.equal(value.err, null, `externally signed tx ${signature} failed`)
    return signature
  }

  /**
   * Adds `sender` to the 2.0 lane's sender allowlist on the fork. Devnet's Sepolia lane has its
   * allowlist enabled, so sends must come from an allowlisted sender and opt in with
   * `sendV2OnAllowlistedLanes`.
   */
  async function allowlistSender(sender: PublicKey) {
    const selectorLe = Buffer.alloc(8)
    selectorLe.writeBigUInt64LE(PROD_TESTNET.remoteSelector)
    const [laneState] = PublicKey.findProgramAddressSync(
      [Buffer.from('dest_chain_state_v2'), selectorLe],
      new PublicKey(PROD_TESTNET.router),
    )
    // getAccountInfoAndContext bypasses SolanaChain's 5s getAccountInfo memo
    const { value: account } = await conn().getAccountInfoAndContext(laneState)
    assert.ok(account, 'the Sepolia lane should have a 2.0 state')
    const coder = new BorshCoder(CCIP_ROUTER_V2_IDL)
    const state = coder.accounts.decode<{
      config: { allowListEnabled: boolean; allowedSenders: PublicKey[] }
    }>('destChainCcipV2', account.data)
    if (!state.config.allowListEnabled) return
    const data = await coder.accounts.encode('destChainCcipV2', {
      ...state,
      config: { ...state.config, allowedSenders: [...state.config.allowedSenders, sender] },
    })
    await surfnetRequest(conn(), 'surfnet_setAccount', [
      laneState.toBase58(),
      { data: data.toString('hex'), lamports: account.lamports },
    ])
  }

  before(async () => {
    Object.assign(
      fork,
      await startFork({ upstreamUrl: rpcEndpoint('RPC_SOLANA_DEVNET'), port: 8677 }),
    )
    chain = new SolanaChain(conn(), networkInfo('solana-devnet'), {
      apiClient: null,
      logger: testLogger,
    })
    cct = SolanaTokenManager.fromChain(chain)
    await fund(issuer)
    await allowlistSender(issuer.publicKey)
  })

  after(async () => {
    await stopFork(fork)
  })

  for (const mode of ['wallet', 'external'] as const) {
    describe(`burn-mint onboarding, ${mode === 'wallet' ? 'wallet-signed' : 'external signer (Squads path)'}`, () => {
      // The pool owner and token admin: the issuer itself, or a vault the issuer hands over to
      const admin = mode === 'wallet' ? issuer : Keypair.generate()
      const newOwner = Keypair.generate()
      let tokenAddress: string
      let poolSigner: string
      let lookupTable: string

      /**
       * Runs one CCT op as `admin`: `execute*` for the wallet, `generateUnsigned*` otherwise, landing
       * each generated transaction in order.
       */
      async function run<E, G extends UnsignedSolanaTx | UnsignedSolanaTx[]>(
        execute: (wallet: AnchorWallet) => Promise<E>,
        generate: (payer: string) => Promise<G>,
      ): Promise<E | G> {
        if (mode === 'wallet') return execute(new AnchorWallet(admin))
        const unsigned = await generate(admin.publicKey.toBase58())
        for (const tx of Array.isArray(unsigned) ? unsigned : [unsigned])
          await signAndSend(tx, admin)
        return unsigned
      }

      before(async () => {
        if (admin !== issuer) await fund(admin)
        await fund(newOwner)
        tokenAddress = await deployToken()
        if (admin !== issuer) {
          // Self-served pool initialization and registration both authorize the mint authority
          await cct.setTokenAuthority({
            tokenAddress,
            newAuthority: admin.publicKey.toBase58(),
            authorityTypes: ['mint'],
            wallet: new AnchorWallet(issuer),
          })
        }
      })

      it('deploys the pool, self-served by the mint authority', async () => {
        const params = { tokenAddress, poolType: 'burn-mint' as const, createPoolSignerATA: true }
        const result = await run(
          (wallet) => cct.deployTokenPool({ ...params, wallet }),
          (payer) => cct.generateUnsignedDeployTokenPool({ ...params, payer }),
        )
        poolSigner = result.poolSignerAddress

        const { config } = await cct.getTokenPoolState({ tokenAddress })
        assert.equal(config.owner, admin.publicKey.toBase58())
        assert.equal(config.router, PROD_TESTNET.router, 'pool should default to the 2.0 router')
      })

      it('registers and accepts the token admin', async () => {
        const params = { tokenAddress, address: PROD_TESTNET.router }
        await run(
          (wallet) => cct.registerAdmin({ ...params, wallet }),
          (payer) => cct.generateUnsignedRegisterAdmin({ ...params, payer }),
        )
        await run(
          (wallet) => cct.acceptAdmin({ ...params, wallet }),
          (payer) => cct.generateUnsignedAcceptAdmin({ ...params, payer }),
        )
        const registry = await cct.getTokenAdminRegistry(params)
        assert.equal(registry.administrator, admin.publicKey.toBase58())
        assert.equal(registry.pendingAdministrator, undefined)
      })

      it('creates the pool lookup table and sets the pool', async () => {
        ;({ lookupTableAddress: lookupTable } = await run(
          (wallet) => cct.createLookupTable({ tokenAddress, wallet }),
          (payer) => cct.generateUnsignedCreateLookupTable({ tokenAddress, payer }),
        ))
        const params = {
          tokenAddress,
          address: PROD_TESTNET.router,
          poolLookupTableAddress: lookupTable,
        }
        await run(
          (wallet) => cct.setPool({ ...params, wallet }),
          (payer) => cct.generateUnsignedSetPool({ ...params, payer }),
        )

        const registry = await cct.getTokenAdminRegistry({
          tokenAddress,
          address: PROD_TESTNET.router,
        })
        assert.equal(registry.lookupTable, lookupTable)
        // A pool set through the legacy instruction stays on the v1 pool interface
        assert.equal(registry.interfaceVersion, 1)
      })

      it('connects the remote chain with rate limits', async () => {
        const params = {
          tokenAddress,
          chainsToAdd: [
            {
              remoteChainSelector: PROD_TESTNET.remoteSelector,
              remoteTokenAddress: REMOTE_TOKEN,
              remotePoolAddresses: [REMOTE_POOL],
              remoteTokenDecimals: 18,
              inboundRateLimiterConfig: RATE_LIMIT,
              outboundRateLimiterConfig: RATE_LIMIT,
            },
          ],
          remoteChainSelectorsToRemove: [],
        }
        await run(
          (wallet) => cct.applyChainUpdates({ ...params, wallet }),
          (payer) => cct.generateUnsignedApplyChainUpdates({ ...params, payer }),
        )

        const remotes = await cct.getTokenPoolRemotes({ tokenAddress })
        const remote = remotes[networkInfo(PROD_TESTNET.remoteSelector).name]
        assert.ok(remote, 'the remote chain should be configured')
        assert.equal(remote.remoteToken.toLowerCase(), REMOTE_TOKEN)
        assert.deepEqual(
          remote.remotePools.map((p) => p.toLowerCase()),
          [REMOTE_POOL],
        )
        assert.equal(remote.outboundRateLimiterState?.capacity, RATE_LIMIT.capacity)
        assert.equal(remote.inboundRateLimiterState?.capacity, RATE_LIMIT.capacity)
      })

      it('hands the mint authority to the pool signer', async () => {
        const params = {
          tokenAddress,
          newAuthority: poolSigner,
          authorityTypes: ['mint' as const],
        }
        await run(
          (wallet) => cct.setTokenAuthority({ ...params, wallet }),
          (payer) => cct.generateUnsignedSetTokenAuthority({ ...params, payer }),
        )
        const mint = await readMint(new PublicKey(tokenAddress))
        assert.equal(mint.mintAuthority?.toBase58(), poolSigner)
      })

      it('transfers the onboarded token over the 2.0 lane', async () => {
        const amount = 10n ** BigInt(DECIMALS)
        const mintKey = new PublicKey(tokenAddress)
        const ata = getAssociatedTokenAddressSync(mintKey, issuer.publicKey)
        const balance = async () => BigInt((await conn().getTokenAccountBalance(ata)).value.amount)
        const [balanceBefore, supplyBefore] = [await balance(), (await readMint(mintKey)).supply]

        const request = await chain.sendMessage({
          router: PROD_TESTNET.router,
          destChainSelector: PROD_TESTNET.remoteSelector,
          message: {
            receiver: RECEIVER,
            tokenAmounts: [{ token: tokenAddress, amount }],
            extraArgs: { finality: 'finalized' },
          },
          wallet: new AnchorWallet(issuer),
          sendV2OnAllowlistedLanes: true,
        })

        assert.equal(request.lane.version, CCIPVersion.V2_0, 'the send should take the 2.0 lane')
        assert.equal(request.message.tokenAmounts[0]?.amount, amount)
        assert.equal(balanceBefore - (await balance()), amount, 'tokens should leave the sender')
        assert.equal(
          supplyBefore - (await readMint(mintKey)).supply,
          amount,
          'the pool should burn what it received',
        )
      })

      // ── Ops outside the onboarding flow, each checked on its own ──

      it('configures and clears the allowlist', async () => {
        const listed = Keypair.generate().publicKey.toBase58()
        const add = { tokenAddress, add: [listed], enabled: true }
        await run(
          (wallet) => cct.configureAllowlist({ ...add, wallet }),
          (payer) => cct.generateUnsignedConfigureAllowlist({ ...add, payer }),
        )
        let { config } = await cct.getTokenPoolState({ tokenAddress })
        assert.equal(config.listEnabled, true)
        assert.deepEqual(config.allowList, [listed])

        const remove = { tokenAddress, remove: [listed] }
        await run(
          (wallet) => cct.removeFromAllowlist({ ...remove, wallet }),
          (payer) => cct.generateUnsignedRemoveFromAllowlist({ ...remove, payer }),
        )
        const disable = { tokenAddress, add: [], enabled: false }
        await run(
          (wallet) => cct.configureAllowlist({ ...disable, wallet }),
          (payer) => cct.generateUnsignedConfigureAllowlist({ ...disable, payer }),
        )
        ;({ config } = await cct.getTokenPoolState({ tokenAddress }))
        assert.equal(config.listEnabled, false)
        assert.deepEqual(config.allowList, [])
      })

      it('sets the rate limit admin, who then sets the chain rate limit', async () => {
        const rateLimitAdmin = Keypair.generate()
        await fund(rateLimitAdmin)
        const params = { tokenAddress, newRateLimitAdmin: rateLimitAdmin.publicKey.toBase58() }
        await run(
          (wallet) => cct.setRateLimitAdmin({ ...params, wallet }),
          (payer) => cct.generateUnsignedSetRateLimitAdmin({ ...params, payer }),
        )
        const { config } = await cct.getTokenPoolState({ tokenAddress })
        assert.equal(config.rateLimitAdmin, rateLimitAdmin.publicKey.toBase58())

        const doubled = { ...RATE_LIMIT, capacity: RATE_LIMIT.capacity * 2n }
        await cct.setChainRateLimit({
          tokenAddress,
          remoteChainSelector: PROD_TESTNET.remoteSelector,
          inbound: doubled,
          outbound: doubled,
          wallet: new AnchorWallet(rateLimitAdmin),
        })
        const remotes = await cct.getTokenPoolRemotes({
          tokenAddress,
          remoteChainSelector: PROD_TESTNET.remoteSelector,
        })
        const remote = remotes[networkInfo(PROD_TESTNET.remoteSelector).name]
        assert.equal(remote?.outboundRateLimiterState?.capacity, doubled.capacity)
      })

      it('appends, edits, deletes and re-inits the remote chain config', async () => {
        const remoteChainSelector = PROD_TESTNET.remoteSelector
        const remoteName = networkInfo(remoteChainSelector).name
        const remotePools = async () =>
          (await cct.getTokenPoolRemotes({ tokenAddress }))[remoteName]?.remotePools.map((p) =>
            p.toLowerCase(),
          )

        const append = { tokenAddress, remoteChainSelector, remotePoolAddresses: [REMOTE_POOL_2] }
        await run(
          (wallet) => cct.appendRemotePoolAddresses({ ...append, wallet }),
          (payer) => cct.generateUnsignedAppendRemotePoolAddresses({ ...append, payer }),
        )
        assert.deepEqual(await remotePools(), [REMOTE_POOL, REMOTE_POOL_2])

        const edit = {
          tokenAddress,
          remoteChainSelector,
          remoteTokenAddress: REMOTE_TOKEN,
          remotePoolAddresses: [REMOTE_POOL_2],
          remoteTokenDecimals: 18,
        }
        await run(
          (wallet) => cct.editChainRemoteConfig({ ...edit, wallet }),
          (payer) => cct.generateUnsignedEditChainRemoteConfig({ ...edit, payer }),
        )
        assert.deepEqual(await remotePools(), [REMOTE_POOL_2])

        const del = { tokenAddress, remoteChainSelector }
        await run(
          (wallet) => cct.deleteChainRemoteConfig({ ...del, wallet }),
          (payer) => cct.generateUnsignedDeleteChainRemoteConfig({ ...del, payer }),
        )
        assert.equal(await remotePools(), undefined)

        const init = {
          tokenAddress,
          remoteChainSelector,
          remoteTokenAddress: REMOTE_TOKEN,
          remoteTokenDecimals: 18,
        }
        await run(
          (wallet) => cct.initChainRemoteConfig({ ...init, wallet }),
          (payer) => cct.generateUnsignedInitChainRemoteConfig({ ...init, payer }),
        )
        assert.deepEqual(await remotePools(), [])
      })

      it('configures the 2.0 lane config, FTF rate limits, fees, and pool interface', async () => {
        const remoteChainSelector = PROD_TESTNET.remoteSelector
        const mint = new PublicKey(tokenAddress)
        const poolProgram = new PublicKey(PROD_TESTNET.burnMintPool)
        const pool = deriveTokenPoolConfigPda(poolProgram, mint).toBase58()
        const laneConfig = () => {
          refreshAccountState(chain)
          return chain.getTokenPoolConfig(pool, { destChainSelector: remoteChainSelector })
        }
        const fee = {
          destGasOverhead: 90_000,
          destBytesOverhead: 32,
          finalityFeeUSDCents: 10,
          fastFinalityFeeUSDCents: 20,
          finalityTransferFeeBps: 5,
          fastFinalityTransferFeeBps: 10,
          isEnabled: true,
        }
        const ccv = Keypair.generate().publicKey.toBase58()

        const init = {
          tokenAddress,
          remoteChainSelector,
          allowedFinality: { finalityDepth: 5 },
          tokenTransferFeeConfig: fee,
          ccvConfig: { outboundCCVs: [ccv], inboundCCVs: [ccv] },
        }
        await run(
          (wallet) => cct.initChainConfigV2({ ...init, wallet }),
          (payer) => cct.generateUnsignedInitChainConfigV2({ ...init, payer }),
        )
        let config = await laneConfig()
        assert.equal(config.finalityDepth, 5)
        assert.equal(config.finalitySafe, undefined)
        assert.deepEqual(config.tokenTransferFeeConfig, fee)

        // a full replacement: the omitted fee config resets to disabled
        const edit = {
          tokenAddress,
          remoteChainSelector,
          allowedFinality: { finalityDepth: 0, finalitySafe: true },
        }
        await run(
          (wallet) => cct.editChainConfigV2({ ...edit, wallet }),
          (payer) => cct.generateUnsignedEditChainConfigV2({ ...edit, payer }),
        )
        config = await laneConfig()
        assert.equal(config.finalityDepth, 0)
        assert.equal(config.finalitySafe, true)
        assert.equal(config.tokenTransferFeeConfig?.isEnabled, false)

        const override = deriveTokenPoolChainConfigOverridePda(
          poolProgram,
          remoteChainSelector,
          mint,
        )
        const ftfInboundCapacity = async () => {
          const { value } = await conn().getAccountInfoAndContext(override)
          return (
            value &&
            decodeTokenPoolChainConfigOverride(value.data).inboundRateLimit.cfg.capacity.toString()
          )
        }
        const limits = {
          tokenAddress,
          remoteChainSelector,
          inbound: RATE_LIMIT,
          outbound: RATE_LIMIT,
        }
        await run(
          (wallet) => cct.initFastFinalityRateLimit({ ...limits, wallet }),
          (payer) => cct.generateUnsignedInitFastFinalityRateLimit({ ...limits, payer }),
        )
        assert.equal(await ftfInboundCapacity(), RATE_LIMIT.capacity.toString())
        const doubled = { ...RATE_LIMIT, capacity: RATE_LIMIT.capacity * 2n }
        const set = { ...limits, inbound: doubled }
        await run(
          (wallet) => cct.setFastFinalityRateLimit({ ...set, wallet }),
          (payer) => cct.generateUnsignedSetFastFinalityRateLimit({ ...set, payer }),
        )
        assert.equal(await ftfInboundCapacity(), doubled.capacity.toString())
        const del = { tokenAddress, remoteChainSelector }
        await run(
          (wallet) => cct.deleteFastFinalityRateLimit({ ...del, wallet }),
          (payer) => cct.generateUnsignedDeleteFastFinalityRateLimit({ ...del, payer }),
        )
        assert.equal(await ftfInboundCapacity(), null)

        // initChainConfigV2 created the empty in-token fee vault: the program gets past every
        // account constraint and stops at the balance check
        const withdraw = {
          tokenAddress,
          feeTokenAddress: tokenAddress,
          recipient: admin.publicKey.toBase58(),
        }
        await assert.rejects(
          run(
            (wallet) => cct.withdrawFeeTokens({ ...withdraw, wallet }),
            (payer) => cct.generateUnsignedWithdrawFeeTokens({ ...withdraw, payer }),
          ),
          failsWith('NoFeesToWithdraw'),
        )

        // registerAdmin created the registry at the router's latest layout, so there is nothing
        // to migrate, but the router recognizes the instruction
        const registry = { tokenAddress, address: PROD_TESTNET.router }
        await assert.rejects(
          run(
            (wallet) => cct.upgradeTokenAdminRegistry({ ...registry, wallet }),
            (payer) => cct.generateUnsignedUpgradeTokenAdminRegistry({ ...registry, payer }),
          ),
          failsWith('InvalidInputsTokenAdminRegistryAccounts'),
        )
        const iface = {
          ...registry,
          interfaceVersion: 2 as const,
          accountResolution: 'Standard' as const,
        }
        await run(
          (wallet) => cct.setPoolInterfaceImplementation({ ...iface, wallet }),
          (payer) => cct.generateUnsignedSetPoolInterfaceImplementation({ ...iface, payer }),
        )
        const updated = await cct.getTokenAdminRegistry(registry)
        assert.equal(updated.interfaceVersion, 2)
        assert.equal(updated.accountResolution, 'Standard')
      })

      it('transfers pool ownership and the token admin role', async () => {
        const newKey = newOwner.publicKey.toBase58()
        const pool = { tokenAddress, newOwner: newKey }
        await run(
          (wallet) => cct.transferPoolOwnership({ ...pool, wallet }),
          (payer) => cct.generateUnsignedTransferPoolOwnership({ ...pool, payer }),
        )
        await cct.acceptPoolOwnership({ tokenAddress, wallet: new AnchorWallet(newOwner) })
        const { config } = await cct.getTokenPoolState({ tokenAddress })
        assert.equal(config.owner, newKey)

        const registry = { tokenAddress, address: PROD_TESTNET.router, newAdmin: newKey }
        await run(
          (wallet) => cct.transferAdmin({ ...registry, wallet }),
          (payer) => cct.generateUnsignedTransferAdmin({ ...registry, payer }),
        )
        await cct.acceptAdmin({
          tokenAddress,
          address: PROD_TESTNET.router,
          wallet: new AnchorWallet(newOwner),
        })
        const { administrator } = await cct.getTokenAdminRegistry({
          tokenAddress,
          address: PROD_TESTNET.router,
        })
        assert.equal(administrator, newKey)
      })
    })
  }

  it('self-serves a pool as a 1-of-N signer of the mint authority multisig', async () => {
    const wallet = new AnchorWallet(issuer)
    const tokenAddress = await deployToken()
    // the pool signer and the issuer, either of which can sign for the mint authority
    const { multisigAddress } = await cct.createTokenMultisig({
      tokenAddress,
      poolType: 'burn-mint',
      threshold: 1,
      wallet,
    })
    await cct.setTokenAuthority({
      tokenAddress,
      newAuthority: multisigAddress,
      authorityTypes: ['mint'],
      wallet,
    })

    const { poolSignerAddress } = await cct.deployTokenPool({
      tokenAddress,
      poolType: 'burn-mint',
      mintAuthorityMultisig: multisigAddress,
      createPoolSignerATA: true,
      wallet,
    })
    const { config } = await cct.getTokenPoolState({ tokenAddress })
    assert.equal(config.owner, issuer.publicKey.toBase58())
    assert.equal(config.poolSigner, poolSignerAddress)
  })

  describe('lock-release liquidity', () => {
    const wallet = () => new AnchorWallet(issuer)
    let tokenAddress: string
    let poolState: PublicKey

    /** Rewrites the pool's deprecated `can_accept_liquidity` flag on the fork. */
    async function setCanAcceptLiquidityFlag(allow: boolean) {
      const account = await conn().getAccountInfo(poolState)
      assert.ok(account, 'the pool state should exist')
      const state = lockReleaseTokenPoolCoder.accounts.decode<{
        config: { canAcceptLiquidity: boolean }
      }>('state', account.data)
      state.config.canAcceptLiquidity = allow
      const encoded = await lockReleaseTokenPoolCoder.accounts.encode('state', state)
      const data = Buffer.alloc(account.data.length)
      encoded.copy(data)
      await surfnetRequest(conn(), 'surfnet_setAccount', [
        poolState.toBase58(),
        { data: data.toString('hex') },
      ])
    }

    before(async () => {
      tokenAddress = await deployToken()
      const { poolAddress } = await cct.deployTokenPool({
        tokenAddress,
        poolType: 'lock-release',
        createPoolSignerATA: true,
        wallet: wallet(),
      })
      poolState = new PublicKey(poolAddress)
      await cct.setRebalancer({
        tokenAddress,
        rebalancer: issuer.publicKey.toBase58(),
        wallet: wallet(),
      })
    })

    it('initializes 2.0 pools accepting liquidity', async () => {
      const { config } = await cct.getTokenPoolState({ tokenAddress })
      assert.ok(
        'canAcceptLiquidity' in config,
        'a lock-release pool should report liquidity fields',
      )
      assert.equal(config.canAcceptLiquidity, true)
      assert.equal(config.rebalancer, issuer.publicKey.toBase58())
    })

    it('provides and withdraws liquidity', async () => {
      const amount = 1_000n * 10n ** BigInt(DECIMALS)
      const { config } = await cct.getTokenPoolState({ tokenAddress })
      const poolBalance = async () =>
        BigInt(
          (await conn().getTokenAccountBalance(new PublicKey(config.poolTokenAccount))).value
            .amount,
        )

      await cct.provideLiquidity({ tokenAddress, amount, includeApproval: true, wallet: wallet() })
      assert.equal(await poolBalance(), amount)
      await cct.withdrawLiquidity({ tokenAddress, amount, wallet: wallet() })
      assert.equal(await poolBalance(), 0n)
    })

    // A pool upgraded from 1.6 keeps its stored flag, but 2.0 neither sets nor enforces it

    it('rejects setCanAcceptLiquidity before sending, since 2.0 removed the instruction', async () => {
      await assert.rejects(
        cct.setCanAcceptLiquidity({ tokenAddress, allow: true, wallet: wallet() }),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError && err.context.version === '2.0.0',
      )
    })

    it('moves liquidity on a pool flagged closed, since 2.0 ignores the flag', async () => {
      await setCanAcceptLiquidityFlag(false)
      try {
        await cct.provideLiquidity({
          tokenAddress,
          amount: 1n,
          includeApproval: true,
          wallet: wallet(),
        })
        await cct.withdrawLiquidity({ tokenAddress, amount: 1n, wallet: wallet() })
      } finally {
        await setCanAcceptLiquidityFlag(true)
      }
    })
  })
})
