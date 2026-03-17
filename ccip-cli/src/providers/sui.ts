import { CCIPArgumentInvalidError, bytesToBuffer } from '@chainlink/ccip-sdk/src/index.ts'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

/**
 * Loads a Sui wallet from the provided options.
 * @param wallet - wallet options (as passed from yargs argv)
 * @returns Sui Keypair instance
 */
export function loadSuiWallet({ wallet: walletOpt }: { wallet?: unknown }) {
  if (typeof walletOpt !== 'string') throw new CCIPArgumentInvalidError('wallet', String(walletOpt))

  if (walletOpt.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(walletOpt)
    return Ed25519Keypair.fromSecretKey(secretKey)
  }

  const keyBytes = bytesToBuffer(walletOpt)
  return Ed25519Keypair.fromSecretKey(keyBytes)
}
