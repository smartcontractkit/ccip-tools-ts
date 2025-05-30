import type { AnchorProvider } from '@coral-xyz/anchor'
import {
  type Keypair,
  type TransactionSignature,
  SendTransactionError,
} from '@solana/web3.js'
import type { JsonRpcApiProvider, Provider } from 'ethers'
import { discoverOffRamp } from '../lib/execution.ts'
import {
  type CCIPCommit,
  type CCIPContract,
  type CCIPContractType,
  type CCIPMessage,
  type CCIPRequest,
  CCIPVersion,
  ExecutionState,
  bigIntReplacer,
  calculateManualExecProof,
  chainIdFromSelector,
  chainNameFromSelector,
  estimateExecGasForRequest,
  fetchAllMessagesInBatch,
  fetchCCIPMessageInLog,
  fetchCCIPMessagesInTx,
  fetchCommitReport,
  fetchExecutionReceipts,
  fetchOffchainTokenData,
  fetchRequestsForSender,
  getSomeBlockNumberBefore,
  lazyCached,
} from '../lib/index.ts'
import { isSupportedSolanaCluster } from '../lib/solana/getClusterByChainSelectorName.ts'
import {
  type ManualExecTxs,
  buildManualExecutionTxWithSolanaDestination,
  newAnchorProvider,
} from '../lib/solana/manuallyExecuteSolana.ts'
import type { SupportedSolanaCCIPVersion } from '../lib/solana/programs/versioning.ts'
import { waitForFinalization } from '../lib/solana/utils.ts'
import type { Providers } from '../providers.ts'
import { Format } from './types.ts'
import {
  getWallet,
  prettyCommit,
  prettyRequest,
  selectRequest,
  withDateTimestamp,
} from './utils.ts'

export async function manualExec(
  providers: Providers,
  txHash: string,
  argv: {
    gasLimit?: number
    estimateGasLimit?: number
    tokensGasLimit?: number
    logIndex?: number
    format: Format
    page: number
    wallet?: string
    solanaOfframp?: string
    solanaKeypair?: string
    solanaForceBuffer: boolean
    solanaForceLookupTable: boolean
    solanaClearBufferFirst: boolean
    solanaCuLimit?: number
  },
) {
  const tx = await providers.getTxReceipt(txHash)
  const source = tx.provider

  let request
  if (argv.logIndex != null) {
    request = await fetchCCIPMessageInLog(tx, argv.logIndex)
  } else {
    request = await selectRequest(await fetchCCIPMessagesInTx(tx), 'to execute')
  }

  switch (argv.format) {
    case Format.log:
      console.log(`message ${request.log.index} =`, withDateTimestamp(request))
      break
    case Format.pretty:
      await prettyRequest(source, request)
      break
    case Format.json:
      console.info(JSON.stringify(request, bigIntReplacer, 2))
      break
  }

  const chainId = chainIdFromSelector(request.lane.destChainSelector)
  const chainName = chainNameFromSelector(request.lane.destChainSelector)
  if (typeof chainId === 'string' && isSupportedSolanaCluster(chainName)) {
    if (argv.solanaOfframp === undefined) {
      throw new Error(
        'Automated offramp discovery not supported yet for SVM: You must provide the offramp address with the --solana-offramp argument.',
      )
    }

    const { anchorProvider, keypair } = newAnchorProvider(chainName, argv.solanaKeypair)
    const transactions = await buildManualExecutionTxWithSolanaDestination(
      anchorProvider,
      request as CCIPRequest<SupportedSolanaCCIPVersion>,
      argv.solanaOfframp,
      argv.solanaForceBuffer,
      argv.solanaForceLookupTable,
      argv.solanaClearBufferFirst,
      argv.solanaCuLimit,
    )
    await doManuallyExecuteSolana(keypair, anchorProvider, transactions, chainName)
  } else {
    const dest = await providers.forChainId(chainIdFromSelector(request.lane.destChainSelector))
    await manualExecEvmDestination(source, dest, request, argv)
  }
}

