import { Buffer } from 'buffer'
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import {
  type AccountMeta,
  type Connection,
  type VersionedTransaction,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SendTransactionError,
} from '@solana/web3.js'

import { CCIPError } from '../errors/CCIPError.ts'
import {
  CCIPSolanaAccountResolutionError,
  CCIPSolanaLookupTableNotFoundError,
} from '../errors/index.ts'
import {
  type ResolveAccountsResponse,
  CCIP_SEND_V2_DISCRIMINATOR,
  EXECUTE_V2_DISCRIMINATOR,
  GET_FEE_V2_DISCRIMINATOR,
  RESOLVE_ACCOUNTS_START_DISCRIMINATOR,
  decodeResolveAccountsResponse,
  encodeResolveAccountsIx,
  fetchLookupTables,
  resolutionStageName,
  resolveAccounts,
  resolveExecuteV2,
  resolveGetFeeV2,
} from './resolution.ts'

const silent = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Console
const randomKey = () => Keypair.generate().publicKey

// Independent Borsh writer, so the codec is checked against the Rust layout rather than itself
const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
const vec = (items: Buffer[]) => Buffer.concat([u32(items.length), ...items])
const bytes = (data: Buffer) => Buffer.concat([u32(data.length), data])
function encodeResponse(r: ResolveAccountsResponse): Buffer {
  return Buffer.concat([
    vec(r.askAgainWith.map((key) => key.toBuffer())),
    vec(
      r.accountsToSave.map((meta) =>
        Buffer.concat([meta.pubkey.toBuffer(), Buffer.from([+meta.isSigner, +meta.isWritable])]),
      ),
    ),
    vec(r.lookupTablesToSave.map((key) => key.toBuffer())),
    r.nextIxDiscriminator
      ? Buffer.concat([Buffer.from([1]), r.nextIxDiscriminator])
      : Buffer.from([0]),
    bytes(r.metadata),
  ])
}

const meta = (pubkey: PublicKey, isSigner = false, isWritable = false): AccountMeta => ({
  pubkey,
  isSigner,
  isWritable,
})

const response = (r: Partial<ResolveAccountsResponse>): ResolveAccountsResponse => ({
  askAgainWith: [],
  accountsToSave: [],
  lookupTablesToSave: [],
  nextIxDiscriminator: null,
  metadata: Buffer.alloc(0),
  ...r,
})

/** The last instruction of a simulated tx, with account flags read back from the message. */
function lastInstruction(tx: VersionedTransaction) {
  const msg = tx.message
  const keys = msg.staticAccountKeys
  const ix = msg.compiledInstructions.at(-1)!
  return {
    programId: keys[ix.programIdIndex]!,
    keys: ix.accountKeyIndexes.map((i) => ({
      pubkey: keys[i]!,
      isSigner: msg.isAccountSigner(i),
      isWritable: msg.isAccountWritable(i),
    })),
    data: Buffer.from(ix.data),
    programIds: msg.compiledInstructions.map((ix) => keys[ix.programIdIndex]!.toBase58()),
  }
}

/** A connection whose simulations return the given responses, one per call, from `programId`. */
function scriptedConnection(programId: PublicKey, responses: (ResolveAccountsResponse | Buffer)[]) {
  let call = 0
  const simulateTransaction = mock.fn(async (_tx: VersionedTransaction) => {
    const next = responses[call++]
    assert.ok(next, 'unexpected extra simulation')
    const data = Buffer.isBuffer(next) ? next : encodeResponse(next)
    return {
      value: {
        err: null,
        logs: [],
        unitsConsumed: 1000,
        returnData: { programId: programId.toBase58(), data: [data.toString('base64'), 'base64'] },
      },
    }
  })
  const getAddressLookupTable = mock.fn(async (key: PublicKey) => ({
    value: { key, state: { addresses: [] } },
  }))
  const connection = { simulateTransaction, getAddressLookupTable } as unknown as Connection
  return { connection, simulateTransaction, getAddressLookupTable }
}

