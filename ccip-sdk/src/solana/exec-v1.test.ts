/**
 * Tests for the Solana CCIP 1.6 execution path (`manuallyExecute`), including report buffering
 * and the ad-hoc lookup table it may need.
 */
import { Buffer } from 'buffer'
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import {
  type AccountMeta,
  type Connection,
  type VersionedTransaction,
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
} from '@solana/web3.js'

import { CCIPSolanaLookupTableNotFoundError } from '../errors/index.ts'
import { networkInfo } from '../networks.ts'
import type { ExecutionInput } from '../types.ts'
import { sighash, sizedCoder } from './coder.ts'
import { generateUnsignedExecuteReport } from './exec.ts'
import { IDL as CCIP_OFFRAMP_IDL } from './idl/1.6.0/CCIP_OFFRAMP.ts'
import type { CCIPMessage_V1_6_Solana } from './types.ts'

const silent = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Console
const randomKey = () => Keypair.generate().publicKey
const offrampCoder = sizedCoder(CCIP_OFFRAMP_IDL)
const DEST = networkInfo('solana-devnet').chainSelector
const SOURCE = networkInfo('ethereum-testnet-sepolia').chainSelector
const MESSAGE_ID = `0x${'11'.repeat(32)}`

const execReport: ExecutionInput<CCIPMessage_V1_6_Solana> = {
  message: {
    messageId: MESSAGE_ID,
    sourceChainSelector: SOURCE,
    destChainSelector: DEST,
    sequenceNumber: 3n,
    nonce: 0n,
    sender: `0x${'22'.repeat(20)}`,
    data: '0xdead',
    // a plain token transfer: no receiver callback, so no messaging accounts
    receiver: PublicKey.default.toBase58(),
    accounts: [],
    accountIsWritableBitmap: 0n,
    tokenReceiver: randomKey().toBase58(),
    tokenAmounts: [],
    computeUnits: 200_000n,
    allowOutOfOrderExecution: true,
  },
  proofs: [],
  proofFlagBits: 0n,
  merkleRoot: `0x${'ee'.repeat(32)}`,
  offchainTokenData: [],
} as unknown as ExecutionInput<CCIPMessage_V1_6_Solana>

/** The last instruction of a simulated tx, with the keys the program receives. */
function lastInstruction(tx: VersionedTransaction) {
  const msg = tx.message
  const keys = msg.staticAccountKeys
  const ix = msg.compiledInstructions.at(-1)!
  return { programId: keys[ix.programIdIndex]!, data: Buffer.from(ix.data) }
}

function deriveResponse(
  accounts: AccountMeta[],
  { nextStage = '', lookupTables = [] as PublicKey[] } = {},
) {
  return offrampCoder.types.encode('DeriveAccountsResponse', {
    askAgainWith: [],
    accountsToSave: accounts,
    lookUpTablesToSave: lookupTables,
    currentStage: 'Start',
    nextStage,
  })
}

/**
 * A connection answering `deriveAccountsExecute` with `accounts`, and lookup table reads with
 * `lookup`.
 */
function offrampConnection(
  offramp: PublicKey,
  {
    accounts = Array.from({ length: 12 }, () => ({
      pubkey: randomKey(),
      isSigner: false,
      isWritable: true,
    })) as AccountMeta[],
    lookupTables = [] as PublicKey[],
    lookup = true,
  } = {},
) {
  const simulateTransaction = mock.fn(async (tx: VersionedTransaction) => {
    const { data } = lastInstruction(tx)
    assert.deepEqual(
      data.subarray(0, 8),
      sighash('global', 'deriveAccountsExecute'),
      'only the account derivation is simulated',
    )
    const response = deriveResponse(accounts, { lookupTables })
    return {
      value: {
        err: null,
        logs: [],
        unitsConsumed: 1000,
        returnData: {
          programId: offramp.toBase58(),
          data: [response.toString('base64'), 'base64'],
        },
      },
    }
  })
  const getAddressLookupTable = mock.fn(async (key: PublicKey) => ({
    value: lookup ? { key, state: { addresses: [] } } : null,
  }))
  const connection = {
    simulateTransaction,
    getAddressLookupTable,
    getSlot: mock.fn(async () => 42),
  } as unknown as Connection
  return { connection, simulateTransaction, getAddressLookupTable }
}

function decodeExecute(data: Buffer) {
  const decoded = offrampCoder.instruction.decode(data) as unknown as {
    name: string
    data: { rawExecutionReport: Buffer; tokenIndexes: Buffer }
  }
  assert.equal(decoded.name, 'manuallyExecute')
  return decoded.data
}

