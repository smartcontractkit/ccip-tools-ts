import { CCIPCctTxFailedError, CCIPWalletInvalidError } from '../../errors/index.ts'
import type { SolanaChain } from '../../solana/index.ts'
import { type UnsignedSolanaTx, isWallet } from '../../solana/types.ts'
import { simulateAndSendTxs } from '../../solana/utils.ts'
import type { CctTxResult } from '../token-manager.ts'

/** Signs, simulates, sends and confirms a Solana CCT transaction set. */
export async function submit(
  chain: SolanaChain,
  wallet: unknown,
  unsigned: UnsignedSolanaTx,
  operation: string,
): Promise<CctTxResult> {
  if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

  try {
    return { txHash: await simulateAndSendTxs(chain, wallet, unsigned) }
  } catch (error) {
    throw new CCIPCctTxFailedError(
      operation,
      error instanceof Error ? error.message : String(error),
      { cause: error instanceof Error ? error : undefined },
    )
  }
}
