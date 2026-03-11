import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  MULTISIG_SIZE,
  MintLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { type Connection, Keypair, PublicKey } from '@solana/web3.js'

import { SolanaTokenAdmin } from './index.ts'
import { CCIPGrantMintBurnAccessParamsInvalidError } from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'

// ── Mocks ──

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

const dummyNetwork: NetworkInfo = {
  name: 'solana-devnet',
  family: ChainFamily.Solana,
  chainSelector: 1n,
  chainId: 'solana-devnet',
  networkType: NetworkType.Testnet,
}

// ── Helpers ──

function makeAdmin(connection: Connection): SolanaTokenAdmin {
  return new SolanaTokenAdmin(connection, dummyNetwork, {
    logger: silentLogger,
    apiClient: null,
  })
}

/** Build a valid 82-byte mint buffer. When `authority` is provided, mintAuthorityOption = 1. */
function encodeMintData(authority?: PublicKey): Buffer {
  const data = Buffer.alloc(MintLayout.span)
  if (authority) {
    // mintAuthorityOption = 1 (Some)
    data.writeUInt32LE(1, 0)
    authority.toBuffer().copy(data, 4)
  } else {
    // mintAuthorityOption = 0 (None)
    data.writeUInt32LE(0, 0)
  }
  // decimals at offset 44
  data.writeUInt8(9, 44)
  // isInitialized at offset 45
  data.writeUInt8(1, 45)
  return data
}

/** Build a valid 355-byte multisig buffer with given threshold, count, and signers. */
function encodeMultisigData(m: number, signers: PublicKey[]): Buffer {
  const data = Buffer.alloc(MULTISIG_SIZE)
  // m (u8) at offset 0
  data.writeUInt8(m, 0)
  // n (u8) at offset 1
  data.writeUInt8(signers.length, 1)
  // isInitialized (bool) at offset 2
  data.writeUInt8(1, 2)
  // signer1..signer11 start at offset 3, each 32 bytes
  for (let i = 0; i < signers.length; i++) {
    signers[i]!.toBuffer().copy(data, 3 + i * 32)
  }
  return data
}

/**
 * Creates a mock connection that returns different account info per pubkey.
 * `accounts` is a map from base58 pubkey to the account info to return.
 */
function mockConnection(
  accounts: Record<string, { owner: PublicKey; data: Buffer } | null>,
): Connection {
  return {
    getSignaturesForAddress: async () => [],
    getAccountInfo: async (pubkey: PublicKey) => {
      const key = pubkey.toBase58()
      const entry = accounts[key]
      if (entry === undefined || entry === null) return null
      return {
        owner: entry.owner,
        data: entry.data,
        executable: false,
        lamports: 1_000_000,
      }
    },
    getMinimumBalanceForRentExemption: async () => 2_039_280,
  } as unknown as Connection
}

const mintKeypair = Keypair.generate()
const mintAddress = mintKeypair.publicKey.toBase58()

// =============================================================================
// SolanaTokenAdmin — getMintBurnRoles
// =============================================================================

