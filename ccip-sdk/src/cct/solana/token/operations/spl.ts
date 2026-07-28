import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import type { PublicKey } from '@solana/web3.js'

import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

/**
 * Resolves the SPL Token program (classic or Token-2022) that owns `mint` by
 * reading the mint account on-chain. Throws {@link CCTParamsInvalidError} when the
 * mint is missing or owned by an unexpected program.
 */
export async function detectMintTokenProgram(
  chain: SolanaChain,
  operation: string,
  param: string,
  mint: PublicKey,
): Promise<PublicKey> {
  const mintInfo = await chain.connection.getAccountInfo(mint)
  if (!mintInfo) {
    throw new CCTParamsInvalidError(operation, param, 'mint account not found on-chain')
  }
  const isToken2022 = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
  const isTokenProgram = mintInfo.owner.equals(TOKEN_PROGRAM_ID)
  if (!isToken2022 && !isTokenProgram) {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `mint owned by ${mintInfo.owner.toBase58()}, expected SPL Token or Token-2022`,
    )
  }
  return mintInfo.owner
}
