import { type Aptos, AccountAddress } from '@aptos-labs/ts-sdk'

import type { CCIPMessage_V1_6_EVM } from '../evm/messages.ts'
import { decodeMessageV1Raw } from '../messages.ts'
import type { CCIPMessage, CCIPVersion, ExecutionInput } from '../types.ts'
import { getDataBytes } from '../utils.ts'
import { serializeExecutionReport } from './types.ts'

/**
 * Executes as single message report in offramp
 *
 * @param provider - Aptos provider instance
 * @param payer - async Account
 * @param offRamp - Offramp contract address (with or without `::offramp` suffix)
 * @param execReport - Aptos uses EVMExtraArgsV2, so same message as EVM v1.6
 * @param opts - options like gasLimit override
 * @returns exec txHash
 */
export async function generateUnsignedExecuteReport(
  provider: Aptos,
  payer: string,
  offRamp: string,
  execReport: ExecutionInput<CCIPMessage_V1_6_EVM>,
  opts?: { gasLimit?: number; txGasLimit?: number },
) {
  // Prepare proofs as byte arrays
  const serialized = serializeExecutionReport(execReport)

  // Build the transaction to call manually_execute
  // The function signature should be something like:
  // public entry fun manually_execute(
  //     caller: &signer,
  //     merkle_root: vector<u8>,
  //     proofs: vector<vector<u8>>,
  //     proof_flag_bits: u256,
  //     message_id: vector<u8>,
  //     source_chain_selector: u64,
  //     dest_chain_selector: u64,
  //     sequence_number: u64,
  //     nonce: u64,
  //     sender: vector<u8>,
  //     receiver: vector<u8>,
  //     data: vector<u8>,
  //     token_addresses: vector<address>,
  //     token_amounts: vector<u256>,
  //     offchain_token_data: vector<vector<u8>>,
  //     gas_limit: u256
  // )
  const transaction = await provider.transaction.build.simple({
    sender: AccountAddress.fromString(payer),
    data: {
      function:
        `${offRamp.includes('::') ? offRamp : offRamp + '::offramp'}::manually_execute` as `${string}::${string}::${string}`,
      functionArguments: [serialized],
    },
    options: { maxGasAmount: opts?.txGasLimit ?? opts?.gasLimit },
  })

  return transaction.bcsToBytes()
}

/**
 * Executes a CCIP 2.0 message in offramp: `execute` takes the message as it was emitted, and the
 * results of its verifiers; any account can call it
 *
 * @param provider - Aptos provider instance
 * @param payer - async Account
 * @param offRamp - Offramp module (`<package>::offramp`)
 * @param input - encoded message and its verifications
 * @param opts - options like gasLimit override; the transaction's gas defaults to the message's
 * @returns exec txHash
 */
export async function generateUnsignedExecuteV2(
  provider: Aptos,
  payer: string,
  offRamp: string,
  { encodedMessage, verifications }: ExecutionInput<CCIPMessage<typeof CCIPVersion.V2_0>>,
  opts?: { gasLimit?: number; txGasLimit?: number },
) {
  const transaction = await provider.transaction.build.simple({
    sender: AccountAddress.fromString(payer),
    data: {
      function: `${offRamp}::execute` as `${string}::${string}::${string}`,
      functionArguments: [
        getDataBytes(encodedMessage),
        verifications.map(({ destAddress }) => AccountAddress.from(destAddress)),
        verifications.map(({ ccvData }) => getDataBytes(ccvData)),
        opts?.gasLimit ?? 0, // gas_limit_override
      ],
    },
    options: {
      maxGasAmount:
        opts?.txGasLimit ??
        (Number(decodeMessageV1Raw(encodedMessage).executionGasLimit) || undefined),
    },
  })

  return transaction.bcsToBytes()
}
