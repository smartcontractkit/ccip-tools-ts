import { existsSync, readFileSync } from 'node:fs'

import {
  type UnsignedTONTx,
  CCIPArgumentInvalidError,
  CCIPWalletInvalidError,
  bytesToBuffer,
} from '@chainlink/ccip-sdk/src/index.ts'
import HIDTransport from '@ledgerhq/hw-transport-node-hid'
import { keyPairFromSecretKey, mnemonicToPrivateKey } from '@ton/crypto'
import { type TonClient, Address, SendMode, WalletContractV4, internal, toNano } from '@ton/ton'
import { TonTransport } from '@ton-community/ton-ledger'

/**
 * Loads a TON wallet from the provided options.
 * @param client - TON client instance
 * @param wallet - wallet options (as passed from yargs argv)
 * @param isTestnet - whether the wallet is on the testnet
 * @returns Promise to TONWallet instance
 */
export async function loadTonWallet(
  client: TonClient,
  { wallet: walletOpt }: { wallet?: unknown } = {},
  isTestnet?: boolean,
) {
  if (typeof walletOpt !== 'string') throw new CCIPWalletInvalidError(walletOpt)
  if (walletOpt === 'ledger' || walletOpt.startsWith('ledger:')) {
    const transport = await HIDTransport.default.create()
    const ton = new TonTransport(transport)
    let derivationPath = walletOpt.split(':')[1]
    if (!derivationPath) derivationPath = `44'/607'/${isTestnet ? '1' : '0'}'/0/0/0`
    else if (!isNaN(Number(derivationPath)))
      derivationPath = `44'/607'/${isTestnet ? '1' : '0'}'/0/${derivationPath}/0`
    const match = derivationPath.match(
      /^(?:m\/)?(\d+)'?\/(\d+)'?\/(\d+)'?\/(\d+)'?\/(\d+)'?\/(\d+)'?$/,
    )
    if (!match) throw new CCIPWalletInvalidError(walletOpt)
    const path = match.slice(1).map((x) => parseInt(x))
    const { address, publicKey } = await ton.getAddress(path, {
      chain: 0,
      bounceable: false,
      testOnly: isTestnet,
    })
    console.info('Ledger TON:', address, ', derivationPath:', derivationPath)
    const contract = WalletContractV4.create({
      workchain: 0,
      publicKey,
    })
    const openedWallet = client.open(contract)
    return {
      getAddress: () => address,
      sendTransaction: async ({ value, body, ...args }: UnsignedTONTx) => {
        const seqno = await openedWallet.getSeqno()
        const to = Address.parse(args.to)
        if (!value) {
          const { source_fees } = await client.estimateExternalMessageFee(to, {
            ignoreSignature: true,
            body,
            initCode: null,
            initData: null,
          })
          value =
            BigInt(
              source_fees.storage_fee +
                source_fees.gas_fee +
                source_fees.fwd_fee +
                source_fees.in_fwd_fee,
            ) + toNano('0.0001') // buffer
        }
        const signed = await ton.signTransaction(path, {
          seqno,
          amount: value,
          sendMode: SendMode.IGNORE_ERRORS | SendMode.PAY_GAS_SEPARATELY,
          timeout: Math.floor(Date.now() / 1000 + 60),
          bounce: false,
          ...args,
          to,
          payload: {
            type: 'unsafe',
            message: body,
          },
        })
        await openedWallet.send(signed)
        return seqno
      },
    }
  }

  let keyPair
  if (existsSync(walletOpt)) {
    // Handle file path
    const content = readFileSync(walletOpt, 'utf8').trim()
    const secretKey = bytesToBuffer(content)
    if (secretKey.length !== 64) {
      throw new CCIPArgumentInvalidError('wallet', 'Invalid private key in file: must be 64 bytes')
    }
    keyPair = keyPairFromSecretKey(secretKey)
  } else if (walletOpt.includes(' ')) {
    // Handle mnemonic phrase
    const mnemonic = walletOpt.trim().split(' ')
    keyPair = await mnemonicToPrivateKey(mnemonic)
  } else if (walletOpt.startsWith('0x')) {
    // Handle hex private key
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
    keyPair = keyPairFromSecretKey(secretKey)
  }

  if (keyPair) {
    const contract = WalletContractV4.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    })
    const openedWallet = client.open(contract)
    return {
      getAddress: () => contract.address.toString(),
      sendTransaction: async (args: UnsignedTONTx) => {
        const seqno = await openedWallet.getSeqno()
        const signed = await openedWallet.createTransfer({
          ...keyPair,
          seqno,
          messages: [
            internal({
              value: toNano('0.3'), // TODO: FIXME: estimate proper value for execution costs instead of hardcoding.
              ...args,
            }),
          ],
        })
        await openedWallet.send(signed)
        return seqno
      },
    }
  }

  throw new CCIPArgumentInvalidError('wallet', 'Wallet not specified')
}
