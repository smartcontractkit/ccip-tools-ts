import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { describe, it } from 'node:test'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import {
  MINT_SIZE,
  MULTISIG_SIZE,
  MintLayout,
  MultisigLayout,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import {
  type AccountInfo,
  type Connection,
  type VersionedTransaction,
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
} from '@solana/web3.js'
import BN from 'bn.js'

import { CCIPSourcePoolRevertError } from '../errors/index.ts'
import '../evm/index.ts' // registers the EVM family, the destination of these transfers
import { networkInfo } from '../networks.ts'
import { toLeArray } from '../utils.ts'
import { sighash, sizedCoder } from './coder.ts'
import { IDL as BURN_MINT_TOKEN_POOL_V2_IDL } from './idl/2.0.0/BURN_MINT_TOKEN_POOL.ts'
import { type SolanaSimulateLockOrBurnOpts, simulateLockOrBurn } from './lock-or-burn.ts'
import type { DestChainV2Observation } from './send-v2.ts'
import { SolanaChain } from './index.ts'

const silent = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Console
const poolCoder = sizedCoder(BURN_MINT_TOKEN_POOL_V2_IDL)
const randomKey = () => Keypair.generate().publicKey
const pda = (seeds: (Buffer | Uint8Array)[], program: PublicKey) =>
  PublicKey.findProgramAddressSync(seeds, program)[0]

const LOCK_OR_BURN_V1 = sighash('global', 'lock_or_burn_tokens')
const LOCK_OR_BURN_V2 = sighash('global', 'lock_or_burn_tokens_v2')
const NESTED_RESOLVE = sighash('global', 'nested_resolve_accounts_start')
const DERIVE = sighash('global', 'derive_accounts_lock_or_burn_tokens')
const MINT_TO = 7 // spl-token TokenInstruction.MintTo
const TRANSFER_CHECKED = 12

const ROUTER = randomKey()
const POOL = randomKey()
const MINT = randomKey()
const MINT_AUTHORITY = randomKey()
const RMN = randomKey()
const LUT = randomKey()
const LUT_EXTRA = randomKey()
const NESTED_ACCOUNT = randomKey()
const DERIVED_ACCOUNT = randomKey()
const SENDER = randomKey()
const DEST = 16015286601757825753n // ethereum-sepolia
const POOL_CONFIG = pda([Buffer.from('ccip_tokenpool_config'), MINT.toBuffer()], POOL)
const POOL_SIGNER = pda([Buffer.from('ccip_tokenpool_signer'), MINT.toBuffer()], POOL)
const POOL_ATA = getAssociatedTokenAddressSync(MINT, POOL_SIGNER, true)
const ROUTER_POOL_SIGNER = pda(
  [Buffer.from('external_token_pools_signer'), POOL.toBuffer()],
  ROUTER,
)
const REGISTRY = pda([Buffer.from('token_admin_registry'), MINT.toBuffer()], ROUTER)
const SELECTOR = toLeArray(DEST, 8)
const CHAIN_CONFIG = pda(
  [Buffer.from('ccip_tokenpool_chainconfig'), SELECTOR, MINT.toBuffer()],
  POOL,
)
const CHAIN_CONFIG_V2 = pda(
  [Buffer.from('ccip_tokenpool_chainconfig_2_0'), SELECTOR, MINT.toBuffer()],
  POOL,
)
const CHAIN_CONFIG_OVERRIDE = pda(
  [Buffer.from('chainconfig_override'), SELECTOR, MINT.toBuffer(), Buffer.from('ftf')],
  POOL,
)
// [lookup_table, token_admin_registry, pool_program, pool_config, pool_token_account,
//  pool_signer, token_program, mint, fee_token_config, ccip_router_pool_signer] + extras
const LUT_ADDRESSES = [
  LUT,
  REGISTRY,
  POOL,
  POOL_CONFIG,
  POOL_ATA,
  POOL_SIGNER,
  TOKEN_PROGRAM_ID,
  MINT,
  randomKey(),
  ROUTER_POOL_SIGNER,
  LUT_EXTRA,
]
const WRITABLE_INDEXES = [3, 4, 7]
const DEST_TOKEN = Buffer.concat([Buffer.alloc(12), Buffer.alloc(20, 0xab)])

/** The Router's 32-byte MSB-first writable-index bitmap. */
function writableBitmap(indexes: number[]): Buffer {
  const buf = Buffer.alloc(32)
  for (const i of indexes) {
    const bitPosition = i < 128 ? 127 - i : 255 - i
    const byteIndex = Math.floor(bitPosition / 8) + (i < 128 ? 0 : 16)
    buf[byteIndex]! |= 1 << (bitPosition % 8)
  }
  return buf
}

/** A latest-layout (173B) TokenAdminRegistry account. */
function registryData(
  resolution: 'NoResolution' | 'Standard' | 'WithoutExtendedLookupTable',
  interfaceVersion: number,
) {
  return Buffer.concat([
    BorshAccountsCoder.accountDiscriminator('TokenAdminRegistry'),
    Buffer.from([4]),
    randomKey().toBuffer(),
    PublicKey.default.toBuffer(),
    LUT.toBuffer(),
    writableBitmap(WRITABLE_INDEXES),
    MINT.toBuffer(),
    Buffer.from([
      resolution === 'NoResolution' ? 0 : 1,
      254,
      interfaceVersion,
      resolution === 'WithoutExtendedLookupTable' ? 1 : 0,
    ]),
  ])
}

function mintData(authority: PublicKey | null): Buffer {
  const data = Buffer.alloc(MINT_SIZE)
  MintLayout.encode(
    {
      mintAuthorityOption: authority ? 1 : 0,
      mintAuthority: authority ?? PublicKey.default,
      supply: 0n,
      decimals: 9,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  )
  return data
}

function multisigData(m: number, signers: PublicKey[]): Buffer {
  const data = Buffer.alloc(MULTISIG_SIZE)
  const fields: Record<string, unknown> = { m, n: signers.length, isInitialized: true }
  for (let i = 1; i <= 11; i++) fields[`signer${i}`] = signers[i - 1] ?? PublicKey.default
  MultisigLayout.encode(fields as never, data)
  return data
}

const account = (data: Buffer, owner: PublicKey): AccountInfo<Buffer> => ({
  data,
  owner,
  executable: false,
  lamports: 1,
  rentEpoch: 0,
})

type SimulatedIx = {
  programId: PublicKey
  keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]
  data: Buffer
}
type Outcome = { returnData: Buffer } | { err: unknown; logs: string[] }

/**
 * A connection serving the fixture's registry, mint and lookup tables, answering the pool's
 * resolution simulations with `nested` / `derive`, and the `lockOrBurn` simulation with `lockOrBurn`
 * (called with the simulated instructions, so it can fail the setup instead).
 */
function mockConnection(opts: {
  registry: Buffer
  mintAuthority?: PublicKey | null
  authorityAccount?: AccountInfo<Buffer>
  nested?: (round: number, ix: SimulatedIx) => Buffer
  derive?: (round: number, ix: SimulatedIx) => Buffer
  lockOrBurn: (ixs: SimulatedIx[], attempt: number) => Outcome
}) {
  const tables = new Map<string, AddressLookupTableAccount>()
  const table = (key: PublicKey, addresses: PublicKey[]) => {
    const t = new AddressLookupTableAccount({
      key,
      state: {
        deactivationSlot: 2n ** 64n - 1n,
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        addresses,
      },
    })
    tables.set(key.toBase58(), t)
    return t
  }
  table(LUT, LUT_ADDRESSES)
  const accounts = new Map<string, AccountInfo<Buffer>>([
    [REGISTRY.toBase58(), account(opts.registry, ROUTER)],
    [
      MINT.toBase58(),
      account(
        mintData(opts.mintAuthority === undefined ? MINT_AUTHORITY : opts.mintAuthority),
        TOKEN_PROGRAM_ID,
      ),
    ],
  ])
  if (opts.authorityAccount)
    accounts.set((opts.mintAuthority ?? MINT_AUTHORITY).toBase58(), opts.authorityAccount)

  const calls = {
    nested: [] as SimulatedIx[],
    derive: [] as SimulatedIx[],
    lockOrBurn: [] as SimulatedIx[][],
  }
  const connection = {
    getSignaturesForAddress: () => Promise.resolve([]), // SolanaChain wraps it on construction
    getAccountInfo: (key: PublicKey) => Promise.resolve(accounts.get(key.toBase58()) ?? null),
    getAddressLookupTable: (key: PublicKey) =>
      Promise.resolve({ context: { slot: 0 }, value: tables.get(key.toBase58()) ?? null }),
    simulateTransaction: (tx: VersionedTransaction) => {
      const msg = tx.message
      const keys = msg.getAccountKeys({ addressLookupTableAccounts: [...tables.values()] })
      const ixs: SimulatedIx[] = msg.compiledInstructions.map((ix) => ({
        programId: keys.get(ix.programIdIndex)!,
        keys: ix.accountKeyIndexes.map((i) => ({
          pubkey: keys.get(i)!,
          isSigner: msg.isAccountSigner(i),
          isWritable: msg.isAccountWritable(i),
        })),
        data: Buffer.from(ix.data),
      }))
      // drop the prepended compute budget instruction
      const own = ixs.slice(1)
      const last = own.at(-1)!
      let outcome: Outcome
      if (last.data.subarray(0, 8).equals(NESTED_RESOLVE)) {
        calls.nested.push(last)
        outcome = { returnData: opts.nested!(calls.nested.length - 1, last) }
      } else if (last.data.subarray(0, 8).equals(DERIVE)) {
        calls.derive.push(last)
        outcome = { returnData: opts.derive!(calls.derive.length - 1, last) }
      } else {
        calls.lockOrBurn.push(own)
        outcome = opts.lockOrBurn(own, calls.lockOrBurn.length - 1)
      }
      const value =
        'returnData' in outcome
          ? {
              err: null,
              logs: [],
              unitsConsumed: 0,
              returnData: {
                programId: POOL.toBase58(),
                data: [outcome.returnData.toString('base64'), 'base64'],
              },
            }
          : { err: outcome.err, logs: outcome.logs, unitsConsumed: 0, returnData: null }
      return Promise.resolve({ context: { slot: 0 }, value })
    },
  }
  return { ctx: { connection: connection as unknown as Connection, logger: silent }, calls, table }
}

const lockOrBurnOutV2 = (destPoolData: Buffer, destTokenAmount: bigint) =>
  poolCoder.types.encode('LockOrBurnOutV2', {
    destTokenAddress: { address: DEST_TOKEN },
    destPoolData,
    destTokenAmount: new BN(destTokenAmount.toString()),
  })
const lockOrBurnOutV1 = (destPoolData: Buffer) =>
  poolCoder.types.encode('LockOrBurnOutV1', {
    destTokenAddress: { address: DEST_TOKEN },
    destPoolData,
  })
const nestedResponse = (r: {
  accountsToSave?: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]
  askAgainWith?: PublicKey[]
  next?: Buffer
}) =>
  poolCoder.types.encode('NestedResolveAccountsResponse', {
    askAgainWith: r.askAgainWith ?? [],
    accountsToSave: r.accountsToSave ?? [],
    lookupTablesToSave: [],
    nextCpiResolutionInputs: r.next ?? Buffer.alloc(0),
  })