describe('account resolution codec', () => {
  it('pins the upstream discriminators', () => {
    assert.deepEqual([...RESOLVE_ACCOUNTS_START_DISCRIMINATOR], [195, 88, 233, 63, 16, 50, 55, 52])
    assert.deepEqual([...GET_FEE_V2_DISCRIMINATOR], [178, 49, 15, 7, 35, 31, 31, 250])
    assert.deepEqual([...CCIP_SEND_V2_DISCRIMINATOR], [175, 63, 145, 145, 211, 111, 21, 183])
    assert.deepEqual([...EXECUTE_V2_DISCRIMINATOR], [110, 12, 255, 88, 93, 207, 223, 214])
  })

  it('names known stages and falls back to hex', () => {
    assert.equal(
      resolutionStageName(RESOLVE_ACCOUNTS_START_DISCRIMINATOR),
      'resolve_accounts_start',
    )
    assert.equal(
      resolutionStageName(Buffer.from([87, 98, 7, 159, 213, 131, 155, 118])),
      'resolve_accounts_fee_token_billing_stage',
    )
    assert.equal(
      resolutionStageName(Buffer.from([168, 232, 96, 186, 197, 204, 35, 41])),
      'resolve_accounts_execute_message_stage',
    )
    assert.equal(resolutionStageName(Buffer.alloc(8, 0xab)), '0xabababababababab')
  })

  it('decodes a response laid out like the Rust struct', () => {
    const expected = response({
      askAgainWith: [randomKey(), randomKey()],
      accountsToSave: [
        meta(randomKey(), true, true),
        meta(randomKey()),
        meta(randomKey(), false, true),
      ],
      lookupTablesToSave: [randomKey()],
      nextIxDiscriminator: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
      metadata: Buffer.from('deadbeef', 'hex'),
    })
    const encoded = encodeResponse(expected)
    // ResolveAccountsResponse::size(3, 2, 1, 4): 34 per meta, 32 per key, 4 per vec prefix, 9 for the Option
    assert.equal(encoded.length, 4 + 34 * 3 + (4 + 32 * 2) + (4 + 32) + 9 + (4 + 4))
    assert.deepEqual(decodeResolveAccountsResponse(encoded), expected)
  })

  it('decodes a terminal response', () => {
    const decoded = decodeResolveAccountsResponse(encodeResponse(response({})))
    assert.equal(decoded.nextIxDiscriminator, null)
    assert.deepEqual(decoded.accountsToSave, [])
  })

  it('encodes stage instructions as discriminator || borsh(params) over readonly accounts', () => {
    const programId = randomKey()
    const caller = randomKey()
    const accounts = [randomKey(), randomKey()]
    const ixData = Buffer.from('0102030405060708aa', 'hex')
    const metadata = Buffer.from('ff', 'hex')
    const ix = encodeResolveAccountsIx(
      programId,
      RESOLVE_ACCOUNTS_START_DISCRIMINATOR,
      { caller, ixData, metadata },
      accounts,
    )
    assert.ok(ix.programId.equals(programId))
    assert.deepEqual(
      ix.keys,
      accounts.map((pubkey) => meta(pubkey)),
    )
    assert.deepEqual(
      ix.data,
      Buffer.concat([
        RESOLVE_ACCOUNTS_START_DISCRIMINATOR,
        caller.toBuffer(),
        bytes(ixData),
        bytes(metadata),
      ]),
    )
  })
})