function isCannotCloseTableUntilDeactivated(e: SendTransactionError): boolean {
  // Lookup Tables are first deactivated and then closed. There has to be a cool-down period
  // between the two operations. If the table is closed before it is fully deactivated, the
  // transaction will fail. The cool-down period is ~4mins (more precisely, ~513 blocks), see
  // https://solana.com/vi/developers/courses/program-optimization/lookup-tables#deactivate-a-lookup-table
  return !!e.logs?.some((log) =>
    log.includes("Program log: Table cannot be closed until it's fully deactivated in "),
  )
}

async function doManuallyExecuteSolana(
  payer: Keypair,
  destination: AnchorProvider,
  manualExecTxs: ManualExecTxs,
  cluster: string,
) {
  const url_terminator_map: Record<string, string> = {
    'solana-devnet': 'devnet',
    'solana-mainnet': '',
    'solana-testnet': 'testnet',
  }
  const url_terminator = url_terminator_map[cluster] ?? cluster

  let signature!: TransactionSignature

  const N = manualExecTxs.transactions.length

  for (const [i, transaction] of manualExecTxs.transactions.entries()) {
    // Refresh the blockhash for each transaction, as the blockhash is only valid for a short time
    // and we spend a lot of time waiting for finalization of the previous transactions.
    async function attempt() {
      transaction.message.recentBlockhash = (
        await destination.connection.getLatestBlockhash()
      ).blockhash

      transaction.sign([payer])

      signature = await destination.connection.sendTransaction(transaction)
      const latestBlockhash = await destination.connection.getLatestBlockhash()

      console.log(`Confirming tx #${i + 1} of ${N}: ${signature} ...`)
      await destination.connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed',
      )
      console.log(`Waiting for finalization #${i + 1} of ${N} ...`)
      await waitForFinalization(destination.connection, signature)

      if (i == manualExecTxs.manualExecIdx) {
        console.log(
          `✅🚀🚀🚀 Solana manualExec transaction finalized: https://explorer.solana.com/tx/${signature}?cluster=${url_terminator} 🚀🚀🚀`,
        )
      } else {
        console.log(
          `✅ Solana transaction finalized: https://explorer.solana.com/tx/${signature}?cluster=${url_terminator}`,
        )
      }
    }

    async function attemptWithRetry(currentAttempt: number, maxAttempts: number) {
      try {
        await attempt()
      } catch (e) {
        if (
          currentAttempt <= maxAttempts &&
          e instanceof SendTransactionError &&
          isCannotCloseTableUntilDeactivated(e)
        ) {
          const waitTimeSeconds = 30 // the maxAttempts * waitTimeSeconds should be greater than the cool-down period
          console.error(
            `Closing of lookup table failed (attempt ${currentAttempt} of ${maxAttempts}) because it has recently been deactivated and the cool-down period has not completed.\nWaiting ${waitTimeSeconds}s before retrying ...`,
          )
          await new Promise((resolve) => setTimeout(resolve, waitTimeSeconds * 1000))
          await attemptWithRetry(currentAttempt + 1, maxAttempts)
        } else {
          console.error(`Transaction failed (attempt ${currentAttempt} of ${maxAttempts}):`, e)
          throw e
        }
      }
    }

    await attemptWithRetry(1, 10)
  }
}

