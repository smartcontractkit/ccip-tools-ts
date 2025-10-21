import type { Chain, ChainStatic } from './chain.ts'
import { type CCIPCommit, type Lane, CCIPVersion } from './types.ts'

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
  dest: Chain,
  commitStore: string,
  {
    lane,
    message: { header },
    timestamp: requestTimestamp,
  }: {
    lane: Lane
    message: { header: { sequenceNumber: bigint } }
    timestamp?: number
  },
  hints?: { startBlock?: number; page?: number },
): Promise<CCIPCommit> {
  for await (const log of dest.getLogs({
    ...hints,
    ...(!hints?.startBlock ? { startTime: requestTimestamp } : { startBlock: hints.startBlock }),
    address: commitStore,
    topics: [lane.version < CCIPVersion.V1_6 ? 'ReportAccepted' : 'CommitReportAccepted'],
  })) {
    const report = (dest.constructor as ChainStatic).decodeCommits(log, lane)?.[0]
    if (!report || report.maxSeqNr < header.sequenceNumber) continue
    if (report.minSeqNr > header.sequenceNumber) break
    return { report, log }
  }

  throw new Error(
    `Could not find commit after ${hints?.startBlock ?? requestTimestamp} for sequenceNumber=${header.sequenceNumber}`,
  )
}
