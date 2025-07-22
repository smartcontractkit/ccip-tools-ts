import {
  type CommittedTransactionResponse,
  type Network,
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  NetworkToNetworkName,
} from '@aptos-labs/ts-sdk'
import { createSurfClient } from '@thalalabs/surf'
import { calculateManualExecProof } from '../execution'
import { parseExtraArgs } from '../extra-args'
import { type CCIPRequest, type ExecutionReport, CCIPVersion } from './../types'
import { CreateAptosOffRampABI } from './abi/offramp'
import { serializeExecutionReport } from './bcs'

export const newAptosClient = (chainName: string): Aptos => {
  const network: Network = NetworkToNetworkName[chainName.split('-')[1]]
  const config = new AptosConfig({ network })
  const client = new Aptos(config)

  return client
}

function assertCCIPVersionAtLeast1_6(
  request: CCIPRequest,
): asserts request is CCIPRequest<typeof CCIPVersion.V1_6> {
  // Aptos is only supported on CCIP 1.6 or above, so we'll check here that the request is not 1.2 or 1.5
  if (request.lane.version === CCIPVersion.V1_2 || request.lane.version === CCIPVersion.V1_5) {
    throw new Error('Aptos manual execution only supports CCIP 1.6')
  }
}

const constructAptosExecutionReportFromRequest = (
  request: CCIPRequest<typeof CCIPVersion.V1_6>,
): Uint8Array<ArrayBufferLike> => {
  const { proofs } = calculateManualExecProof([request.message], request.lane, [
    request.message.header.messageId,
  ])

  const executionReportRaw: ExecutionReport = {
    sourceChainSelector: BigInt(request.lane.sourceChainSelector),
    message: request.message,
    proofs,
    // Offchain token data is unsupported for manual exec
    offchainTokenData: new Array(request.message.tokenAmounts.length).fill('0x') as string[],
  }

  const extraArgs = parseExtraArgs(request.message.extraArgs)

  if (!extraArgs || extraArgs._tag !== 'EVMExtraArgsV2') {
    throw new Error('Invalid extraArgs, not EVMExtraArgsV2')
  }

  if (!extraArgs.gasLimit) {
    throw new Error('Execution report gasLimit could not be found')
  }

  return serializeExecutionReport(executionReportRaw, extraArgs.gasLimit)
}

const APTOS_ERROR_MAPPING = {
  E_MANUAL_EXECUTION_NOT_YET_ENABLED:
    'Manual Execution is not yet enabled for this transaction, please wait until the Transaction has been committed for over an hour.',
}

const possibleErrorReasons = (errorVmStatus: string) => {
  if (errorVmStatus.includes('E_MANUAL_EXECUTION_NOT_YET_ENABLED'))
    return APTOS_ERROR_MAPPING.E_MANUAL_EXECUTION_NOT_YET_ENABLED
}

export const buildManualExecutionTxWithAptosDestination = async (
  aptosClient: Aptos,
  request: CCIPRequest,
  offRampAddress: string,
): Promise<void> => {
  // Before we do anything, we need to make sure the request is at least CCIP 1.6, we'll assert here just for typescript safety
  assertCCIPVersionAtLeast1_6(request)

  // Manual Execution for Aptos is broadly broken down into a couple steps:
  // 1. Calculate the proofs for the manual execution
  // 2. Construct the execution report
  // 3. BCS Encode the execution report (We use BCS internally within Aptos for handling this, so we need to serialize it)
  // 4. Call the bindings, to manually execute.

  // Steps 1-3
  const executionReportSerialized = constructAptosExecutionReportFromRequest(request)

  // We'll use a TypeScript bindings to handle interacting with the offramp contract, not the raw client just to make it easier to work with.
  const offRampClient = createSurfClient(aptosClient).useABI(CreateAptosOffRampABI(offRampAddress))

  const privateKey = process.env.USER_KEY
  if (!privateKey) {
    throw new Error('Unable to send Aptos Transaction, no private key has been provided')
  }

  // Step 4 - Manually Execute the Transaction
  await offRampClient.entry
    .manually_execute({
      typeArguments: [],
      functionArguments: [executionReportSerialized],
      account: Account.fromPrivateKey({
        privateKey: new Ed25519PrivateKey(privateKey, false),
      }),
      isSimulation: false,
    })
    .then((tx) => {
      console.info(
        `View Transaction: https://explorer.aptoslabs.com/txn/${tx.hash}?network=mainnet`,
      )
    })
    .catch((error: { transaction: CommittedTransactionResponse }) => {
      if (!error.transaction.success) {
        console.error(
          `View Transaction: https://explorer.aptoslabs.com/txn/${error.transaction.hash}?network=${aptosClient.config.network}`,
        )
        console.error(`Manual Execution Transaction Failed: ${error.transaction.vm_status}`)
        const possibleError = possibleErrorReasons(error.transaction.vm_status)
        if (possibleError) {
          console.warn(possibleError)
        }
      }
    })
}
