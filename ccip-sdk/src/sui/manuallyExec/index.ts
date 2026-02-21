import { Buffer } from 'buffer'

import { Transaction } from '@mysten/sui/transactions'

import { serializeExecutionReport } from './encoder.ts'
import { CCIPMessageInvalidError } from '../../errors/specialized.ts'
import { decodeExtraArgs } from '../../extra-args.ts'
import type { ExecutionInput } from '../../types.ts'
import { networkInfo } from '../../utils.ts'
import type { CCIPMessage_V1_6_Sui } from '../types.ts'

/** Configuration for manually executing a Sui receiver module. */
export type ManuallyExecuteSuiReceiverConfig = {
  moduleName: string
  packageId: string
}

/** Configuration for a token pool in manual execution. */
export type TokenConfig = {
  tokenPoolPackageId: string
  tokenPoolModule: string
  tokenType: string
  administrator: string
  pendingAdministrator: string
  tokenPoolTypeProof: string
  lockOrBurnParams: string[]
  releaseOrMintParams: string[]
}

/** Input parameters for building a Sui manual execution transaction. */
export type SuiManuallyExecuteInput = {
  offrampAddress: string
  executionReport: ExecutionInput<CCIPMessage_V1_6_Sui>
  ccipAddress: string
  ccipObjectRef: string
  offrampStateObject: string
  receiverConfig: ManuallyExecuteSuiReceiverConfig
  tokenConfigs?: TokenConfig[]
  overrideReceiverObjectIds?: string[]
}

/**
 * Builds a Sui Programmable Transaction Block for manual CCIP message execution.
 * @param params - Input parameters for building the manual execution transaction.
 * @returns A Transaction object ready to be signed and executed.
 */
export function buildManualExecutionPTB({
  offrampAddress,
  executionReport,
  ccipAddress,
  ccipObjectRef,
  offrampStateObject,
  receiverConfig,
  tokenConfigs,
  overrideReceiverObjectIds,
}: SuiManuallyExecuteInput): Transaction {
  const reportBytes = serializeExecutionReport(executionReport)

  // Create transaction
  const tx = new Transaction()

  // Step 1: Call manually_init_execute to prepare the execution
  const receiverParamsArg = tx.moveCall({
    target: `${offrampAddress}::offramp::manually_init_execute`,
    arguments: [
      tx.object(ccipObjectRef),
      tx.object(offrampStateObject),
      tx.object('0x6'), // Clock object
      tx.pure.vector('u8', Array.from(reportBytes)),
    ],
  })

  // Get the message from the from the report using the offramp helper
  const messageArg = tx.moveCall({
    target: `${ccipAddress}::offramp_state_helper::extract_any2sui_message`,
    arguments: [receiverParamsArg],
  })

  // Process token pool transfers
  if (tokenConfigs && tokenConfigs.length > 0) {
    if (executionReport.message.tokenAmounts.length !== tokenConfigs.length) {
      throw new CCIPMessageInvalidError('Token amounts length does not match token configs length')
    }

    // Process each token transfer
    for (const tokenConfig of tokenConfigs) {
      tx.moveCall({
        target: `${tokenConfig.tokenPoolPackageId}::${tokenConfig.tokenPoolModule}::release_or_mint`,
        typeArguments: [tokenConfig.tokenType],
        arguments: [
          tx.object(ccipObjectRef), // CCIPObjectRef
          receiverParamsArg, // ReceiverParams (mutable)
          ...tokenConfig.releaseOrMintParams.map((param) => tx.object(param)), // Pool-specific objects (clock, deny_list, token_state, state, etc.)
        ],
      })
    }
  }

  // Decode extraArgs to get receiverObjectIds
  const decodedExtraArgs = decodeExtraArgs(
    executionReport.message.extraArgs,
    networkInfo(executionReport.message.destChainSelector).family,
  )

  if (!decodedExtraArgs || decodedExtraArgs._tag !== 'SuiExtraArgsV1') {
    throw new CCIPMessageInvalidError('Expected Sui extra args')
  }

  if (decodedExtraArgs.receiverObjectIds.length === 0) {
    throw new CCIPMessageInvalidError('No receiverObjectIds provided in SUIExtraArgsV1')
  }
  // Call the receiver contract
  tx.moveCall({
    target: `${receiverConfig.packageId}::${receiverConfig.moduleName}::ccip_receive`,
    arguments: [
      tx.pure.vector('u8', Buffer.from(executionReport.message.messageId.slice(2), 'hex')),
      tx.object(ccipObjectRef),
      messageArg,
      // if overrideReceiverObjectIds is provided, use them; otherwise, use the ones from decodedExtraArgs (original message)
      ...(overrideReceiverObjectIds && overrideReceiverObjectIds.length > 0
        ? overrideReceiverObjectIds.map(tx.object)
        : decodedExtraArgs.receiverObjectIds.map(tx.object)),
    ],
  })

  // Step 2: Call finish_execute to complete the execution
  tx.moveCall({
    target: `${offrampAddress}::offramp::finish_execute`,
    arguments: [
      tx.object(ccipObjectRef),
      tx.object(offrampStateObject),
      receiverParamsArg, // ReceiverParams from manually_init_execute
    ],
  })

  return tx
}