describe('resolveAccounts', () => {
  const programId = randomKey()
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)
  const caller = randomKey()
  const ixData = Buffer.concat([GET_FEE_V2_DISCRIMINATOR, Buffer.from([9, 9, 9])])

  it('follows stages, forwarding metadata and accumulating accounts and lookup tables', async () => {
    const stage2 = Buffer.from([2, 2, 2, 2, 2, 2, 2, 2])
    const stage3 = Buffer.from([3, 3, 3, 3, 3, 3, 3, 3])
    const extra = randomKey()
    const [a, b, c, ask1, ask2, lut1, lut2] = Array.from({ length: 7 }, randomKey)
    const rounds = [
      response({
        askAgainWith: [ask1!, ask2!],
        accountsToSave: [meta(a!), meta(caller, true, true)],
        lookupTablesToSave: [lut1!],
        nextIxDiscriminator: stage2,
        metadata: Buffer.from([1]),
      }),
      response({
        askAgainWith: [ask2!],
        // duplicates must survive: the final layout is positional
        accountsToSave: [meta(b!, false, true), meta(a!)],
        nextIxDiscriminator: stage3,
        metadata: Buffer.from([2, 2]),
      }),
      response({
        accountsToSave: [meta(c!)],
        lookupTablesToSave: [lut2!, lut1!],
        metadata: Buffer.from([3, 3, 3]),
      }),
    ]
    const { connection, simulateTransaction } = scriptedConnection(programId, rounds)

    const resolved = await resolveAccounts(
      { connection, logger: silent },
      { programId, caller, ixData, extraAccounts: [extra] },
    )

    assert.equal(resolved.rounds, 3)
    assert.deepEqual(resolved.accounts, [
      meta(a!),
      meta(caller, true, true),
      meta(b!, false, true),
      meta(a!),
      meta(c!),
    ])
    assert.deepEqual(resolved.lookupTables, [lut1, lut2, lut1])
    assert.deepEqual(resolved.metadata, Buffer.from([3, 3, 3]))

    const calls = simulateTransaction.mock.calls.map((call) => lastInstruction(call.arguments[0]))
    const expected = [
      { disc: RESOLVE_ACCOUNTS_START_DISCRIMINATOR, keys: [config, extra], metadata: [] },
      { disc: stage2, keys: [ask1!, ask2!], metadata: [1] },
      { disc: stage3, keys: [ask2!], metadata: [2, 2] },
    ]
    for (const [i, call] of calls.entries()) {
      const { disc, keys, metadata } = expected[i]!
      assert.ok(call.programId.equals(programId))
      // compute budget comes first: CU limit, then heap frame
      assert.deepEqual(call.programIds, [
        ComputeBudgetProgram.programId.toBase58(),
        ComputeBudgetProgram.programId.toBase58(),
        programId.toBase58(),
      ])
      assert.deepEqual(
        call.keys,
        keys.map((pubkey) => meta(pubkey)),
      )
      assert.deepEqual(
        call.data,
        Buffer.concat([disc, caller.toBuffer(), bytes(ixData), bytes(Buffer.from(metadata))]),
      )
    }
  })

  it('rejects a stage without return data', async () => {
    const simulateTransaction = mock.fn(async () => ({
      value: { err: null, logs: [], unitsConsumed: 1 },
    }))
    const connection = { simulateTransaction } as unknown as Connection
    await assert.rejects(
      resolveAccounts({ connection, logger: silent }, { programId, caller, ixData }),
      (err: unknown) => err instanceof CCIPError && err.code === 'SOLANA_SIMULATION_NO_RETURN_DATA',
    )
  })

  it('rejects return data from another program', async () => {
    const { connection } = scriptedConnection(randomKey(), [response({})])
    await assert.rejects(
      resolveAccounts({ connection, logger: silent }, { programId, caller, ixData }),
      (err: unknown) =>
        err instanceof CCIPSolanaAccountResolutionError &&
        /return data came from/.test(err.message),
    )
  })

  it('rejects a malformed response', async () => {
    const { connection } = scriptedConnection(programId, [Buffer.from([1, 2, 3])])
    await assert.rejects(
      resolveAccounts({ connection, logger: silent }, { programId, caller, ixData }),
      (err: unknown) =>
        err instanceof CCIPSolanaAccountResolutionError && /malformed/.test(err.message),
    )
  })

  it('stops after maxRounds', async () => {
    const loop = response({ nextIxDiscriminator: Buffer.alloc(8, 7) })
    const { connection, simulateTransaction } = scriptedConnection(programId, [loop, loop, loop])
    await assert.rejects(
      resolveAccounts({ connection, logger: silent }, { programId, caller, ixData, maxRounds: 3 }),
      (err: unknown) =>
        err instanceof CCIPSolanaAccountResolutionError &&
        err.context.round === 4 &&
        err.context.stage === '0x0707070707070707',
    )
    assert.equal(simulateTransaction.mock.calls.length, 3)
  })

  it('names CommonCcipError failures, keeping the simulation error as cause', async () => {
    const simulateTransaction = mock.fn(async () => ({
      value: {
        err: { InstructionError: [2, { Custom: 10015 }] },
        logs: ['Program log: AnchorError'],
        unitsConsumed: 1,
      },
    }))
    const connection = { simulateTransaction } as unknown as Connection
    await assert.rejects(
      resolveAccounts({ connection, logger: silent }, { programId, caller, ixData }),
      (err: unknown) =>
        err instanceof CCIPSolanaAccountResolutionError &&
        /InvalidResolutionInstructionData \(10015\)/.test(err.message) &&
        err.context.stage === 'resolve_accounts_start' &&
        err.cause instanceof SendTransactionError,
    )
  })

  it('names other program errors from the Anchor error log', async () => {
    const simulateTransaction = mock.fn(async () => ({
      value: {
        err: { InstructionError: [2, { Custom: 3012 }] },
        logs: [
          'Program log: AnchorError caused by account: pool_chain_config. Error Code: AccountNotInitialized. Error Number: 3012. Error Message: The program expected this account to be already initialized.',
        ],
        unitsConsumed: 1,
      },
    }))
    const connection = { simulateTransaction } as unknown as Connection
    await assert.rejects(
      resolveAccounts({ connection, logger: silent }, { programId, caller, ixData }),
      (err: unknown) =>
        err instanceof CCIPSolanaAccountResolutionError &&
        err.message.endsWith(
          'AccountNotInitialized (3012): The program expected this account to be already initialized.',
        ),
    )
  })

  it('lets RPC failures through unchanged', async () => {
    const rpcError = new Error('429 Too Many Requests')
    const simulateTransaction = mock.fn(async () => {
      throw rpcError
    })
    const connection = { simulateTransaction } as unknown as Connection
    await assert.rejects(
      resolveAccounts({ connection, logger: silent }, { programId, caller, ixData }),
      (err: unknown) => err === rpcError,
    )
  })
})

