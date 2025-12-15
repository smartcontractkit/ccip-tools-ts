import { Transaction } from '@mysten/sui/transactions'

import { decodeSuiExtraArgs, serializeExecutionReport } from './encoder.ts'
import type { CCIPMessage, CCIPVersion, ExecutionReport } from '../../types.ts'

export type ManuallyExecuteSuiReceiverConfig = {
  moduleName: string
  packageId: string
}

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

export type SuiManuallyExecuteInput = {
  offrampAddress: string
  executionReport: ExecutionReport<CCIPMessage<typeof CCIPVersion.V1_6>>
  ccipAddress: string
  ccipObjectRef: string
  offrampStateObject: string
  receiverConfig: ManuallyExecuteSuiReceiverConfig
  tokenConfigs?: TokenConfig[]
}

export function buildManualExecutionPTB({
  offrampAddress,
  executionReport,
  ccipAddress,
  ccipObjectRef,
  offrampStateObject,
  receiverConfig,
  tokenConfigs,
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
      throw new Error('Token amounts length does not match token configs length')
    }

    // Process each token transfer
    for (let i = 0; i < tokenConfigs.length; i++) {
      const tokenConfig = tokenConfigs[i]

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
  const decodedExtraArgs = decodeSuiExtraArgs(executionReport.message.extraArgs)

  if (decodedExtraArgs.receiverObjectIds.length === 0) {
    throw new Error('No receiverObjectIds provided in SUIExtraArgsV1')
  }
  // Call the receiver contract
  tx.moveCall({
    target: `${receiverConfig.packageId}::${receiverConfig.moduleName}::ccip_receive`,
    arguments: [
      tx.pure.vector('u8', Buffer.from(executionReport.message.header.messageId.slice(2), 'hex')),
      tx.object(ccipObjectRef),
      messageArg,
      // This assumes the original message receiver objects are correct. If this has any error, the message can get stuck. We should be able to override them
      ...decodedExtraArgs.receiverObjectIds.map((objId) => tx.object(objId)),
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
