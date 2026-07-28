import { Buffer } from 'buffer'

import { Keypair, PublicKey } from '@solana/web3.js'
import { sha256, toUtf8Bytes } from 'ethers'

import type { SolanaChain } from '../../../../solana/index.ts'

/** Deterministic-ish test pubkeys. */
export const POOL_PROGRAM = Keypair.generate().publicKey
export const POOL_STATE = Keypair.generate().publicKey
export const MINT = Keypair.generate().publicKey
export const PAYER = Keypair.generate().publicKey.toBase58()
export const AUTHORITY = Keypair.generate().publicKey.toBase58()
export const SELECTOR = 16015286601757825753n

/** Anchor global-namespace discriminator: sha256('global:<name>')[0..8]. */
export function anchorDiscriminator(name: string): Buffer {
  return Buffer.from(sha256(toUtf8Bytes(`global:${name}`)).slice(2, 18), 'hex')
}

/** Independently derives the pool state (config) PDA. */
export function statePda(mint = MINT, poolProgram = POOL_PROGRAM): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('ccip_tokenpool_config'), mint.toBuffer()],
    poolProgram,
  )[0]
}

/** Independently derives a per-chain config PDA. */
export function chainConfigPda(
  selector = SELECTOR,
  mint = MINT,
  poolProgram = POOL_PROGRAM,
): PublicKey {
  const sel = Buffer.alloc(8)
  sel.writeBigUInt64LE(selector)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('ccip_tokenpool_chainconfig'), sel, mint.toBuffer()],
    poolProgram,
  )[0]
}

type StubOptions = {
  /** Whether chain-config PDAs report as already existing (for applyChainUpdates idempotency). */
  chainConfigExists?: boolean
  /** Optional override for getTokenPoolRemotes. */
  remotes?: Record<string, unknown>
}

/** Builds a minimal SolanaChain stub sufficient for `.instruction()` building. */
export function stubChain(opts: StubOptions = {}): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: async (key: PublicKey) => {
        if (key.equals(POOL_STATE)) return { owner: POOL_PROGRAM, data: Buffer.alloc(0) }
        return opts.chainConfigExists ? { owner: POOL_PROGRAM, data: Buffer.alloc(0) } : null
      },
    },
    getTokenForTokenPool: async () => MINT.toBase58(),
    getTokenPoolRemotes: async () => opts.remotes ?? {},
  } as unknown as SolanaChain
}