describe('SolanaTokenAdmin — getMintBurnRoles', () => {
  // ===========================================================================
  // Mint authority disabled
  // ===========================================================================

  it('should return mintAuthority: null when mint authority is disabled', async () => {
    const mintData = encodeMintData() // no authority
    const conn = mockConnection({
      [mintAddress]: { owner: TOKEN_PROGRAM_ID, data: mintData },
    })
    const admin = makeAdmin(conn)

    const result = await admin.getMintBurnRoles({ tokenAddress: mintAddress })

    assert.equal(result.mintAuthority, null)
    assert.equal(result.isMultisig, false)
    assert.equal(result.multisigThreshold, undefined)
    assert.equal(result.multisigMembers, undefined)
  })

  // ===========================================================================
  // Regular (non-multisig) authority
  // ===========================================================================

  it('should return isMultisig: false when mint authority is a regular account', async () => {
    const authority = Keypair.generate().publicKey
    const mintData = encodeMintData(authority)
    const conn = mockConnection({
      [mintAddress]: { owner: TOKEN_PROGRAM_ID, data: mintData },
      // Authority account exists but is NOT multisig size (e.g., a regular wallet)
      [authority.toBase58()]: {
        owner: new PublicKey('11111111111111111111111111111111'),
        data: Buffer.alloc(0),
      },
    })
    const admin = makeAdmin(conn)

    const result = await admin.getMintBurnRoles({ tokenAddress: mintAddress })

    assert.equal(result.mintAuthority, authority.toBase58())
    assert.equal(result.isMultisig, false)
    assert.equal(result.multisigThreshold, undefined)
    assert.equal(result.multisigMembers, undefined)
  })

  // ===========================================================================
  // Multisig authority
  // ===========================================================================

  it('should return isMultisig: true with correct threshold and members when authority is a multisig', async () => {
    const signer1 = Keypair.generate().publicKey
    const signer2 = Keypair.generate().publicKey
    const signer3 = Keypair.generate().publicKey
    const multisigAddress = Keypair.generate().publicKey

    const mintData = encodeMintData(multisigAddress)
    const multisigData = encodeMultisigData(2, [signer1, signer2, signer3])

    const conn = mockConnection({
      [mintAddress]: { owner: TOKEN_PROGRAM_ID, data: mintData },
      [multisigAddress.toBase58()]: {
        owner: TOKEN_PROGRAM_ID,
        data: multisigData,
      },
    })
    const admin = makeAdmin(conn)

    const result = await admin.getMintBurnRoles({ tokenAddress: mintAddress })

    assert.equal(result.mintAuthority, multisigAddress.toBase58())
    assert.equal(result.isMultisig, true)
    assert.equal(result.multisigThreshold, 2)
    assert.ok(result.multisigMembers)
    assert.equal(result.multisigMembers.length, 3)
    assert.equal(result.multisigMembers[0]!.address, signer1.toBase58())
    assert.equal(result.multisigMembers[1]!.address, signer2.toBase58())
    assert.equal(result.multisigMembers[2]!.address, signer3.toBase58())
  })

  // ===========================================================================
  // Authority account not found
  // ===========================================================================

  it('should return isMultisig: false when authority account not found', async () => {
    const authority = Keypair.generate().publicKey
    const mintData = encodeMintData(authority)
    const conn = mockConnection({
      [mintAddress]: { owner: TOKEN_PROGRAM_ID, data: mintData },
      // authority account not present in mock — getAccountInfo returns null
    })
    const admin = makeAdmin(conn)

    const result = await admin.getMintBurnRoles({ tokenAddress: mintAddress })

    assert.equal(result.mintAuthority, authority.toBase58())
    assert.equal(result.isMultisig, false)
  })

  // ===========================================================================
  // Mint account not found
  // ===========================================================================

  it('should throw when mint account not found', async () => {
    const conn = mockConnection({})
    const admin = makeAdmin(conn)

    await assert.rejects(
      () => admin.getMintBurnRoles({ tokenAddress: mintAddress }),
      (err: unknown) => {
        assert.ok(err instanceof CCIPGrantMintBurnAccessParamsInvalidError)
        assert.equal(err.context.param, 'tokenAddress')
        assert.ok(err.message.includes('not found'))
        return true
      },
    )
  })

  // ===========================================================================
  // Token-2022 multisig
  // ===========================================================================

  it('should detect multisig owned by Token-2022 program', async () => {
    const signer1 = Keypair.generate().publicKey
    const multisigAddress = Keypair.generate().publicKey

    const mintData = encodeMintData(multisigAddress)
    const multisigData = encodeMultisigData(1, [signer1])

    const conn = mockConnection({
      [mintAddress]: { owner: TOKEN_2022_PROGRAM_ID, data: mintData },
      [multisigAddress.toBase58()]: {
        owner: TOKEN_2022_PROGRAM_ID,
        data: multisigData,
      },
    })
    const admin = makeAdmin(conn)

    const result = await admin.getMintBurnRoles({ tokenAddress: mintAddress })

    assert.equal(result.isMultisig, true)
    assert.equal(result.multisigThreshold, 1)
    assert.ok(result.multisigMembers)
    assert.equal(result.multisigMembers.length, 1)
    assert.equal(result.multisigMembers[0]!.address, signer1.toBase58())
  })
})
