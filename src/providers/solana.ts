import util from 'util'

import { Wallet as SolanaWallet } from '@coral-xyz/anchor'
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
import { getBytes } from 'ethers'

import { SolanaChain } from '../lib/index.ts'

export class LedgerSolanaWallet {
  publicKey: PublicKey
  wallet: SolanaLedger.default
  path: string

  private constructor(solanaLW: SolanaLedger.default, pubKey: PublicKey, path: string) {
    this.wallet = solanaLW
    this.publicKey = pubKey
    this.path = path
  }

  static async create(path: string) {
    try {
      const transport = await HIDTransport.default.create()
      const solana = new SolanaLedger.default(transport)
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
    let derivationPath = walletOpt.split(':')[1]
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
