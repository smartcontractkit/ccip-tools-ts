import { existsSync, readFileSync } from 'node:fs'

import { TONChain } from '@chainlink/ccip-sdk/src/index.ts'
import type { TONWallet } from '@chainlink/ccip-sdk/src/ton/types.ts'
import { keyPairFromSecretKey, mnemonicToPrivateKey } from '@ton/crypto'
import { WalletContractV4 } from '@ton/ton'

TONChain.getWallet = async function loadTONWallet({
  wallet,
}: { wallet?: unknown } = {}): Promise<TONWallet> {
  if (!wallet) wallet = process.env['USER_KEY'] || process.env['OWNER_KEY']

  if (typeof wallet !== 'string') throw new Error(`Invalid wallet option: ${String(wallet)}`)

  // Handle mnemonic phrase
  if (wallet.includes(' ')) {
    const mnemonic = wallet.trim().split(' ')
    const keyPair = await mnemonicToPrivateKey(mnemonic)
    const contract = WalletContractV4.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    })
    return { contract, keyPair }
  }

  // Handle hex private key
  if (wallet.startsWith('0x')) {
    const secretKey = Buffer.from(wallet.slice(2), 'hex')
    if (secretKey.length === 32) {
      throw new Error(
        'Invalid private key: 32-byte seeds not supported. Use 64-byte secret key or mnemonic.',
      )
    }
    if (secretKey.length !== 64) {
      throw new Error('Invalid private key: must be 64 bytes (or use mnemonic)')
    }
    const keyPair = keyPairFromSecretKey(secretKey)
    const contract = WalletContractV4.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    })
    return { contract, keyPair }
  }

  // Handle file path
  if (existsSync(wallet)) {
    const content = readFileSync(wallet, 'utf8').trim()
    const secretKey = Buffer.from(content.startsWith('0x') ? content.slice(2) : content, 'hex')
    if (secretKey.length !== 64) {
      throw new Error('Invalid private key in file: must be 64 bytes')
    }
    const keyPair = keyPairFromSecretKey(secretKey)
    const contract = WalletContractV4.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    })
    return { contract, keyPair } as TONWallet
  }

  throw new Error('Wallet not specified')
}
