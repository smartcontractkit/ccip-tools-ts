import { type Provider, type Result, Contract, Interface } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import {
  type CCIPCommit,
  type CommitReport,
  type Lane,
  CCIPContractType,
  CCIPVersion,
  CCIP_ABIs,
} from './types.js'
import { blockRangeGenerator, getSomeBlockNumberBefore, lazyCached } from './utils.js'

/**
 * Look for a CommitReport at dest for given CCIP request
 * If hints are provided, use commitBlock(Number) and commitStore(Address) to narrow filtering
 *
 * @param dest - Destination network provider
 * @param request - CCIP request info
 * @param hints - Additional filtering hints
 * @returns CCIP commit info
 **/
export async function fetchCommitReport(
  dest: Provider,
  {
    lane,
    message: { header },
    timestamp: requestTimestamp,
  }: {
    lane: Lane
    message: { header: { sequenceNumber: bigint } }
    timestamp?: number
  },
  hints?: { startBlock?: number; commitStore?: string; page?: number },
): Promise<CCIPCommit> {
  const commitStoreType =
    lane.version >= CCIPVersion.V1_6 ? CCIPContractType.OffRamp : CCIPContractType.CommitStore
  const commitStoreABI = CCIP_ABIs[commitStoreType][lane.version]
  const commitStoreInterface = lazyCached(
    `Interface ${commitStoreType} ${lane.version}`,
    () => new Interface(commitStoreABI),
  )
  const topic0 = commitStoreInterface.getEvent(
    lane.version < CCIPVersion.V1_6 ? 'ReportAccepted' : 'CommitReportAccepted',
  )!.topicHash

  for (const blockRange of blockRangeGenerator(
    {
      endBlock: await dest.getBlockNumber(),
      startBlock:
        hints?.startBlock ??
        (requestTimestamp ? await getSomeBlockNumberBefore(dest, requestTimestamp) : undefined),
    },
    hints?.page,
  )) {
    // we don't know our CommitStore address yet, so fetch any compatible log
    const logs = await dest.getLogs({
      ...blockRange,
      topics: [topic0],
      ...(hints?.commitStore ? { address: hints?.commitStore } : {}),
    })
    console.debug('fetchCommitReport: found', logs.length, 'logs in', blockRange)

    for (const log of logs) {
      const decoded = commitStoreInterface.parseLog(log)
      if (!decoded) continue
      const report = resultsToCommitReport(decoded.args, lane)
      if (!report) continue
      // fetch first ComitReport log (of any CommitStore) which has our desired interval
      if (report.minSeqNr > header.sequenceNumber || header.sequenceNumber > report.maxSeqNr)
        continue
      if (lane.version < CCIPVersion.V1_6) {
        try {
          const staticConfig = await lazyCached(`CommitStore ${log.address}.staticConfig`, () => {
            const contract = new Contract(
              log.address,
              commitStoreInterface,
              dest,
            ) as unknown as TypedContract<
              (typeof CCIP_ABIs)[CCIPContractType.CommitStore][CCIPVersion.V1_2 | CCIPVersion.V1_5]
            >
            return contract.getStaticConfig()
          })

          // reject if it's not a CommitStore for our onRamp
          if (
            lane.sourceChainSelector !== staticConfig.sourceChainSelector ||
            lane.onRamp !== staticConfig.onRamp
          )
            continue
        } catch (_) {
          continue
        }
      }

      return { report, log }
    }
  }

  throw new Error(
    `Could not find commit after ${hints?.startBlock ?? requestTimestamp} for sequenceNumber=${header.sequenceNumber}`,
  )
}

// TODO: find a way to make these conversions generic
function resultsToCommitReport<V extends CCIPVersion = CCIPVersion>(
  result: Result,
  lane: Lane<V>,
): CommitReport | undefined {
  if (result.length === 1) result = result[0] as Result
  if (lane.version < CCIPVersion.V1_6) {
    return {
      merkleRoot: result.merkleRoot as string,
      minSeqNr: (result.interval as Result).min as bigint,
      maxSeqNr: (result.interval as Result).max as bigint,
      sourceChainSelector: lane.sourceChainSelector,
      onRampAddress: lane.onRamp,
    }
  } else {
    const res = [...(result[0] as Result[]), ...(result[1] as Result[])].find(
      (r) =>
        r.sourceChainSelector === lane.sourceChainSelector &&
        (r.onRampAddress as string).toLowerCase().endsWith(lane.onRamp.slice(2).toLowerCase()),
    )
    if (!res) return
    return {
      ...res.toObject(),
      onRampAddress: lane.onRamp,
    } as CommitReport
  }
}
