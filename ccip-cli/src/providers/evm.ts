import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { type Logger, CCIPArgumentInvalidError } from '@chainlink/ccip-sdk/src/index.ts'
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
 * Registry of named keystore providers, keyed by --wallet prefix (e.g. "foundry", "hardhat").
 * Each entry defines a human-readable label and an async function that resolves
 * the private key from an account name.
 * Add a new entry here to support additional keystore formats.
 */
const KEYSTORE_PROVIDERS: Record<
  string,
  { label: string; resolvePrivateKey: (name: string) => Promise<string> }
> = {
  foundry: {
    label: 'Foundry',
    resolvePrivateKey: async (name: string) => {
      const dir = process.env['FOUNDRY_DIR'] ?? join(homedir(), '.foundry')
      const keystorePath = join(dir, 'keystores', name)
      if (!existsSync(keystorePath)) {
        throw new CCIPArgumentInvalidError(
          'wallet',
          `Foundry keystore '${name}' not found at ${keystorePath}`,
        )
      }
      let pw = process.env['FOUNDRY_KEYSTORE_PASSWORD'] ?? process.env['USER_KEY_PASSWORD']
      pw ??= await password({ message: `Enter password for Foundry keystore '${name}'` })
      return (await Wallet.fromEncryptedJson(await readFile(keystorePath, 'utf8'), pw)).privateKey
    },
  },
  hardhat: {
    label: 'Hardhat',
    resolvePrivateKey: async (name: string) => {
      const hardhatBin = join(process.cwd(), 'node_modules', '.bin', 'hardhat')
      if (!existsSync(hardhatBin)) {
        throw new CCIPArgumentInvalidError(
          'wallet',
          `Hardhat not found at ${hardhatBin}. Run ccip-cli from inside a Hardhat project with Hardhat installed as a dependency.`,
        )
      }
      let pw = process.env['HARDHAT_KEYSTORE_PASSWORD'] ?? process.env['USER_KEY_PASSWORD']
      pw ??= await password({ message: `Enter password for Hardhat keystore '${name}'` })
      const result = spawnSync(hardhatBin, ['keystore', 'get', name], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'inherit'],
        input: pw + '\n',
      })
      if (result.status !== 0) {
        throw new CCIPArgumentInvalidError(
          'wallet',
          `Failed to get Hardhat keystore '${name}'. Ensure ccip-cli is run from inside a Hardhat project directory with Hardhat installed as a dependency.`,
        )
      }
      // Hardhat writes its prompt ("[hardhat-keystore] Enter the password: ") to stdout,
      // so we extract the private key by matching the first 0x-prefixed 32-byte hex string.
      const key = result.stdout.match(/0x[0-9a-fA-F]{64}/)?.[0]
      if (!key) {
        throw new CCIPArgumentInvalidError(
          'wallet',
          `No output from 'hardhat keystore get ${name}'. Ensure Hardhat is installed in the project.`,
        )
      }
      return key
    },
  },
}

/**
 * Overwrite EVMChain.getWallet to support reading private key from file, env var or Ledger
 * @param provider - provider instance to be connected to signers
 * @param wallet - wallet options (as passed to yargs argv)
 * @returns Promise to Signer instance
 */
export async function loadEvmWallet(
  provider: JsonRpcApiProvider,
  { wallet: walletOpt }: { wallet?: unknown },
  logger: Logger = console,
): Promise<Signer> {
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
  if (walletOpt.startsWith('ledger')) {
    let derivationPath = walletOpt.split(':')[1]
    if (derivationPath && !isNaN(Number(derivationPath)))
      derivationPath = `m/44'/60'/${derivationPath}'/0/0`
    const ledger = new LedgerSigner(HIDTransport, provider, derivationPath)
    logger.info('Ledger connected:', await ledger.getAddress(), ', derivationPath:', ledger.path)
    return ledger
  }
  for (const [prefix, keystoreProvider] of Object.entries(KEYSTORE_PROVIDERS)) {
    if (walletOpt.startsWith(`${prefix}:`)) {
      const accountName = walletOpt.slice(prefix.length + 1)
      const privateKey = await keystoreProvider.resolvePrivateKey(accountName)
      return new BaseWallet(new SigningKey(privateKey), provider)
    }
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
