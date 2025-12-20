import { CCIPArgumentInvalidError } from '@chainlink/ccip-sdk/src/index.ts'
import { bytesToBuffer } from '@chainlink/ccip-sdk/src/utils.ts'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

/**
 * Loads a Sui wallet from the provided options.
 * @param wallet - wallet options (as passed from yargs argv)
 * @returns Sui Keypair instance
 */
export function loadSuiWallet({ wallet: walletOpt }: { wallet?: unknown }) {
  if (typeof walletOpt !== 'string') throw new CCIPArgumentInvalidError('wallet', String(walletOpt))

  const keyBytes = bytesToBuffer(walletOpt)
  return Ed25519Keypair.fromSecretKey(keyBytes)
}