async function manualExecEvmDestination(
  source: Provider,
  dest: JsonRpcApiProvider,
  request: CCIPRequest<CCIPVersion>,
  argv: {
    gasLimit?: number
    estimateGasLimit?: number
    tokensGasLimit?: number
    logIndex?: number
    format: Format
    page: number
    wallet?: string
    offramp?: string
  },
) {
  const commit = await fetchCommitReport(dest, request, { page: argv.page })
  switch (argv.format) {
    case Format.log:
      console.log(
        'commit =',
        withDateTimestamp({
          ...commit,
          timestamp: (await dest.getBlock(commit.log.blockNumber))!.timestamp,
        }),
      )
      break
    case Format.pretty:
      await prettyCommit(dest, commit, request)
      break
    case Format.json:
      console.info(JSON.stringify(commit, bigIntReplacer, 2))
      break
  }

  const requestsInBatch = await fetchAllMessagesInBatch(
    source,
    request.lane.destChainSelector,
    request.log,
    commit.report,
    { page: argv.page },
  )

  const manualExecReport = calculateManualExecProof(
    requestsInBatch.map(({ message }) => message),
    request.lane,
    [request.message.header.messageId],
    commit.report.merkleRoot,
  )

  const offchainTokenData = await fetchOffchainTokenData(request)
  const execReport = { ...manualExecReport, offchainTokenData: [offchainTokenData] }

  const wallet = (await getWallet(argv)).connect(dest)
  const offRampContract = await discoverOffRamp(wallet, request.lane, {
    fromBlock: commit.log.blockNumber,
    page: argv.page,
  })

  if (argv.estimateGasLimit != null && 'gasLimit' in request.message) {
    let estimated = await estimateExecGasForRequest(dest, request, {
      offRamp: await offRampContract.getAddress(),
    })
    console.info('Estimated gasLimit override:', estimated)
    estimated += Math.ceil(estimated * (argv.estimateGasLimit / 100))
    if (request.message.gasLimit >= estimated) {
      console.warn(
        'Estimated +',
        argv.estimateGasLimit,
        '% margin =',
        estimated,
        '< original gasLimit =',
        request.message.gasLimit,
        '. Leaving unchanged.',
      )
    } else {
      argv.gasLimit = estimated
    }
  }

  console.debug('manualExecReport:', { ...manualExecReport, root: commit.report.merkleRoot })
  let manualExecTx
  if (request.lane.version === CCIPVersion.V1_2) {
    const gasOverrides = manualExecReport.messages.map(() => BigInt(argv.gasLimit ?? 0))
    manualExecTx = await (
      offRampContract as CCIPContract<typeof CCIPContractType.OffRamp, typeof CCIPVersion.V1_2>
    ).manuallyExecute(
      execReport as {
        offchainTokenData: string[][]
        messages: CCIPMessage<typeof CCIPVersion.V1_2>[]
        proofs: string[]
        proofFlagBits: bigint
      },
      gasOverrides,
    )
  } else if (request.lane.version === CCIPVersion.V1_5) {
    const gasOverrides = manualExecReport.messages.map((message) => ({
      receiverExecutionGasLimit: BigInt(argv.gasLimit ?? 0),
      tokenGasOverrides: message.tokenAmounts.map(() => BigInt(argv.tokensGasLimit ?? 0)),
    }))
    manualExecTx = await (
      offRampContract as CCIPContract<typeof CCIPContractType.OffRamp, typeof CCIPVersion.V1_5>
    ).manuallyExecute(
      execReport as {
        offchainTokenData: string[][]
        messages: CCIPMessage<typeof CCIPVersion.V1_5>[]
        proofs: string[]
        proofFlagBits: bigint
      },
      gasOverrides,
    )
  } /* v1.6 */ else {
    const gasOverrides = manualExecReport.messages.map((message) => ({
      receiverExecutionGasLimit: BigInt(argv.gasLimit ?? 0),
      tokenGasOverrides: message.tokenAmounts.map(() => BigInt(argv.tokensGasLimit ?? 0)),
    }))
    manualExecTx = await (
      offRampContract as CCIPContract<typeof CCIPContractType.OffRamp, typeof CCIPVersion.V1_6>
    ).manuallyExecute(
      [
        {
          sourceChainSelector: request.lane.sourceChainSelector,
          messages: execReport.messages as (CCIPMessage<typeof CCIPVersion.V1_6> & {
            gasLimit: bigint
          })[],
          proofs: execReport.proofs,
          proofFlagBits: execReport.proofFlagBits,
          offchainTokenData: execReport.offchainTokenData,
        },
      ],
      [gasOverrides],
    )
  }

  console.log(
    '🚀 manualExec tx =',
    manualExecTx.hash,
    'to offRamp =',
    manualExecTx.to,
    'gasLimit =',
    Number(manualExecTx.gasLimit),
  )
}

