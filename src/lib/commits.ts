import { Contract, Interface, type Provider, type Result } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import type { CCIPRequest } from './types.js'
import {
  CCIP_ABIs,
  type CCIPCommit,
  CCIPContractTypeCommitStore,
  type CommitReport,
} from './types.js'
import { blockRangeGenerator, getSomeBlockNumberBefore, lazyCached } from './utils.js'

/**
 * Look for a CommitReport at dest for given CCIP request
 * If hints are provided, use commitBlock(Number) and commitStore(Address) to narrow filtering
 *
 * @param dest - Destination network provider
 * @param request - CCIP request info
 * @returns CCIP commit info
 **/
export async function fetchCommitReport(
  dest: Provider,
  {
    log: { address: onRamp },
    message,
    timestamp: requestTimestamp,
    lane,
  }: Pick<CCIPRequest, 'lane'> & {
    message: Pick<CCIPRequest['message'], 'sequenceNumber' | 'sourceChainSelector'>
    log: Pick<CCIPRequest['log'], 'address'>
    timestamp?: number
  },
  hints?: { startBlock?: number; commitStore?: string },
): Promise<CCIPCommit> {
  const commitStoreABI = CCIP_ABIs[CCIPContractTypeCommitStore][lane.version]
  const commitStoreInterface = lazyCached(
    `Interface ${CCIPContractTypeCommitStore} ${lane.version}`,
    () => new Interface(commitStoreABI),
  )
  const topic0 = commitStoreInterface.getEvent('ReportAccepted')!.topicHash

  for (const blockRange of blockRangeGenerator({
    endBlock: await dest.getBlockNumber(),
    startBlock:
      hints?.startBlock ??
      (requestTimestamp ? await getSomeBlockNumberBefore(dest, requestTimestamp) : undefined),
  })) {
    // we don't know our CommitStore address yet, so fetch any compatible log
    const logs = await dest.getLogs({
      ...blockRange,
      topics: [topic0],
      ...(hints?.commitStore ? { address: hints?.commitStore } : {}),
    })

    for (const log of logs) {
      const decoded = commitStoreInterface.parseLog(log)
      if (!decoded) continue
      const report = resultsToCommitReport(decoded.args)

      // fetch first ComitReport log (of any CommitStore) which has our desired interval
      if (
        report.interval.min > message.sequenceNumber ||
        message.sequenceNumber > report.interval.max
      )
        continue
      try {
        const staticConfig = await lazyCached(
          `CommitStore ${log.address}.staticConfig`,
          async () => {
            const contract = new Contract(
              log.address,
              commitStoreInterface,
              dest,
            ) as unknown as TypedContract<typeof commitStoreABI>
            return contract.getStaticConfig()
          },
        )

        // reject if it's not a CommitStore for our onRamp
        if (
          message.sourceChainSelector !== staticConfig.sourceChainSelector ||
          onRamp !== staticConfig.onRamp
        )
          continue
      } catch (_) {
        continue
      }

      return { report, log }
    }
  }

  throw new Error(
    `Could not find commit after ${hints?.startBlock ?? requestTimestamp} for sequenceNumber=${message.sequenceNumber}`,
  )
}

// TODO: find a way to make these conversions generic
function resultsToCommitReport(result: Result): CommitReport {
  if (result.length === 1) result = result[0] as Result
  const report = {
    ...result.toObject(true),
    priceUpdates: {
      tokenPriceUpdates: ((result.priceUpdates as Result).tokenPriceUpdates as Result).map(
        (update) => (update as Result).toObject(),
      ),
      gasPriceUpdates: ((result.priceUpdates as Result).gasPriceUpdates as Result).map((update) =>
        (update as Result).toObject(),
      ),
    },
  } as unknown as CommitReport
  return report
}
