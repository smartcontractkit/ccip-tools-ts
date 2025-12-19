import { existsSync, readFileSync } from 'node:fs'

import { CCIPArgumentInvalidError, CCIPNotImplementedError } from '@chainlink/ccip-sdk/src/index.ts'
import { Wallet as AnchorWallet } from '@coral-xyz/anchor'
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
import { getBytes, hexlify } from 'ethers'

/** Ledger hardware wallet signer for Solana. */
export class LedgerSolanaWallet {
  publicKey: PublicKey
  wallet: SolanaLedger.default
  path: string

  /**
   * Private constructor - use static `create` method instead.
   * @internal
   */
  private constructor(solanaLW: SolanaLedger.default, pubKey: PublicKey, path: string) {
    this.wallet = solanaLW
    this.publicKey = pubKey
    this.path = path
  }

  /**
   * Creates a new LedgerSolanaWallet instance.
   * @param path - BIP44 derivation path.
   * @returns A new LedgerSolanaWallet instance.
   */
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

  /**
   * Signs a transaction with the Ledger device.
   * @param tx - Transaction to sign.
   * @returns Signed transaction.
   */
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

  /**
   * Signs multiple transactions with the Ledger device.
   * @param txs - Transactions to sign.
   * @returns Signed transactions.
   */
  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]) {
    console.info('Signing multiple transactions with Ledger')
    const signedTxs: T[] = []
    for (const tx of txs) {
      signedTxs.push(await this.signTransaction(tx))
    }
    return signedTxs
  }

  /** Payer property - not available on Ledger. */
  get payer(): Keypair {
    throw new CCIPNotImplementedError('payer for Ledger')
  }
}

/**
 * Loads a Solana wallet from a file or Ledger device.
 * @param wallet - wallet options (as passed to yargs argv)
 * @returns Promise to Anchor Wallet instance
 */
export async function loadSolanaWallet({
  wallet: walletOpt,
}: { wallet?: unknown } = {}): Promise<AnchorWallet> {
  // Default to Solana's standard keypair location if no wallet provided
  if (!walletOpt) walletOpt = '~/.config/solana/id.json'
  let wallet: string
  if (typeof walletOpt !== 'string') throw new CCIPArgumentInvalidError('wallet', String(walletOpt))
  wallet = walletOpt
  if (walletOpt === 'ledger' || walletOpt.startsWith('ledger:')) {
    let derivationPath = walletOpt.split(':')[1]
    if (!derivationPath) derivationPath = "44'/501'/0'"
    else if (!isNaN(Number(derivationPath))) derivationPath = `44'/501'/${derivationPath}'`
    return (await LedgerSolanaWallet.create(derivationPath)) as AnchorWallet
  } else if (existsSync(walletOpt)) {
    wallet = hexlify(new Uint8Array(JSON.parse(readFileSync(walletOpt, 'utf8'))))
  }
  return new AnchorWallet(
    Keypair.fromSecretKey(wallet.startsWith('0x') ? getBytes(wallet) : bs58.decode(wallet)),
  )
}
