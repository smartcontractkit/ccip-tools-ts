import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'

const METAPLEX_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
const TOKEN = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const NEW_AUTHORITY = Keypair.generate().publicKey.toBase58()
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: new PublicKey(AUTHORITY),
  signTransaction: async <T>(tx: T) => tx,
}

function metadataData(authority = AUTHORITY, isMutable = true): Buffer {
  return Buffer.concat([
    Buffer.from([4]), // MetadataV1
    new PublicKey(authority).toBuffer(),
    new PublicKey(TOKEN).toBuffer(),
    Buffer.alloc(12), // Empty name, symbol, and URI strings.
    Buffer.alloc(2), // Seller fee basis points.
    Buffer.from([0, 0, isMutable ? 1 : 0, 0, 0, 0, 0, 0]),
  ])
}

function metadataAccount(metadata = metadataData()) {
  return {
    data: metadata,
    executable: false,
    lamports: 0,
    owner: METAPLEX_PROGRAM_ID,
    rentEpoch: 0,
  }
}

function chain(metadata: Buffer | null = metadataData()): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      rpcEndpoint: 'http://localhost:8899',
      getAccountInfo: async () => (metadata ? metadataAccount(metadata) : null),
    },
  } as unknown as SolanaChain
}

function submitChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      rpcEndpoint: 'http://localhost:8899',
      getAccountInfo: async () => metadataAccount(),
      simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 1 } }),
      getLatestBlockhash: async () => ({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 1,
      }),
      sendTransaction: async () => HASH,
      confirmTransaction: async () => ({ value: { err: null } }),
    },
  } as unknown as SolanaChain
}

function generate(opts: Record<string, unknown> = {}, metadata?: Buffer | null) {
  return SolanaTokenManager.fromChain(chain(metadata)).generateUnsignedUpdateMetadataAuthority({
    tokenAddress: TOKEN,
    payer: PAYER,
    authority: AUTHORITY,
    newAuthority: NEW_AUTHORITY,
    ...opts,
  })
}

describe('UpdateMetadataAuthority (cct/solana)', () => {
  describe('generate', () => {
    it('builds a Metaplex UpdateV1 instruction', async () => {
      const unsigned = await generate()
      const [instruction] = unsigned.instructions

      assert.ok(instruction)
      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(unsigned.instructions.length, 1)
      assert.equal(instruction.programId.toBase58(), METAPLEX_PROGRAM_ID.toBase58())
      assert.equal(instruction.data[0], 50) // Update
      assert.equal(instruction.data[1], 0) // UpdateV1
      assert.equal(instruction.keys[0]!.pubkey.toBase58(), AUTHORITY)
      assert.equal(instruction.keys[0]!.isSigner, true)
    })

    it('defaults authority to payer', async () => {
      const unsigned = await generate({ authority: undefined }, metadataData(PAYER))

      assert.equal(unsigned.instructions[0]!.keys[0]!.pubkey.toBase58(), PAYER)
    })
  })

  describe('validation', () => {
    it('rejects invalid public keys before RPC', async () => {
      for (const param of ['tokenAddress', 'newAuthority', 'authority']) {
        await assert.rejects(
          () => generate({ [param]: 'invalid' }),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      }
    })

    it('requires Metaplex metadata with the current authority', async () => {
      for (const [metadata, param] of [
        [null, 'tokenAddress'],
        [metadataData(PAYER), 'authority'],
      ] as const) {
        await assert.rejects(
          () => generate({}, metadata),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      }
    })

    it('rejects immutable metadata before submission', async () => {
      await assert.rejects(
        () => generate({}, metadataData(AUTHORITY, false)),
        (err: unknown) =>
          err instanceof CCTTxFailedError && err.message.includes('metadata is immutable'),
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      const result = await SolanaTokenManager.fromChain(submitChain()).updateMetadataAuthority({
        tokenAddress: TOKEN,
        newAuthority: NEW_AUTHORITY,
        wallet: WALLET,
      })

      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-wallet authority for signed updates', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(chain()).updateMetadataAuthority({
            tokenAddress: TOKEN,
            newAuthority: NEW_AUTHORITY,
            authority: PAYER,
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'updateMetadataAuthority' &&
          err.context.param === 'authority',
      )
    })
  })
})
