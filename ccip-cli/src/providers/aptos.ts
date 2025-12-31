import { existsSync, readFileSync } from 'node:fs'

import {
  type AccountAddress,
  type AnyRawTransaction,
  Account,
  AccountAuthenticatorEd25519,
  AuthenticationKey,
  Ed25519PrivateKey,
  Ed25519PublicKey,
  Ed25519Signature,
  generateSigningMessageForTransaction,
} from '@aptos-labs/ts-sdk'
import { CCIPArgumentInvalidError } from '@chainlink/ccip-sdk/src/index.ts'
import AptosLedger from '@ledgerhq/hw-app-aptos'
import HIDTransport from '@ledgerhq/hw-transport-node-hid'
import { type BytesLike, getBytes, hexlify } from 'ethers'

/**
 * A LedgerSigner object represents a signer for a private key on a Ledger hardware wallet.
 * This object is initialized alongside a LedgerClient connection, and can be used to sign
 * transactions via a ledger hardware wallet.
 */
export class AptosLedgerSigner /*implements AptosAsyncAccount*/ {
  derivationPath: string
  readonly client: AptosLedger.default
  readonly publicKey: Ed25519PublicKey
  readonly accountAddress: AccountAddress

  /**
   * Private constructor - use static `create` method instead.
   * @internal
   */
  private constructor(
    ledgerClient: AptosLedger.default,
    derivationPath: string,
    publicKey: BytesLike,
  ) {
    this.client = ledgerClient
    this.derivationPath = derivationPath
    this.publicKey = new Ed25519PublicKey(publicKey)
    const authKey = AuthenticationKey.fromPublicKey({
      publicKey: this.publicKey,
    })
    this.accountAddress = authKey.derivedAddress()
  }

  /**
   * Creates a new AptosLedgerSigner instance.
   * @param derivationPath - BIP44 derivation path.
   * @returns A new AptosLedgerSigner instance.
   */
  static async create(derivationPath: string) {
    const transport = await HIDTransport.default.create()
    const client = new AptosLedger.default(transport)
    const { publicKey } = await client.getAddress(derivationPath)
    return new AptosLedgerSigner(client, derivationPath, publicKey)
  }

  /**
   * Prompts user to sign associated transaction on their Ledger hardware wallet.
   * @param txn - Raw transaction to sign.
   * @returns Account authenticator with the signature.
   */
  async signTransactionWithAuthenticator(txn: AnyRawTransaction) {
    const signingMessage = generateSigningMessageForTransaction(txn)

    const signature = await this.sign(signingMessage)
    return new AccountAuthenticatorEd25519(this.publicKey, signature)
  }

  /**
   * Signs a message - returns just the signature.
   * @param message - Message bytes to sign.
   * @returns Ed25519 signature.
   */
  async sign(message: BytesLike): Promise<Ed25519Signature> {
    const messageBytes = getBytes(message)
    // This line prompts the user to sign the transaction on their Ledger hardware wallet
    const { signature } = await this.client.signTransaction(
      this.derivationPath,
      Buffer.from(messageBytes),
    )
    return new Ed25519Signature(signature)
  }

  /**
   * Terminates the LedgerClient connection.
   */
  async close() {
    await this.client.transport.close()
  }
}

/**
 * Loads an Aptos wallet from the provided options.
 * @param wallet - wallet options (as passed from yargs argv)
 * @returns Promise to AptosAsyncAccount instance
 */
export async function loadAptosWallet({ wallet: walletOpt }: { wallet?: unknown }) {
  if (typeof walletOpt !== 'string') throw new CCIPArgumentInvalidError('wallet', String(walletOpt))
  if (walletOpt.startsWith('ledger')) {
    let derivationPath = walletOpt.split(':')[1]
    if (!derivationPath) derivationPath = "m/44'/637'/0'/0'/0'"
    else if (!isNaN(Number(derivationPath))) derivationPath = `m/44'/637'/${derivationPath}'/0'/0'`
    const signer = await AptosLedgerSigner.create(derivationPath)
    console.info(
      'Ledger connected:',
      signer.accountAddress.toStringLong(),
      ', derivationPath:',
      signer.derivationPath,
    )
    return signer
  } else if (existsSync(walletOpt)) {
    walletOpt = hexlify(readFileSync(walletOpt, 'utf8').trim())
  }
  if (walletOpt) {
    return Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(walletOpt as string, false),
    })
  }
  throw new CCIPArgumentInvalidError('wallet', 'not specified')
}
