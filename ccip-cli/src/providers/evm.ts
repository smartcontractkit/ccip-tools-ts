import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { CCIPArgumentInvalidError } from '@chainlink/ccip-sdk/src/index.ts'
import { LedgerSigner } from '@ethers-ext/signer-ledger'
import { password } from '@inquirer/prompts'
import HIDTransport from '@ledgerhq/hw-transport-node-hid'
import {
  type JsonRpcApiProvider,
  type Provider,
  type Signer,
  BaseWallet,
  SigningKey,
  Wallet,
} from 'ethers'

// monkey-patch @ethers-ext/signer-ledger to preserve path when `.connect`ing provider
Object.assign(LedgerSigner.prototype, {
  connect: function (this: LedgerSigner, provider?: Provider | null) {
    return new LedgerSigner(HIDTransport, provider, this.path)
  },
})

/**
 * Overwrite EVMChain.getWallet to support reading private key from file, env var or Ledger
 * @param provider - provider instance to be connected to signers
 * @param wallet - wallet options (as passed to yargs argv)
 * @returns Promise to Signer instance
 */
export async function loadEvmWallet(
  provider: JsonRpcApiProvider,
  { wallet: walletOpt }: { wallet?: unknown },
): Promise<Signer> {
  if (!walletOpt) walletOpt = process.env['PRIVATE_KEY'] || process.env['OWNER_KEY']
  if (
    typeof walletOpt === 'number' ||
    (typeof walletOpt === 'string' && walletOpt.match(/^(\d+|0x[a-fA-F0-9]{40})$/))
  ) {
    // if given a number, numeric string or address, use ethers `provider.getSigner` (e.g. geth or MM)
    return provider.getSigner(
      typeof walletOpt === 'string' && walletOpt.match(/^0x[a-fA-F0-9]{40}$/)
        ? walletOpt
        : Number(walletOpt),
    )
  }
  if (typeof walletOpt !== 'string') throw new CCIPArgumentInvalidError('wallet', String(walletOpt))
  if ((walletOpt ?? '').startsWith('ledger')) {
    let derivationPath = walletOpt.split(':')[1]
    if (derivationPath && !isNaN(Number(derivationPath)))
      derivationPath = `m/44'/60'/${derivationPath}'/0/0`
    const ledger = new LedgerSigner(HIDTransport, provider, derivationPath)
    console.info('Ledger connected:', await ledger.getAddress(), ', derivationPath:', ledger.path)
    return ledger
  }
  if (existsSync(walletOpt)) {
    let pw = process.env['USER_KEY_PASSWORD']
    if (!pw) pw = await password({ message: 'Enter password for json wallet' })
    return (await Wallet.fromEncryptedJson(await readFile(walletOpt, 'utf8'), pw)).connect(provider)
  }
  return new BaseWallet(
    new SigningKey((walletOpt.startsWith('0x') ? '' : '0x') + walletOpt),
    provider,
  )
}