const deriveResponse = (r: {
  accountsToSave?: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]
  nextStage?: string
}) =>
  poolCoder.types.encode('DeriveAccountsResponse', {
    askAgainWith: [],
    accountsToSave: r.accountsToSave ?? [],
    lookUpTablesToSave: [],
    currentStage: '',
    nextStage: r.nextStage ?? '',
  })
const poolError = (name: string, code: number) => ({
  err: { InstructionError: [2, { Custom: code }] },
  logs: [
    `Program ${POOL.toBase58()} invoke [1]`,
    `Program log: AnchorError thrown in programs/base-token-pool/src/rate_limiter.rs:94. Error Code: ${name}. Error Number: ${code}. Error Message: RateLimit: rate limit reached.`,
    `Program ${POOL.toBase58()} failed: custom program error: 0x${code.toString(16)}`,
  ],
})

const baseOpts: SolanaSimulateLockOrBurnOpts = {
  router: ROUTER,
  laneV2: true,
  rmnRemote: RMN,
  destChainSelector: DEST,
  mint: MINT,
  amount: 1_000_000n,
  originalSender: SENDER,
  receiver: new Uint8Array(32).fill(7, 12),
}

const keysOf = (ix: SimulatedIx) => ix.keys.map(({ pubkey }) => pubkey.toBase58())
const b58 = (...keys: PublicKey[]) => keys.map((k) => k.toBase58())

