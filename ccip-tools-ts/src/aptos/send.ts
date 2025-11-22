import type { Aptos } from '@aptos-labs/ts-sdk'
import { getBytes, zeroPadValue } from 'ethers'

import { ChainFamily } from '../chain.ts'
import { encodeExtraArgs } from '../extra-args.ts'
import type { AnyMessage } from '../types.ts'
import { getDataBytes } from '../utils.ts'
import type { AptosAsyncAccount } from './types.ts'

export const DEFAULT_FEE_TOKEN = '0xa'

function messageArgs(
  destChainSelector: bigint,
  message: AnyMessage,
): [
  destChainSelector: bigint,
  receiver: Uint8Array,
  data: Uint8Array,
  tokenAddresses: string[],
  tokenAmounts: string[],
  tokenStoreAddresses: string[],
  feeToken: string,
  feeTokenStore: string,
  encodedExtraArgs: Uint8Array,
] {
  // Prepare the message structure for the view call
  const receiver = getBytes(zeroPadValue(getDataBytes(message.receiver), 32))
  const data = getDataBytes(message.data)

  // Get the native token to use as fee token if not specified
  const feeToken = message.feeToken || DEFAULT_FEE_TOKEN
  const feeTokenStore = '0x0' // auto-fetch primary store

  // Split token amounts into separate arrays for Aptos Move
  const tokenAddresses = (message.tokenAmounts ?? []).map((ta) => ta.token)
  const tokenAmounts = (message.tokenAmounts ?? []).map((ta) => ta.amount.toString())
  const tokenStoreAddresses = tokenAddresses.map(() => '0x0')

  // Encode extraArgs for the router
  const encodedExtraArgs = getBytes(encodeExtraArgs(message.extraArgs, ChainFamily.Aptos))

  return [
    destChainSelector,
    receiver,
    data,
    tokenAddresses,
    tokenAmounts,
    tokenStoreAddresses,
    feeToken,
    feeTokenStore,
    encodedExtraArgs,
  ]
}

export async function getFee(
  provider: Aptos,
  router: string,
  destChainSelector: bigint,
  message: AnyMessage,
): Promise<bigint> {
  // Call the get_fee view function on the router
  // Signature: get_fee(dest_chain_selector, receiver, data, token_addresses, token_amounts,
  //                    token_store_addresses, fee_token, fee_token_store, extra_args)
  const [fee] = await provider.view<[string]>({
    payload: {
      function:
        `${router.includes('::') ? router : router + '::router'}::get_fee` as `${string}::${string}::get_fee`,
      functionArguments: messageArgs(destChainSelector, message),
    },
  })

  return BigInt(fee)
}

export async function ccipSend(
  provider: Aptos,
  account: AptosAsyncAccount,
  router: string,
  destChainSelector: bigint,
  message: AnyMessage & { fee: bigint },
  _opts?: { approveMax?: boolean },
): Promise<string> {
  // Build and submit the transaction
  // Call ccip_send entry function with signature:
  // public entry fun ccip_send(
  //     caller: &signer,
  //     dest_chain_selector: u64,
  //     receiver: vector<u8>,
  //     data: vector<u8>,
  //     token_addresses: vector<address>,
  //     token_amounts: vector<u64>,
  //     token_store_addresses: vector<address>,
  //     fee_token: address,
  //     fee_token_store: address,
  //     extra_args: vector<u8>
  // )
  const transaction = await provider.transaction.build.simple({
    sender: account.accountAddress,
    data: {
      function:
        `${router.includes('::') ? router : router + '::router'}::ccip_send` as `${string}::${string}::${string}`,
      functionArguments: messageArgs(destChainSelector, message),
    },
  })

  // Sign and submit the transaction
  const signed = await account.signTransactionWithAuthenticator(transaction)
  const pendingTxn = await provider.transaction.submit.simple({
    transaction,
    senderAuthenticator: signed,
  })

  // Wait for the transaction to be confirmed
  const { hash } = await provider.waitForTransaction({
    transactionHash: pendingTxn.hash,
  })

  // Return the transaction hash
  return hash
}
