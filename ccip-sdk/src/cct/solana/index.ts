/**
 * Solana Cross-Chain Token (CCT) admin operations.
 *
 * @packageDocumentation
 */

import type { ChainFamily } from '../../networks.ts'
import { TokenManager } from '../token-manager.ts'
import { SolanaTokenAdminRegistryClient } from './token-admin-registry/index.ts'
import { type SerializedSolanaTxEncoding, serializeUnsignedSolanaTx } from './utils.ts'
import type { SolanaChain } from '../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../solana/types.ts'

/** CCT admin facade for Solana; grouped clients own contract/program operations. */
export class SolanaTokenManager extends TokenManager<typeof ChainFamily.Solana> {
  readonly chain: SolanaChain
  readonly tokenAdminRegistry: SolanaTokenAdminRegistryClient

  /** Creates a Solana CCT manager for an existing chain. */
  constructor(chain: SolanaChain) {
    super()
    this.chain = chain
    this.tokenAdminRegistry = new SolanaTokenAdminRegistryClient(chain)
  }

  /** Wraps an existing {@link SolanaChain}. */
  static fromChain(chain: SolanaChain): SolanaTokenManager {
    return new SolanaTokenManager(chain)
  }

  /** Serializes an unsigned Solana CCT tx for external signing. */
  serializeUnsignedTx(
    unsigned: Pick<UnsignedSolanaTx, 'instructions' | 'lookupTables'>,
    payer: string,
    encoding?: SerializedSolanaTxEncoding,
  ): Promise<string> {
    return serializeUnsignedSolanaTx(this.chain.connection, unsigned, payer, encoding)
  }
}

export type { GenerateSetPoolParams, SetPoolParams } from './token-admin-registry/index.ts'
export type { SerializedSolanaTxEncoding } from './utils.ts'
export { SolanaCCTVersion } from './versions.ts'
