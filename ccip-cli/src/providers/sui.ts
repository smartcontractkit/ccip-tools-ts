import { CCIPArgumentInvalidError } from '@chainlink/ccip-sdk/src/index.ts'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

/**
 * Loads a Sui wallet from the provided options.
 * @param wallet - wallet options (as passed from yargs argv)
 * @returns Sui Keypair instance
 */
export function loadSuiWallet({ wallet: walletOpt }: { wallet?: unknown }) {
  if (!walletOpt) walletOpt = process.env['USER_KEY'] || process.env['OWNER_KEY']
  if (typeof walletOpt !== 'string') throw new CCIPArgumentInvalidError('wallet', String(walletOpt))

  // Remove 0x prefix if present
  const cleanKey = walletOpt.startsWith('0x') ? walletOpt.slice(2) : walletOpt
  const keyBytes = Buffer.from(cleanKey, 'hex')
  return Ed25519Keypair.fromSecretKey(keyBytes)
}
