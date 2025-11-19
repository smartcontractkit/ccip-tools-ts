import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import util from 'util'

import { LedgerSigner } from '@ethers-ext/signer-ledger'
import { password } from '@inquirer/prompts'
import HIDTransport from '@ledgerhq/hw-transport-node-hid'
import { type Provider, type Signer, BaseWallet, SigningKey, Wallet } from 'ethers'

import { EVMChain } from '../lib/index.ts'

// monkey-patch @ethers-ext/signer-ledger to preserve path when `.connect`ing provider
Object.assign(LedgerSigner.prototype, {
  connect: function (this: LedgerSigner, provider?: Provider | null) {
    return new LedgerSigner(HIDTransport, provider, this.path)
  },
})

/**
 * Overwrite EVMChain.getWallet to support reading private key from file, env var or Ledger
 * @param provider - provider instance to be connected to signers
 * @param opts - wallet options (as passed to yargs argv)
 * @returns Promise to Signer instance
 */
EVMChain.getWallet = async function loadEvmWallet(
  provider: Provider,
  { wallet: walletOpt }: { wallet?: unknown },
): Promise<Signer> {
  if (!walletOpt) walletOpt = process.env['USER_KEY'] || process.env['OWNER_KEY']
  if (typeof walletOpt !== 'string')
    throw new Error(`Invalid wallet option: ${util.inspect(walletOpt)}`)
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
