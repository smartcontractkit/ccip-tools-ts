import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import util from 'util'

import { Wallet as SolanaWallet } from '@coral-xyz/anchor'
import { LedgerSigner } from '@ethers-ext/signer-ledger'
import { password } from '@inquirer/prompts'
import SolanaLedger from '@ledgerhq/hw-app-solana'
import HIDTransport from '@ledgerhq/hw-transport-node-hid'
import {
  type Message,
  type MessageV0,
  type VersionedTransaction,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js'
import bs58 from 'bs58'
import { type Provider, type Signer, BaseWallet, SigningKey, Wallet, getBytes } from 'ethers'

import type { Chain, ChainGetter, ChainTransaction } from './lib/chain.ts'
import { EVMChain } from './lib/evm/index.ts'
import { networkInfo } from './lib/index.ts'
import { SolanaChain } from './lib/solana/index.ts'
import { supportedChains } from './lib/supported-chains.ts'

const RPCS_RE = /\b(?:http|ws)s?:\/\/[\w/\\@&?%~#.,;:=+-]+/

// monkey-patch @ethers-ext/signer-ledger to preserve path when `.connect`ing provider
Object.assign(LedgerSigner.prototype, {
  connect: function (this: LedgerSigner, provider?: Provider | null) {
    return new LedgerSigner(HIDTransport, provider, this.path)
  },
})

async function collectEndpoints({
  rpcs,
  'rpcs-file': rpcsFile,
}: {
  rpcs?: string[]
  'rpcs-file'?: string
}): Promise<Set<string>> {
  const endpoints = new Set<string>(rpcs || [])
  for (const [env, val] of Object.entries(process.env)) {
    if (env.startsWith('RPC_') && val && RPCS_RE.test(val)) endpoints.add(val)
  }
  if (rpcsFile) {
    try {
      const fileContent = await readFile(rpcsFile, 'utf8')
      for (const line of fileContent.toString().split(/(?:\r\n|\r|\n)/g)) {
        const match = line.match(RPCS_RE)
        if (match) endpoints.add(match[0])
      }
    } catch (error) {
      console.debug('Error reading RPCs file', error)
    }
  }
  return endpoints
}

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

export class LedgerSolanaWallet {
  publicKey: PublicKey
  wallet: SolanaLedger
  path: string

  private constructor(solanaLW: SolanaLedger, pubKey: PublicKey, path: string) {
    this.wallet = solanaLW
    this.publicKey = pubKey
    this.path = path
  }

  static async create(path: string) {
    try {
      const transport = await HIDTransport.create()
      const solana = new SolanaLedger(transport)
      const { address } = await solana.getAddress(path, false)
      const pubkey = new PublicKey(address)
      console.info('Ledger connected:', pubkey.toBase58(), `, derivationPath:`, path)
      return new LedgerSolanaWallet(solana, pubkey, path)
    } catch (e) {
      console.error('Ledger: Could not access ledger. Is it unlocked and Solana app open?')
      throw e
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T) {
    console.debug('Ledger: Request to sign message from', this.publicKey.toBase58())
    // serializeMessage on v0, serialize on v1

    let msg: Message | MessageV0
    if (tx instanceof Transaction) {
      msg = tx.compileMessage()
    } else {
      msg = tx.message
    }
    const { signature } = await this.wallet.signTransaction(this.path, Buffer.from(msg.serialize()))
    tx.addSignature(this.publicKey, signature)
    return tx
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]) {
    console.info('Signing multiple transactions with Ledger')
    const signedTxs: T[] = []
    for (const tx of txs) {
      signedTxs.push(await this.signTransaction(tx))
    }
    return signedTxs
  }

  get payer(): Keypair {
    throw new Error('Payer method not available on Ledger')
  }
}

SolanaChain.getWallet = async function loadSolanaWallet({
  wallet: walletOpt,
}: { wallet?: unknown } = {}): Promise<SolanaWallet> {
  if (!walletOpt) walletOpt = process.env['USER_KEY'] || process.env['OWNER_KEY']
  if (typeof walletOpt !== 'string')
    throw new Error(`Invalid wallet option: ${util.inspect(walletOpt)}`)
  if ((walletOpt ?? '').startsWith('ledger')) {
    let derivationPath = walletOpt.split(':')[1] ?? '0'
    if (!derivationPath) derivationPath = "44'/501'/0'"
    else if (!isNaN(Number(derivationPath))) derivationPath = `44'/501'/${derivationPath}'`
    const wallet = await LedgerSolanaWallet.create(derivationPath)
    return wallet as SolanaWallet
  }
  return new SolanaWallet(
    Keypair.fromSecretKey(
      walletOpt.startsWith('0x') ? getBytes(walletOpt) : bs58.decode(walletOpt),
    ),
  )
}

export function fetchChainsFromRpcs(
  argv: { rpcs?: string[]; 'rpcs-file'?: string },
  txHash?: undefined,
  destroy?: Promise<unknown>,
): ChainGetter
export function fetchChainsFromRpcs(
  argv: { rpcs?: string[]; 'rpcs-file'?: string },
  txHash: string,
  destroy?: Promise<unknown>,
): [ChainGetter, Promise<ChainTransaction>]

export function fetchChainsFromRpcs(
  argv: { rpcs?: string[]; 'rpcs-file'?: string },
  txHash?: string,
  destroy?: Promise<unknown>,
) {
  const chains: Record<string, Promise<Chain>> = {}
  const chainsCbs: Record<
    string,
    readonly [resolve: (value: Chain) => void, reject: (reason?: unknown) => void]
  > = {}
  let finished = false
  const txs: Promise<ChainTransaction>[] = []

  const init$ = collectEndpoints(argv).then((endpoints) => {
    const pendingPromises: Promise<unknown>[] = []
    for (const C of Object.values(supportedChains)) {
      for (const url of endpoints) {
        let chain$: Promise<Chain>, tx$
        if (txHash) {
          ;[chain$, tx$] = C.txFromUrl(url, txHash)
          void tx$.then(
            ({ chain }) => {
              // in case tx is found, overwrite chain with the one which found this tx
              chains[chain.network.name] = chain$
              delete chainsCbs[chain.network.name]
            },
            () => {},
          )
          txs.push(tx$)
        } else {
          chain$ = C.fromUrl(url)
        }

        pendingPromises.push(
          chain$.then((chain) => {
            if (chain.network.name in chains && !(chain.network.name in chainsCbs))
              return chain.destroy() // lost race
            void destroy?.finally(() => {
              void chain.destroy() // cleanup
            })
            if (!(chain.network.name in chains)) {
              chains[chain.network.name] = Promise.resolve(chain)
            } else if (chain.network.name in chainsCbs) {
              const [resolve] = chainsCbs[chain.network.name]
              resolve(chain)
            }
          }),
        )
      }
    }
    const res = Promise.allSettled(pendingPromises)
    void (destroy ? Promise.race([res, destroy]) : res).finally(() => {
      finished = true
      Object.entries(chainsCbs).forEach(([name, [_, reject]]) =>
        reject(new Error(`No provider/chain found for network=${name}`)),
      )
    })
    return Promise.any(txs)
  })

  const chainGetter = async (idOrSelectorOrName: number | string | bigint): Promise<Chain> => {
    const network = networkInfo(idOrSelectorOrName)
    if (network.name in chains) return chains[network.name]
    if (finished) throw new Error(`No provider/chain found for network=${network.name}`)
    chains[network.name] = new Promise((resolve, reject) => {
      chainsCbs[network.name] = [resolve, reject]
    })
    void chains[network.name].finally(() => {
      delete chainsCbs[network.name]
    })
    return chains[network.name]
  }

  if (txHash) {
    return [chainGetter, init$]
  } else {
    void init$.catch(() => {})
    return chainGetter
  }
}