describe('Solana simulateLockOrBurn', () => {
  it('2.0 pool on a 2.0 lane: router signer, balance setup, LUT extras and resolved accounts', async () => {
    const { ctx, calls } = mockConnection({
      registry: registryData('Standard', 2),
      nested: () =>
        nestedResponse({
          accountsToSave: [{ pubkey: NESTED_ACCOUNT, isSigner: true, isWritable: true }],
        }),
      lockOrBurn: () => ({ returnData: lockOrBurnOutV2(Buffer.from('3047587c', 'hex'), 999_000n) }),
    })
    const result = await simulateLockOrBurn(ctx, baseOpts)

    assert.equal(result.poolInterface, 'v2')
    assert.ok(result.sourcePoolAddress.equals(POOL_CONFIG))
    assert.deepEqual(result.destTokenAddress, DEST_TOKEN)
    assert.equal(result.destPoolData.toString('hex'), '3047587c')
    assert.equal(result.destTokenAmount, 999_000n)

    // the nested resolver starts at the pool state, with the router's signer as caller
    const [nested] = calls.nested
    assert.deepEqual(keysOf(nested!), b58(POOL_CONFIG))
    const params = poolCoder.types.decode<{
      caller: PublicKey
      callerProgram: PublicKey
      cpiResolutionInputs: Buffer
    }>('NestedResolveAccountsParams', nested!.data.subarray(8))
    assert.ok(params.caller.equals(ROUTER_POOL_SIGNER))
    assert.ok(params.callerProgram.equals(ROUTER))
    assert.equal(params.cpiResolutionInputs[0], 0) // TokenPoolCpiResolutionInputs::LockOrBurn

    const [[mintTo, lockOrBurn]] = calls.lockOrBurn as [[SimulatedIx, SimulatedIx]]
    // the router's transfer into the pool, stood in for by a mintTo signed as the mint authority
    assert.ok(mintTo.programId.equals(TOKEN_PROGRAM_ID))
    assert.equal(mintTo.data[0], MINT_TO)
    assert.deepEqual(keysOf(mintTo), b58(MINT, POOL_ATA, MINT_AUTHORITY))
    assert.equal(mintTo.keys[2]!.isSigner, true)

    assert.ok(lockOrBurn.programId.equals(POOL))
    assert.ok(lockOrBurn.data.subarray(0, 8).equals(LOCK_OR_BURN_V2))
    assert.deepEqual(
      keysOf(lockOrBurn),
      b58(
        ROUTER_POOL_SIGNER,
        POOL_CONFIG,
        TOKEN_PROGRAM_ID,
        MINT,
        POOL_SIGNER,
        POOL_ATA,
        CHAIN_CONFIG,
        CHAIN_CONFIG_V2,
        CHAIN_CONFIG_OVERRIDE,
        LUT_EXTRA,
        NESTED_ACCOUNT,
      ),
    )
    assert.equal(lockOrBurn.keys[0]!.isSigner, true)
    // the router drops the signer bit of resolved accounts
    assert.equal(lockOrBurn.keys.at(-1)!.isSigner, false)
    const input = poolCoder.types.decode<{
      originalSender: PublicKey
      amount: BN
      remoteChainSelector: BN
    }>('LockOrBurnInV2', lockOrBurn.data.subarray(8))
    assert.ok(input.originalSender.equals(SENDER))
    assert.equal(input.amount.toString(), '1000000')
    assert.equal(input.remoteChainSelector.toString(), DEST.toString())
  })

  it('follows the nested resolver over several rounds', async () => {
    const second = randomKey()
    const { ctx, calls } = mockConnection({
      registry: registryData('Standard', 2),
      nested: (round) =>
        round === 0
          ? nestedResponse({
              accountsToSave: [{ pubkey: NESTED_ACCOUNT, isSigner: false, isWritable: false }],
              askAgainWith: [second],
              next: Buffer.from([3]),
            })
          : nestedResponse({
              accountsToSave: [{ pubkey: second, isSigner: false, isWritable: true }],
            }),
      lockOrBurn: () => ({ returnData: lockOrBurnOutV2(Buffer.alloc(32), 1_000_000n) }),
    })
    await simulateLockOrBurn(ctx, baseOpts)
    assert.equal(calls.nested.length, 2)
    assert.deepEqual(keysOf(calls.nested[1]!), b58(second))
    const params = poolCoder.types.decode<{ cpiResolutionInputs: Buffer }>(
      'NestedResolveAccountsParams',
      calls.nested[1]!.data.subarray(8),
    )
    assert.deepEqual([...params.cpiResolutionInputs], [3])
    assert.deepEqual(keysOf(calls.lockOrBurn[0]![1]!).slice(-2), b58(NESTED_ACCOUNT, second))
  })

  it('WithoutExtendedLookupTable on a 2.0 lane skips the lookup table extras', async () => {
    const { ctx, calls } = mockConnection({
      registry: registryData('WithoutExtendedLookupTable', 2),
      nested: () => nestedResponse({}),
      lockOrBurn: () => ({ returnData: lockOrBurnOutV2(Buffer.alloc(32), 1_000_000n) }),
    })
    await simulateLockOrBurn(ctx, baseOpts)
    assert.ok(!keysOf(calls.lockOrBurn[0]![1]!).includes(LUT_EXTRA.toBase58()))
  })

  it('1.6 lane: legacy lockOrBurn with RMN accounts, every LUT extra and derived accounts', async () => {
    const { ctx, calls } = mockConnection({
      registry: registryData('WithoutExtendedLookupTable', 2),
      derive: (round) =>
        round === 0
          ? deriveResponse({ nextStage: 'BuildDynamicAccounts' })
          : deriveResponse({
              accountsToSave: [{ pubkey: DERIVED_ACCOUNT, isSigner: false, isWritable: true }],
            }),
      lockOrBurn: () => ({ returnData: lockOrBurnOutV1(Buffer.alloc(32, 1)) }),
    })
    const result = await simulateLockOrBurn(ctx, { ...baseOpts, laneV2: false })
    assert.equal(result.poolInterface, 'v1')
    assert.equal(result.destTokenAmount, 1_000_000n) // v1 pools don't deduct fees
    assert.equal(calls.nested.length, 0)
    assert.equal(calls.derive.length, 2)
    assert.equal(
      calls.derive[1]!.data.subarray(12, 12 + 'BuildDynamicAccounts'.length).toString(),
      'BuildDynamicAccounts',
    )

    const lockOrBurn = calls.lockOrBurn[0]![1]!
    assert.ok(lockOrBurn.data.subarray(0, 8).equals(LOCK_OR_BURN_V1))
    assert.deepEqual(
      keysOf(lockOrBurn),
      b58(
        ROUTER_POOL_SIGNER,
        POOL_CONFIG,
        TOKEN_PROGRAM_ID,
        MINT,
        POOL_SIGNER,
        POOL_ATA,
        RMN,
        pda([Buffer.from('curses')], RMN),
        pda([Buffer.from('config')], RMN),
        CHAIN_CONFIG,
        LUT_EXTRA, // the 1.6 router passes every LUT entry, whatever the resolution
        DERIVED_ACCOUNT,
      ),
    )
  })

  it('a 1.6-interface pool takes the legacy lockOrBurn even on a 2.0 lane', async () => {
    const { ctx, calls } = mockConnection({
      registry: registryData('NoResolution', 1),
      lockOrBurn: () => ({ returnData: lockOrBurnOutV1(Buffer.alloc(32, 1)) }),
    })
    const result = await simulateLockOrBurn(ctx, baseOpts)
    assert.equal(result.poolInterface, 'v1')
    assert.equal(calls.derive.length, 0)
    assert.ok(calls.lockOrBurn[0]![1]!.data.subarray(0, 8).equals(LOCK_OR_BURN_V1))
  })

  it('a multisig mint authority signs the setup with its m signers', async () => {
    const signers = [randomKey(), randomKey(), randomKey()]
    const { ctx, calls } = mockConnection({
      registry: registryData('NoResolution', 2),
      authorityAccount: account(multisigData(2, signers), TOKEN_PROGRAM_ID),
      lockOrBurn: () => ({ returnData: lockOrBurnOutV2(Buffer.alloc(32), 1_000_000n) }),
    })
    await simulateLockOrBurn(ctx, baseOpts)
    const mintTo = calls.lockOrBurn[0]![0]!
    assert.deepEqual(keysOf(mintTo), b58(MINT, POOL_ATA, MINT_AUTHORITY, signers[0]!, signers[1]!))
    assert.deepEqual(
      mintTo.keys.map((k) => k.isSigner),
      [false, false, false, true, true],
    )
  })

  it("without a mint authority, the setup transfers from the sender's token account", async () => {
    const { ctx, calls } = mockConnection({
      registry: registryData('NoResolution', 2),
      mintAuthority: null,
      lockOrBurn: () => ({ returnData: lockOrBurnOutV2(Buffer.alloc(32), 1_000_000n) }),
    })
    await simulateLockOrBurn(ctx, baseOpts)
    const transfer = calls.lockOrBurn[0]![0]!
    assert.equal(transfer.data[0], TRANSFER_CHECKED)
    assert.deepEqual(
      keysOf(transfer),
      b58(getAssociatedTokenAddressSync(MINT, SENDER, true), MINT, POOL_ATA, SENDER),
    )
    assert.equal(transfer.keys[3]!.isSigner, true)
  })

  it('retries without the balance setup when the setup itself fails', async () => {
    const { ctx, calls } = mockConnection({
      registry: registryData('NoResolution', 2),
      lockOrBurn: (_, attempt) =>
        attempt === 0
          ? { err: { InstructionError: [1, { Custom: 5 }] }, logs: [] }
          : { returnData: lockOrBurnOutV2(Buffer.from('3047587c', 'hex'), 1_000_000n) },
    })
    const result = await simulateLockOrBurn(ctx, baseOpts)
    assert.equal(result.destPoolData.toString('hex'), '3047587c')
    assert.equal(calls.lockOrBurn.length, 2)
    assert.equal(calls.lockOrBurn[1]!.length, 1) // just the lockOrBurn
  })

  it("the pool's own error is a typed verdict; a drained rate limit is transient", async () => {
    for (const [name, code, transient] of [
      ['RLRateLimitReached', 6018, true],
      ['InvalidRequestedFinality', 6028, false],
    ] as const) {
      const { ctx } = mockConnection({
        registry: registryData('NoResolution', 2),
        lockOrBurn: () => poolError(name, code),
      })
      await assert.rejects(simulateLockOrBurn(ctx, baseOpts), (err: unknown) => {
        assert.ok(err instanceof CCIPSourcePoolRevertError)
        assert.match(err.message, new RegExp(`${name} \\(${code}\\)`))
        assert.equal(err.isTransient, transient)
        assert.equal(err.context.error, name)
        assert.equal(err.context.tokenPool, POOL_CONFIG.toBase58())
        return true
      })
    }
  })

  it('anything else is not a verdict: framework errors, token program errors, unknown sender', async () => {
    const tokenProgramFailure = {
      err: { InstructionError: [2, { Custom: 1 }] },
      logs: [
        `Program ${POOL.toBase58()} invoke [1]`,
        `Program ${TOKEN_PROGRAM_ID.toBase58()} invoke [2]`,
        'Program log: Error: insufficient funds',
        `Program ${TOKEN_PROGRAM_ID.toBase58()} failed: custom program error: 0x1`,
        `Program ${POOL.toBase58()} failed: custom program error: 0x1`,
      ],
    }
    for (const [outcome, opts] of [
      [poolError('AccountNotInitialized', 3012), baseOpts],
      [tokenProgramFailure, baseOpts],
      [poolError('SenderNotAllowed', 6010), { ...baseOpts, originalSender: undefined }],
    ] as const) {
      const { ctx } = mockConnection({
        registry: registryData('NoResolution', 2),
        lockOrBurn: () => outcome,
      })
      await assert.rejects(simulateLockOrBurn(ctx, opts), (err: unknown) => {
        assert.ok(!(err instanceof CCIPSourcePoolRevertError))
        return true
      })
    }
  })
})