describe('generateUnsignedExecuteReport (1.6)', () => {
  it('builds manuallyExecute against the 12 derived accounts', async () => {
    const offramp = randomKey()
    const payer = randomKey()
    const { connection } = offrampConnection(offramp)

    const unsigned = await generateUnsignedExecuteReport(
      { connection, logger: silent },
      payer,
      offramp,
      execReport,
    )

    assert.equal(unsigned.mainIndex, 0)
    assert.equal(unsigned.instructions.length, 1)
    assert.deepEqual(unsigned.lookupTables, [])
    const [exec] = unsigned.instructions
    assert.ok(exec!.programId.equals(offramp))
    assert.deepEqual(exec!.data.subarray(0, 8), sighash('global', 'manuallyExecute'))
    assert.equal(exec!.keys.length, 12)

    const { rawExecutionReport } = decodeExecute(exec!.data)
    const report = offrampCoder.types.decode<{
      message: { header: { messageId: number[]; nonce: unknown } }
    }>('ExecutionReportSingleChain', rawExecutionReport)
    assert.equal(Buffer.from(report.message.header.messageId).toString('hex'), MESSAGE_ID.slice(2))
  })

  it('buffers the report before executing it when asked', async () => {
    const offramp = randomKey()
    const { connection } = offrampConnection(offramp)

    const unsigned = await generateUnsignedExecuteReport(
      { connection, logger: silent },
      randomKey(),
      offramp,
      execReport,
      { forceBuffer: true },
    )

    assert.equal(unsigned.instructions.length, 2)
    const [buffer, exec] = unsigned.instructions
    assert.deepEqual(buffer!.data.subarray(0, 8), sighash('global', 'bufferExecutionReport'))
    // the buffered report travels in the buffer chunks, so manually_execute gets an empty one
    assert.equal(decodeExecute(exec!.data).rawExecutionReport.length, 0)
  })

  it('clears a leftover buffer before filling the new one', async () => {
    const offramp = randomKey()
    const { connection } = offrampConnection(offramp)

    const unsigned = await generateUnsignedExecuteReport(
      { connection, logger: silent },
      randomKey(),
      offramp,
      execReport,
      { forceBuffer: true, clearLeftoverAccounts: true },
    )

    assert.equal(unsigned.instructions.length, 3)
    assert.deepEqual(
      unsigned.instructions.map((ix) => ix.data.subarray(0, 8)),
      [
        sighash('global', 'closeExecutionReportBuffer'),
        sighash('global', 'bufferExecutionReport'),
        sighash('global', 'manuallyExecute'),
      ],
    )
  })

  it('returns the derived lookup tables with the transaction', async () => {
    const offramp = randomKey()
    const lookupTable = randomKey()
    const { connection, getAddressLookupTable } = offrampConnection(offramp, {
      lookupTables: [lookupTable],
    })

    const unsigned = await generateUnsignedExecuteReport(
      { connection, logger: silent },
      randomKey(),
      offramp,
      execReport,
    )

    assert.deepEqual(
      unsigned.lookupTables?.map(({ key }) => key.toBase58()),
      [lookupTable.toBase58()],
    )
    assert.equal(
      getAddressLookupTable.mock.calls.length,
      2,
      'resolved for derivation and for the tx',
    )
    assert.deepEqual(
      getAddressLookupTable.mock.calls.map((call) => call.arguments[0].toBase58()),
      [lookupTable.toBase58(), lookupTable.toBase58()],
    )
  })

  it('throws when a derived lookup table cannot be resolved', async () => {
    const offramp = randomKey()
    const { connection } = offrampConnection(offramp, {
      lookupTables: [randomKey()],
      lookup: false,
    })

    await assert.rejects(
      generateUnsignedExecuteReport(
        { connection, logger: silent },
        randomKey(),
        offramp,
        execReport,
      ),
      CCIPSolanaLookupTableNotFoundError,
    )
  })

  it('sandwiches the execution with ad-hoc lookup table instructions', async () => {
    const offramp = randomKey()
    const { connection } = offrampConnection(offramp)

    const unsigned = await generateUnsignedExecuteReport(
      { connection, logger: silent },
      randomKey(),
      offramp,
      execReport,
      { forceLookupTable: true },
    )

    // create + extend (12 addresses fit one extend), then execute, then deactivate
    assert.equal(unsigned.instructions.length, 4)
    assert.equal(unsigned.mainIndex, 2)
    assert.equal(unsigned.lookupTables?.length, 1)
    assert.deepEqual(unsigned.lookupTables![0]!.state.addresses.length, 12)
    assert.deepEqual(
      unsigned.instructions.map((ix) => ix.programId.toBase58()),
      [
        AddressLookupTableProgram.programId.toBase58(),
        AddressLookupTableProgram.programId.toBase58(),
        offramp.toBase58(),
        AddressLookupTableProgram.programId.toBase58(),
      ],
    )
  })
})
