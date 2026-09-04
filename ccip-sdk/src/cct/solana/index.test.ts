import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'

import { SolanaChain } from '../../solana/index.ts'
import { deriveTokenAdminRegistryPda } from './programs/router.ts'
import {
  TOKEN_POOL_PROGRAMS,
  deriveTokenPoolConfigPda,
  deriveTokenPoolSignerPda,
} from './programs/token-pool.ts'
import type {
  GetTokenPoolStateParams,
  GetTokenPoolStateResult,
} from './token-pool/operations/index.ts'
import { METADATA_PROGRAM_ID } from './token/constants.ts'
import {
  type RegisterAdminMethod,
  type TokenAuthorityType,
  DEFAULT_WRITABLE_INDEXES,
  REGISTRATION_METHODS,
  SolanaTokenManager,
  TOKEN_AUTHORITY_TYPES,
} from './index.ts'

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {},
  } as unknown as SolanaChain
}

describe('SolanaTokenManager (cct/solana)', () => {
  it('exports public CCT constants', () => {
    const authorityType: TokenAuthorityType = TOKEN_AUTHORITY_TYPES.MINT
    const method: RegisterAdminMethod = REGISTRATION_METHODS.OWNER

    assert.equal(authorityType, 'mint')
    assert.equal(TOKEN_AUTHORITY_TYPES.FREEZE, 'freeze')
    assert.equal(method, 'owner')
    assert.equal(REGISTRATION_METHODS.CCIP_ADMIN, 'ccip-admin')
    assert.deepEqual(DEFAULT_WRITABLE_INDEXES, [3, 4, 7])
  })

  it('creates from a connection provider', async (t) => {
    const chain = stubChain()
    const connection = new Connection('http://localhost:8899')
    t.mock.method(SolanaChain, 'fromConnection', async (provider: Connection) => {
      assert.equal(provider, connection)
      return chain
    })

    const cct = await SolanaTokenManager.fromProvider(connection)

    assert.equal(cct.chain, chain)
  })

  it('creates from an RPC URL', async (t) => {
    const chain = stubChain()
    t.mock.method(SolanaChain, 'fromUrl', async (url: string) => {
      assert.equal(url, 'http://localhost:8899')
      return chain
    })

    const cct = await SolanaTokenManager.fromUrl('http://localhost:8899')

    assert.equal(cct.chain, chain)
  })

  it('getTokenPoolState accepts params whose pool program is not known statically', () => {
    const cct = SolanaTokenManager.fromChain(stubChain())
    // A parameter is not narrowed to one PoolProgramRef arm the way a const literal is, so this
    // only compiles while a `GetTokenPoolStateParams` overload is declared: TypeScript never
    // exposes the implementation signature to callers.
    const read = (opts: GetTokenPoolStateParams): Promise<GetTokenPoolStateResult> =>
      cct.getTokenPoolState(opts)

    assert.equal(typeof read, 'function')
  })

  describe('facade operations', () => {
    const payer = Keypair.generate().publicKey.toBase58()
    const mint = Keypair.generate().publicKey.toBase58()
    const pool = Keypair.generate().publicKey.toBase58()
    const account = Keypair.generate().publicKey.toBase58()
    const reader = Keypair.generate().publicKey.toBase58()
    const remoteChainSelector = 5009297550715157269n

    function chain(): SolanaChain {
      const mintAccount = Buffer.alloc(82)
      mintAccount.writeUInt32LE(1, 0)
      new PublicKey(payer).toBuffer().copy(mintAccount, 4)
      mintAccount[44] = 6
      mintAccount[45] = 1
      const tokenAccount = Buffer.alloc(165)
      new PublicKey(mint).toBuffer().copy(tokenAccount, 0)
      new PublicKey(payer).toBuffer().copy(tokenAccount, 32)
      tokenAccount.writeBigUInt64LE(1n, 64)
      tokenAccount.writeUInt32LE(1, 72)
      deriveTokenPoolSignerPda(
        new PublicKey(TOKEN_POOL_PROGRAMS['lock-release']),
        new PublicKey(mint),
      )
        .toBuffer()
        .copy(tokenAccount, 76)
      tokenAccount[108] = 1
      tokenAccount.writeBigUInt64LE(1n, 121)
      const poolProgram = new PublicKey(TOKEN_POOL_PROGRAMS['lock-release'])
      const poolStateAddress = deriveTokenPoolConfigPda(poolProgram, new PublicKey(mint))
      const registryAddress = deriveTokenAdminRegistryPda(
        new PublicKey(account),
        new PublicKey(mint),
      )
      const readerRegistryAddress = deriveTokenAdminRegistryPda(
        new PublicKey(pool),
        new PublicKey(mint),
      )
      const registry = Buffer.alloc(170)
      BorshAccountsCoder.accountDiscriminator('TokenAdminRegistry').copy(registry)
      registry[8] = 2
      new PublicKey(payer).toBuffer().copy(registry, 9)
      new PublicKey(payer).toBuffer().copy(registry, 41)
      new PublicKey(account).toBuffer().copy(registry, 73)
      registry[120] = 0x19
      new PublicKey(mint).toBuffer().copy(registry, 137)
      registry[169] = 1
      const [metadataAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), new PublicKey(mint).toBuffer()],
        METADATA_PROGRAM_ID,
      )
      const metadata = Buffer.concat([
        Buffer.from([4]),
        new PublicKey(payer).toBuffer(),
        new PublicKey(mint).toBuffer(),
        Buffer.alloc(14),
        Buffer.from([0, 0, 1, 0, 0, 0, 0, 0]),
      ])
      const poolState = Buffer.concat([
        BorshAccountsCoder.accountDiscriminator('State'),
        Buffer.from([1]),
        poolProgram.toBuffer(),
        new PublicKey(mint).toBuffer(),
        Buffer.from([6]),
        ...Array.from({ length: 8 }, () => new PublicKey(payer).toBuffer()),
        Buffer.from([1, 1, 0, 0, 0, 0]),
        new PublicKey(payer).toBuffer(),
        new PublicKey(payer).toBuffer(),
        new PublicKey(payer).toBuffer(),
      ])
      const accounts = new Map([
        [new PublicKey(mint).toBase58(), { owner: TOKEN_PROGRAM_ID, data: mintAccount }],
        [metadataAddress.toBase58(), { owner: METADATA_PROGRAM_ID, data: metadata }],
        [poolStateAddress.toBase58(), { owner: poolProgram, data: poolState }],
        [registryAddress.toBase58(), null],
        [readerRegistryAddress.toBase58(), { data: registry }],
      ])
      const defaultAccount = { owner: TOKEN_PROGRAM_ID, data: tokenAccount }

      return {
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        connection: {
          rpcEndpoint: 'http://localhost:8899',
          getAccountInfo: async (address: PublicKey) => {
            const key = address.toBase58()
            return accounts.has(key) ? accounts.get(key) : defaultAccount
          },
          getMinimumBalanceForRentExemption: async () => 1,
          getSlot: async () => 1,
          getAddressLookupTable: async () => ({
            value: {
              state: {
                authority: new PublicKey(payer),
                addresses: [
                  PublicKey.default,
                  PublicKey.default,
                  PublicKey.default,
                  new PublicKey(pool),
                ],
              },
            },
          }),
          simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 1 } }),
          getLatestBlockhash: async () => ({
            blockhash: PublicKey.default.toBase58(),
            lastValidBlockHeight: 1,
          }),
          sendTransaction: async () => PublicKey.default.toBase58(),
          confirmTransaction: async () => ({ value: { err: null } }),
        },
        getTokenAdminRegistryFor: async (address: string) => (address === reader ? pool : account),
        getSupportedTokens: async () => [mint],
        getTokenPoolRemotes: async () => ({}),
        getRegistryTokenConfig: async () => ({ administrator: payer, pendingAdministrator: payer }),
      } as unknown as SolanaChain
    }

    const facadeChain = chain()

    it('runs every unsigned facade operation', async () => {
      const cct = SolanaTokenManager.fromChain(facadeChain)
      const common = {
        payer,
        tokenAddress: mint,
        authority: payer,
        poolType: 'lock-release' as const,
      }
      const cases: Array<
        [string, () => Promise<{ instructions: unknown[] } | { instructions: unknown[] }[]>]
      > = [
        [
          'deployToken',
          () => cct.generateUnsignedDeployToken({ payer, decimals: 6, withMetaplex: false }),
        ],
        [
          'approveToken',
          () => cct.generateUnsignedApproveToken({ ...common, delegate: account, amount: 1n }),
        ],
        [
          'createTokenAccount',
          () =>
            cct.generateUnsignedCreateTokenAccount({
              payer,
              tokenAddress: mint,
              ownerAddress: account,
            }),
        ],
        [
          'mintTokens',
          () => cct.generateUnsignedMintTokens({ ...common, recipient: account, amount: 1n }),
        ],
        [
          'setTokenAuthority',
          () =>
            cct.generateUnsignedSetTokenAuthority({
              ...common,
              newAuthority: account,
              authorityTypes: ['mint'],
            }),
        ],
        [
          'updateMetadataAuthority',
          () => cct.generateUnsignedUpdateMetadataAuthority({ ...common, newAuthority: account }),
        ],
        [
          'createTokenMultisig',
          () =>
            cct.generateUnsignedCreateTokenMultisig({
              payer,
              tokenAddress: mint,
              poolType: 'lock-release',
              threshold: 1,
            }),
        ],
        [
          'createLookupTable',
          () =>
            cct.generateUnsignedCreateLookupTable({ payer, authority: payer, mode: 'createEmpty' }),
        ],
        [
          'configureAllowlist',
          () =>
            cct.generateUnsignedConfigureAllowlist({ ...common, add: [account], enabled: true }),
        ],
        ['deployTokenPool', () => cct.generateUnsignedDeployTokenPool(common)],
        [
          'applyChainUpdates',
          () =>
            cct.generateUnsignedApplyChainUpdates({
              ...common,
              remoteChainSelectorsToRemove: [],
              chainsToAdd: [
                {
                  remoteChainSelector,
                  remoteTokenAddress: '0x01',
                  remotePoolAddresses: ['0x02'],
                  remoteTokenDecimals: 6,
                  inboundRateLimiterConfig: { enabled: false },
                  outboundRateLimiterConfig: { enabled: false },
                },
              ],
            }),
        ],
        [
          'appendRemotePoolAddresses',
          () =>
            cct.generateUnsignedAppendRemotePoolAddresses({
              ...common,
              remoteChainSelector,
              remotePoolAddresses: ['0x01'],
            }),
        ],
        [
          'initChainRemoteConfig',
          () =>
            cct.generateUnsignedInitChainRemoteConfig({
              ...common,
              remoteChainSelector,
              remoteTokenAddress: '0x01',
              remoteTokenDecimals: 6,
            }),
        ],
        [
          'deleteChainRemoteConfig',
          () => cct.generateUnsignedDeleteChainRemoteConfig({ ...common, remoteChainSelector }),
        ],
        [
          'setRateLimitAdmin',
          () => cct.generateUnsignedSetRateLimitAdmin({ ...common, newRateLimitAdmin: account }),
        ],
        ['provideLiquidity', () => cct.generateUnsignedProvideLiquidity({ ...common, amount: 1n })],
        [
          'withdrawLiquidity',
          () => cct.generateUnsignedWithdrawLiquidity({ ...common, amount: 1n }),
        ],
        [
          'setCanAcceptLiquidity',
          () => cct.generateUnsignedSetCanAcceptLiquidity({ ...common, allow: true }),
        ],
        [
          'setRebalancer',
          () => cct.generateUnsignedSetRebalancer({ ...common, rebalancer: account }),
        ],
        [
          'transferOwnership',
          () => cct.generateUnsignedTransferOwnership({ ...common, newOwner: account }),
        ],
        ['acceptOwnership', () => cct.generateUnsignedAcceptOwnership(common)],
        [
          'setChainRateLimit',
          () =>
            cct.generateUnsignedSetChainRateLimit({
              ...common,
              remoteChainSelector,
              inbound: { enabled: false },
              outbound: { enabled: false },
            }),
        ],
        [
          'editChainRemoteConfig',
          () =>
            cct.generateUnsignedEditChainRemoteConfig({
              ...common,
              remoteChainSelector,
              remoteTokenAddress: '0x01',
              remotePoolAddresses: ['0x02'],
              remoteTokenDecimals: 6,
            }),
        ],
        [
          'appendToLookupTable',
          () =>
            cct.generateUnsignedAppendToLookupTable({
              payer,
              lookupTableAddress: account,
              additionalAddresses: [mint],
            }),
        ],
        ['acceptAdmin', () => cct.generateUnsignedAcceptAdmin({ ...common, address: account })],
        ['registerAdmin', () => cct.generateUnsignedRegisterAdmin({ ...common, address: account })],
        [
          'removeFromAllowlist',
          () => cct.generateUnsignedRemoveFromAllowlist({ ...common, remove: [account] }),
        ],
        [
          'setPool',
          () =>
            cct.generateUnsignedSetPool({
              ...common,
              address: account,
              poolLookupTableAddress: account,
            }),
        ],
        [
          'transferAdmin',
          () =>
            cct.generateUnsignedTransferAdmin({ ...common, address: account, newAdmin: account }),
        ],
      ]

      for (const [name, operation] of cases) {
        const result = await operation()
        assert.ok(
          (Array.isArray(result) ? result[0] : result)?.instructions.length,
          `${name} returns instructions`,
        )
      }
    })

    it('runs every signed facade operation', async () => {
      const cct = SolanaTokenManager.fromChain(facadeChain)
      const wallet = { publicKey: new PublicKey(payer), signTransaction: async <T>(tx: T) => tx }
      const signed: Array<
        [string, () => Promise<{ hash: string } | { hash: string }[] | { hashes: string[] }>]
      > = [
        ['deployToken', () => cct.deployToken({ wallet, decimals: 6, withMetaplex: false })],
        [
          'approveToken',
          () => cct.approveToken({ wallet, tokenAddress: mint, delegate: account, amount: 1n }),
        ],
        [
          'createTokenAccount',
          () => cct.createTokenAccount({ wallet, tokenAddress: mint, ownerAddress: account }),
        ],
        [
          'mintTokens',
          () => cct.mintTokens({ wallet, tokenAddress: mint, recipient: account, amount: 1n }),
        ],
        [
          'setTokenAuthority',
          () =>
            cct.setTokenAuthority({
              wallet,
              tokenAddress: mint,
              newAuthority: account,
              authorityTypes: ['mint'],
            }),
        ],
        [
          'updateMetadataAuthority',
          () => cct.updateMetadataAuthority({ wallet, tokenAddress: mint, newAuthority: account }),
        ],
        [
          'createTokenMultisig',
          () =>
            cct.createTokenMultisig({
              wallet,
              tokenAddress: mint,
              poolType: 'lock-release',
              threshold: 1,
            }),
        ],
        ['createLookupTable', () => cct.createLookupTable({ wallet, mode: 'createEmpty' })],
        [
          'configureAllowlist',
          () =>
            cct.configureAllowlist({
              wallet,
              tokenAddress: mint,
              poolType: 'lock-release',
              add: [account],
              enabled: true,
            }),
        ],
        [
          'deployTokenPool',
          () => cct.deployTokenPool({ wallet, tokenAddress: mint, poolType: 'lock-release' }),
        ],
        [
          'applyChainUpdates',
          () =>
            cct.applyChainUpdates({
              wallet,
              tokenAddress: mint,
              poolType: 'lock-release',
              remoteChainSelectorsToRemove: [],
              chainsToAdd: [
                {
                  remoteChainSelector,
                  remoteTokenAddress: '0x01',
                  remotePoolAddresses: ['0x02'],
                  remoteTokenDecimals: 6,
                  inboundRateLimiterConfig: { enabled: false },
                  outboundRateLimiterConfig: { enabled: false },
                },
              ],
            }),
        ],
        [
          'appendRemotePoolAddresses',
          () =>
            cct.appendRemotePoolAddresses({
              wallet,
              tokenAddress: mint,
              poolType: 'lock-release',
              remoteChainSelector,
              remotePoolAddresses: ['0x01'],
            }),
        ],
        [
          'initChainRemoteConfig',
          () =>
            cct.initChainRemoteConfig({
              wallet,
              tokenAddress: mint,
              poolType: 'lock-release',
              remoteChainSelector,
              remoteTokenAddress: '0x01',
              remoteTokenDecimals: 6,
            }),
        ],
        [
          'deleteChainRemoteConfig',
          () =>
            cct.deleteChainRemoteConfig({
              wallet,
              tokenAddress: mint,
              poolType: 'lock-release',
              remoteChainSelector,
            }),
        ],
        [
          'setRateLimitAdmin',
          () =>
            cct.setRateLimitAdmin({
              wallet,
              tokenAddress: mint,
              poolType: 'lock-release',
              newRateLimitAdmin: account,
            }),
        ],
        [
          'provideLiquidity',
          () =>
            cct.provideLiquidity({
              wallet,
              tokenAddress: mint,
              poolType: 'lock-release',
              amount: 1n,
            }),
        ],
        [
          'withdrawLiquidity',
          () =>
            cct.withdrawLiquidity({
              wallet,
              tokenAddress: mint,
              poolType: 'lock-release',
              amount: 1n,
            }),
        ],
        [
          'setCanAcceptLiquidity',
          () =>
            cct.setCanAcceptLiquidity({
              wallet,
              tokenAddress: mint,
              poolType: 'lock-release',
              allow: true,
            }),
        ],
        [
          'setRebalancer',
          () =>
            cct.setRebalancer({
              wallet,
              tokenAddress: mint,
              poolType: 'lock-release',
              rebalancer: account,
            }),
        ],
        [
          'transferOwnership',
          () =>
            cct.transferOwnership({
              wallet,
              tokenAddress: mint,
              poolType: 'lock-release',
              newOwner: account,
            }),
        ],
        [
          'acceptOwnership',
          () => cct.acceptOwnership({ wallet, tokenAddress: mint, poolType: 'lock-release' }),
        ],
        [
          'setChainRateLimit',
          () =>
            cct.setChainRateLimit({
              wallet,
              tokenAddress: mint,
              poolType: 'lock-release',
              remoteChainSelector,
              inbound: { enabled: false },
              outbound: { enabled: false },
            }),
        ],
        [
          'editChainRemoteConfig',
          () =>
            cct.editChainRemoteConfig({
              wallet,
              tokenAddress: mint,
              poolType: 'lock-release',
              remoteChainSelector,
              remoteTokenAddress: '0x01',
              remotePoolAddresses: ['0x02'],
              remoteTokenDecimals: 6,
            }),
        ],
        [
          'appendToLookupTable',
          () =>
            cct.appendToLookupTable({
              wallet,
              lookupTableAddress: account,
              additionalAddresses: [mint],
            }),
        ],
        ['acceptAdmin', () => cct.acceptAdmin({ wallet, tokenAddress: mint, address: account })],
        [
          'registerAdmin',
          () => cct.registerAdmin({ wallet, tokenAddress: mint, address: account }),
        ],
        [
          'removeFromAllowlist',
          () =>
            cct.removeFromAllowlist({
              wallet,
              tokenAddress: mint,
              poolType: 'lock-release',
              remove: [account],
            }),
        ],
        [
          'setPool',
          () =>
            cct.setPool({
              wallet,
              tokenAddress: mint,
              address: account,
              poolLookupTableAddress: account,
            }),
        ],
        [
          'transferAdmin',
          () =>
            cct.transferAdmin({ wallet, tokenAddress: mint, address: account, newAdmin: account }),
        ],
      ]

      for (const [name, operation] of signed) {
        const result = await operation()
        const hashes = Array.isArray(result)
          ? result.map(({ hash }) => hash)
          : 'hashes' in result
            ? result.hashes
            : [result.hash]
        assert.ok(hashes.length && hashes.every(Boolean), `${name} returns transaction hashes`)
      }
    })

    it('runs every read facade operation', async () => {
      const cct = SolanaTokenManager.fromChain(facadeChain)
      const reads: Array<[string, () => Promise<object | string[]>]> = [
        [
          'getTokenPoolRemotes',
          () =>
            cct.getTokenPoolRemotes({
              tokenAddress: mint,
              poolType: 'lock-release',
              remoteChainSelector,
            }),
        ],
        [
          'getTokenPoolState',
          () => cct.getTokenPoolState({ tokenAddress: mint, poolType: 'lock-release' }),
        ],
        [
          'getTokenAdminRegistry',
          () => cct.getTokenAdminRegistry({ tokenAddress: mint, address: reader }),
        ],
        ['getSupportedTokens', () => cct.getSupportedTokens({ address: reader })],
      ]

      for (const [name, read] of reads) {
        const result = await read()
        assert.ok(typeof result === 'object', `${name} returns a result`)
      }
    })
  })
})