describe('SolanaChain.simulateLockOrBurn', () => {
  /** A chain over the mock connection, whose router is at `version` with its lane in `lane`. */
  function chainFor(
    connection: Connection,
    version: string,
    lane: Awaited<ReturnType<SolanaChain['_observeDestChainV2']>>,
  ) {
    const chain = new SolanaChain(connection, networkInfo('solana-devnet'), {
      apiClient: null,
      logger: silent,
    })
    chain.typeAndVersion = () =>
      Promise.resolve(['Router', version, `ccip-router ${version}`] as Awaited<
        ReturnType<SolanaChain['typeAndVersion']>
      >)
    chain._observeDestChainV2 = () => Promise.resolve(lane)
    chain._getRouterConfig = () =>
      Promise.resolve({ rmnRemote: RMN } as Awaited<ReturnType<SolanaChain['_getRouterConfig']>>)
    return chain
  }
  const openLane = {
    observation: { allowListEnabled: false } as DestChainV2Observation,
  }
  const opts = {
    onRamp: ROUTER.toBase58(),
    destChainSelector: DEST,
    token: MINT.toBase58(),
    amount: 1_000_000n,
    originalSender: SENDER.toBase58(),
    receiver: '0x9eC0e4A4c411493773E01e2ABF4D42395788846b',
  }

  it("a 2.0 router's open lane takes lock_or_burn_tokens_v2; results come in the dest's formats", async () => {
    const { ctx, calls } = mockConnection({
      registry: registryData('NoResolution', 2),
      lockOrBurn: () => ({ returnData: lockOrBurnOutV2(Buffer.from('3047587c', 'hex'), 999n) }),
    })
    const result = await chainFor(ctx.connection, '2.0.1', openLane).simulateLockOrBurn(opts)
    assert.deepEqual(result, {
      sourcePoolAddress: POOL_CONFIG.toBase58(),
      destTokenAddress: '0xABaBaBaBABabABabAbAbABAbABabababaBaBABaB',
      destPoolData: '0x3047587c',
      destTokenAmount: 999n,
    })
    const lockOrBurn = calls.lockOrBurn[0]!.at(-1)!
    assert.ok(lockOrBurn.data.subarray(0, 8).equals(LOCK_OR_BURN_V2))
    // the 20-byte EVM receiver, left-padded to 32 bytes
    const input = poolCoder.types.decode<{ receiver: Buffer }>(
      'LockOrBurnInV2',
      lockOrBurn.data.subarray(8),
    )
    assert.equal(
      input.receiver.toString('hex'),
      '0000000000000000000000009ec0e4a4c411493773e01e2abf4d42395788846b',
    )
  })

  it('a tokenReceiver takes precedence over the receiver', async () => {
    const { ctx, calls } = mockConnection({
      registry: registryData('NoResolution', 2),
      lockOrBurn: () => ({ returnData: lockOrBurnOutV2(Buffer.alloc(32), 1n) }),
    })
    await chainFor(ctx.connection, '2.0.1', openLane).simulateLockOrBurn({
      ...opts,
      tokenReceiver: '0x00000000000000000000000000000000000000aa',
    })
    const input = poolCoder.types.decode<{ receiver: Buffer }>(
      'LockOrBurnInV2',
      calls.lockOrBurn[0]!.at(-1)!.data.subarray(8),
    )
    assert.equal(input.receiver.at(-1), 0xaa)
  })

  it('a 1.6 router, or a 2.0 lane that is unavailable, takes lock_or_burn_tokens', async () => {
    for (const [version, lane] of [
      ['1.6.0', openLane],
      ['2.0.1', { reason: 'lane-not-configured' }],
      ['2.0.1', { observation: { allowListEnabled: true } as DestChainV2Observation }],
    ] as const) {
      const { ctx, calls } = mockConnection({
        registry: registryData('NoResolution', 2),
        lockOrBurn: () => ({ returnData: lockOrBurnOutV1(Buffer.alloc(32, 1)) }),
      })
      const result = await chainFor(ctx.connection, version, lane).simulateLockOrBurn(opts)
      assert.ok(calls.lockOrBurn[0]!.at(-1)!.data.subarray(0, 8).equals(LOCK_OR_BURN_V1))
      assert.equal(result.destTokenAmount, 1_000_000n)
    }
  })
})