export async function manualExecSenderQueue(
  providers: Providers,
  txHash: string,
  argv: {
    gasLimit?: number
    tokensGasLimit?: number
    logIndex?: number
    execFailed?: boolean
    format: Format
    page: number
    wallet?: string
  },
) {
  const tx = await providers.getTxReceipt(txHash)
  const source = tx.provider

  let firstRequest
  if (argv.logIndex != null) {
    firstRequest = await fetchCCIPMessageInLog(tx, argv.logIndex)
  } else {
    firstRequest = await selectRequest(await fetchCCIPMessagesInTx(tx), 'to execute')
  }
  switch (argv.format) {
    case Format.log:
      console.log(`message ${firstRequest.log.index} =`, withDateTimestamp(firstRequest))
      break
    case Format.pretty:
      await prettyRequest(source, firstRequest)
      break
    case Format.json:
      console.info(JSON.stringify(firstRequest, bigIntReplacer, 2))
      break
  }

  const dest = await providers.forChainId(chainIdFromSelector(firstRequest.lane.destChainSelector))

  const requests: Omit<CCIPRequest, 'timestamp' | 'tx'>[] = []
  for await (const request of fetchRequestsForSender(source, firstRequest)) {
    requests.push(request)
  }
  console.info('Found', requests.length, `requests for "${firstRequest.message.sender}"`)

  const destFromBlock = await getSomeBlockNumberBefore(dest, firstRequest.timestamp)
  const lastExecState = new Map<string, ExecutionState>()
  const firstExecBlock = new Map<string, number>()
  let offRamp: string
  for await (const { receipt, log } of fetchExecutionReceipts(dest, requests, {
    fromBlock: destFromBlock,
    page: argv.page,
  })) {
    lastExecState.set(receipt.messageId, receipt.state)
    if (!firstExecBlock.has(receipt.messageId))
      firstExecBlock.set(receipt.messageId, log.blockNumber)
    offRamp ??= log.address
  }

  const requestsPending = requests.filter(({ message }) =>
    argv.execFailed
      ? lastExecState.get(message.header.messageId) !== ExecutionState.Success
      : !lastExecState.has(message.header.messageId),
  )
  console.info(requestsPending.length, `requests eligible for manualExec`)
  if (!requestsPending.length) return

  const maxExecsInBatch = 1
  const batches: (readonly [
    CCIPCommit,
    Omit<CCIPRequest<CCIPVersion>, 'tx' | 'timestamp'>[],
    string[],
  ])[] = []
  let startBlock = destFromBlock
  for (const request of requestsPending) {
    if (
      batches.length > 0 &&
      request.message.header.sequenceNumber <= batches[batches.length - 1][0].report.maxSeqNr
    ) {
      if (batches[batches.length - 1][2].length >= maxExecsInBatch) {
        batches.push([batches[batches.length - 1][0], batches[batches.length - 1][1], []])
      }
      batches[batches.length - 1][2].push(request.message.header.messageId)
      continue
    }
    const commit = await fetchCommitReport(dest, request, { startBlock, page: argv.page })
    startBlock = commit.log.blockNumber + 1

    const batch = await fetchAllMessagesInBatch(
      source,
      request.lane.destChainSelector,
      request.log,
      commit.report,
      { page: argv.page },
    )
    const msgIdsToExec = [request.message.header.messageId]
    batches.push([commit, batch, msgIdsToExec] as const)
  }
  console.info('Got', batches.length, 'batches to execute')

  const wallet = (await getWallet(argv)).connect(dest)

  const offRampContract = await discoverOffRamp(wallet, firstRequest.lane, {
    fromBlock: destFromBlock,
    page: argv.page,
  })

  let nonce = await wallet.getNonce()
  for (const [i, [commit, batch, msgIdsToExec]] of batches.entries()) {
    const manualExecReport = calculateManualExecProof(
      batch.map(({ message }) => message),
      firstRequest.lane,
      msgIdsToExec,
      commit.report.merkleRoot,
    )
    const requestsToExec = manualExecReport.messages.map(
      ({ header }) =>
        requests.find(({ message }) => message.header.messageId === header.messageId)!,
    )
    const offchainTokenData = await Promise.all(
      requestsToExec.map(async (request) => {
        const tx = await lazyCached(`tx ${request.log.transactionHash}`, () =>
          source.getTransactionReceipt(request.log.transactionHash).then((res) => {
            if (!res) throw new Error(`Tx not found: ${request.log.transactionHash}`)
            return res
          }),
        )
        return fetchOffchainTokenData({ ...request, tx })
      }),
    )
    const execReport = { ...manualExecReport, offchainTokenData }

    let manualExecTx
    if (firstRequest.lane.version === CCIPVersion.V1_2) {
      const gasOverrides = manualExecReport.messages.map(() => BigInt(argv.gasLimit ?? 0))
      manualExecTx = await (
        offRampContract as CCIPContract<typeof CCIPContractType.OffRamp, typeof CCIPVersion.V1_2>
      ).manuallyExecute(
        execReport as {
          offchainTokenData: string[][]
          messages: CCIPMessage<typeof CCIPVersion.V1_2>[]
          proofs: string[]
          proofFlagBits: bigint
        },
        gasOverrides,
        { nonce: nonce++, gasLimit: argv.gasLimit ? argv.gasLimit : undefined },
      )
    } else if (firstRequest.lane.version === CCIPVersion.V1_5) {
      const gasOverrides = manualExecReport.messages.map((message) => ({
        receiverExecutionGasLimit: BigInt(argv.gasLimit ?? 0),
        tokenGasOverrides: message.tokenAmounts.map(() => BigInt(argv.tokensGasLimit ?? 0)),
      }))
      manualExecTx = await (
        offRampContract as CCIPContract<typeof CCIPContractType.OffRamp, typeof CCIPVersion.V1_5>
      ).manuallyExecute(
        execReport as {
          offchainTokenData: string[][]
          messages: CCIPMessage<typeof CCIPVersion.V1_5>[]
          proofs: string[]
          proofFlagBits: bigint
        },
        gasOverrides,
        { nonce: nonce++, gasLimit: argv.gasLimit ? argv.gasLimit : undefined },
      )
    } /* v1.6 */ else {
      const gasOverrides = manualExecReport.messages.map((message) => ({
        receiverExecutionGasLimit: BigInt(argv.gasLimit ?? 0),
        tokenGasOverrides: message.tokenAmounts.map(() => BigInt(argv.tokensGasLimit ?? 0)),
      }))
      manualExecTx = await (
        offRampContract as CCIPContract<typeof CCIPContractType.OffRamp, typeof CCIPVersion.V1_6>
      ).manuallyExecute(
        [
          {
            sourceChainSelector: firstRequest.lane.sourceChainSelector,
            messages: execReport.messages as (CCIPMessage<typeof CCIPVersion.V1_6> & {
              gasLimit: bigint
            })[],
            proofs: execReport.proofs,
            proofFlagBits: execReport.proofFlagBits,
            offchainTokenData: execReport.offchainTokenData,
          },
        ],
        [gasOverrides],
        { nonce: nonce++, gasLimit: argv.gasLimit ? argv.gasLimit : undefined },
      )
    }

    console.log(
      `[${i + 1} of ${batches.length}, ${batch.length} msgs]`,
      'manualExec tx =',
      manualExecTx.hash,
      'to =',
      manualExecTx.to,
      'gasLimit =',
      manualExecTx.gasLimit,
    )
  }
}
