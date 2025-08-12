import { type Provider, type Result, Interface, isHexString } from 'ethers'

import {
  type CCIPCommit,
  type CCIPContractEVM,
  type CommitReport,
  type Lane,
  CCIPContractType,
  CCIPVersion,
  CCIP_ABIs,
} from './types.ts'
import {
  blockRangeGenerator,
  getContractProperties,
  getSomeBlockNumberBefore,
  lazyCached,
} from './utils.ts'
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes/index'

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
      // fetch first CommitReport log (of any CommitStore) which has our desired interval
      if (report.minSeqNr > header.sequenceNumber || header.sequenceNumber > report.maxSeqNr)
        continue
      if (lane.version < CCIPVersion.V1_6) {
        try {
          const [staticConfig] = await getContractProperties(
            [log.address, commitStoreInterface, dest] as unknown as CCIPContractEVM<
              typeof CCIPContractType.CommitStore,
              typeof CCIPVersion.V1_2 | typeof CCIPVersion.V1_5
            >,
            'getStaticConfig',
          )

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
    console.log('Inside resultsToCommitReport for 1.6', result.toObject())
    const normalizedOnramp = normalizeOnrampAddress(lane.onRamp)
    const res = [...(result[0] as Result[]), ...(result[1] as Result[])].find(
      (r) =>
        r.sourceChainSelector === lane.sourceChainSelector &&
        (r.onRampAddress as string).toLowerCase().endsWith(normalizedOnramp),
    )
    if (!res) return
    return {
      ...res.toObject(),
      onRampAddress: lane.onRamp,
    } as CommitReport
  }
}

function normalizeOnrampAddress(onRamp: string): string {
  if (onRamp.startsWith('0x')) {
    return onRamp.slice(2).toLowerCase()
  }

  if (isHexString(onRamp)) {
    return onRamp.toLowerCase()
  }

  const bs58decoded = bs58.decode(onRamp)
  if (bs58decoded.length !== 32) {
    throw Error(`Invalid onramp address ${onRamp} - it is neither hex nor a Solana address`)
  }
  return bs58decoded.toString('hex')
}