describe('typed resolvers', () => {
  it('resolves get_fee_v2 with the final metadata in the instruction data', async () => {
    const router = randomKey()
    const sender = randomKey()
    const saved = [meta(randomKey()), meta(randomKey(), false, true)]
    const lut = randomKey()
    const metadata = Buffer.from([4, 0, 1, 1, 0, 0, 0, 2])
    const { connection, simulateTransaction, getAddressLookupTable } = scriptedConnection(router, [
      response({
        accountsToSave: saved,
        lookupTablesToSave: [lut, lut],
        metadata,
      }),
    ])

    const { instruction, lookupTables } = await resolveGetFeeV2(
      { connection, logger: silent },
      {
        router,
        destChainSelector: 16015286601757825753n,
        sender,
        message: {
          receiver: '0x0000000000000000000000000000000000000001',
          data: '0x1234',
          extraArgs: { gasLimit: 0n },
        },
      },
    )

    assert.ok(instruction.programId.equals(router))
    assert.deepEqual(instruction.keys, saved)
    // lookup tables are fetched once each
    assert.equal(getAddressLookupTable.mock.calls.length, 1)
    assert.equal(lookupTables.length, 1)

    // the resolution ix_data is the final data with empty metadata, and the caller is the sender
    const start = lastInstruction(simulateTransaction.mock.calls[0]!.arguments[0]).data
    assert.deepEqual(start.subarray(8, 40), sender.toBuffer())
    const ixDataLen = start.readUInt32LE(40)
    const ixData = start.subarray(44, 44 + ixDataLen)
    assert.deepEqual(ixData.subarray(0, 8), GET_FEE_V2_DISCRIMINATOR)
    assert.deepEqual(ixData.subarray(-4), u32(0))
    assert.deepEqual(instruction.data, Buffer.concat([ixData.subarray(0, -4), bytes(metadata)]))
  })

  it('passes the execution buffer to the start stage for buffered execute_v2', async () => {
    const offramp = randomKey()
    const caller = randomKey()
    const bufferId = Buffer.alloc(32, 5)
    const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], offramp)
    const [buffer] = PublicKey.findProgramAddressSync(
      [Buffer.from('execution_report_buffer'), bufferId, caller.toBuffer()],
      offramp,
    )
    const { connection, simulateTransaction } = scriptedConnection(offramp, [
      response({ accountsToSave: [meta(caller, true, true)] }),
    ])

    const { instruction } = await resolveExecuteV2(
      { connection, logger: silent },
      { offramp, caller, bufferId },
    )

    const start = lastInstruction(simulateTransaction.mock.calls[0]!.arguments[0])
    assert.deepEqual(start.keys, [meta(config), meta(buffer)])
    // ExecuteParams { exec_inputs: None, resolution_metadata: [] }
    assert.deepEqual(
      instruction.data,
      Buffer.concat([EXECUTE_V2_DISCRIMINATOR, Buffer.from([0]), u32(0)]),
    )
  })

  it('encodes inline execute_v2 inputs', async () => {
    const offramp = randomKey()
    const caller = randomKey()
    const ccv = randomKey()
    const { connection } = scriptedConnection(offramp, [response({})])

    const { instruction } = await resolveExecuteV2(
      { connection, logger: silent },
      {
        offramp,
        caller,
        execInputs: { encodedMessage: '0xabcd', ccvs: [ccv], verifierResults: ['0x01', '0x'] },
      },
    )

    assert.deepEqual(
      instruction.data,
      Buffer.concat([
        EXECUTE_V2_DISCRIMINATOR,
        Buffer.from([1]),
        bytes(Buffer.from('abcd', 'hex')),
        vec([ccv.toBuffer()]),
        vec([bytes(Buffer.from([1])), bytes(Buffer.alloc(0))]),
        u32(0),
      ]),
    )
  })
})

describe('fetchLookupTables', () => {
  it('throws when a table is missing', async () => {
    const connection = {
      getAddressLookupTable: mock.fn(async () => ({ value: null })),
    } as unknown as Connection
    await assert.rejects(
      fetchLookupTables(connection, [randomKey()]),
      CCIPSolanaLookupTableNotFoundError,
    )
  })
})
