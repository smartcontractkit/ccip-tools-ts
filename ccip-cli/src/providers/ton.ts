import { existsSync, readFileSync } from 'node:fs'

import {
  CCIPArgumentInvalidError,
  CCIPWalletInvalidError,
} from '@chainlink/ccip-sdk/src/errors/specialized.ts'
import type { TONWallet } from '@chainlink/ccip-sdk/src/ton/types.ts'
import { keyPairFromSecretKey, mnemonicToPrivateKey } from '@ton/crypto'
import { WalletContractV4 } from '@ton/ton'

/**
 * Loads a TON wallet from the provided options.
 * @param wallet - wallet options (as passed from yargs argv)
 * @returns Promise to TONWallet instance
 */
export async function loadTonWallet({
  wallet: walletOpt,
}: { wallet?: unknown } = {}): Promise<TONWallet> {
  if (!walletOpt) walletOpt = process.env['PRIVATE_KEY'] || process.env['OWNER_KEY']

  if (typeof walletOpt !== 'string') throw new CCIPWalletInvalidError(walletOpt)

  // Handle mnemonic phrase
  if (walletOpt.includes(' ')) {
    const mnemonic = walletOpt.trim().split(' ')
    const keyPair = await mnemonicToPrivateKey(mnemonic)
    const contract = WalletContractV4.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    })
    return { contract, keyPair }
  }

  // Handle hex private key
  if (walletOpt.startsWith('0x')) {
    const secretKey = Buffer.from(walletOpt.slice(2), 'hex')
    if (secretKey.length === 32) {
      throw new CCIPArgumentInvalidError(
        'wallet',
        '32-byte seeds not supported. Use 64-byte secret key or mnemonic.',
      )
    }
    if (secretKey.length !== 64) {
      throw new CCIPArgumentInvalidError('wallet', 'must be 64 bytes (or use mnemonic)')
    }
    const keyPair = keyPairFromSecretKey(secretKey)
    const contract = WalletContractV4.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    })
    return { contract, keyPair }
  }

  // Handle file path
  if (existsSync(walletOpt)) {
    const content = readFileSync(walletOpt, 'utf8').trim()
    const secretKey = Buffer.from(content.startsWith('0x') ? content.slice(2) : content, 'hex')
    if (secretKey.length !== 64) {
      throw new CCIPArgumentInvalidError('wallet', 'Invalid private key in file: must be 64 bytes')
    }
    const keyPair = keyPairFromSecretKey(secretKey)
    const contract = WalletContractV4.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    })
    return { contract, keyPair }
  }

  throw new CCIPArgumentInvalidError('wallet', 'Wallet not specified')
}
