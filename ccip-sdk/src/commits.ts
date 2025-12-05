import type { PickDeep } from 'type-fest'

import type { Chain, ChainStatic } from './chain.ts'
import { type CCIPCommit, type CCIPRequest, CCIPVersion } from './types.ts'

/**
 * Look for a CommitReport at dest for given CCIPRequest
 * Provides a basic/generic implementation, but subclasses of Chain may override with more specific
 * logic in Chain.fetchCommitReport method
 *
 * @param dest - Destination network provider
 * @param commitStore - Commit store address
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
    tx: { timestamp: requestTimestamp },
  }: PickDeep<CCIPRequest, 'lane' | 'message.header.sequenceNumber' | 'tx.timestamp'>,
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
    // since we walk forward from some startBlock/startTime, give up if we find a newer report
    if (report.minSeqNr > header.sequenceNumber) break
    return { report, log }
  }

  throw new Error(
    `Could not find commit after ${hints?.startBlock ?? requestTimestamp} for sequenceNumber=${header.sequenceNumber}`,
  )
}
