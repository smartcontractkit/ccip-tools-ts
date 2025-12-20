import type { PickDeep } from 'type-fest'

import type { Chain, ChainStatic, LogFilter } from './chain.ts'
import { CCIPCommitNotFoundError } from './errors/index.ts'
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
    message,
    tx: { timestamp: requestTimestamp },
  }: PickDeep<CCIPRequest, 'lane' | 'message.sequenceNumber' | 'tx.timestamp'>,
  hints?: Pick<LogFilter, 'page' | 'watch'> & { startBlock?: number },
): Promise<CCIPCommit> {
  for await (const log of dest.getLogs({
    ...hints,
    ...(!hints?.startBlock ? { startTime: requestTimestamp } : { startBlock: hints.startBlock }),
    address: commitStore,
    topics: [lane.version < CCIPVersion.V1_6 ? 'ReportAccepted' : 'CommitReportAccepted'],
  })) {
    const reports = (dest.constructor as ChainStatic).decodeCommits(log, lane)
    if (!reports) continue
    const validReports = reports.filter((r) => {
      if (!r || r.maxSeqNr < message.sequenceNumber) return
      // we could give up since we walk forward from some startBlock/startTime, but there might be some out-of-order logs
      if (r.minSeqNr > message.sequenceNumber) return
      return true
    })

    if (validReports.length === 0) continue

    return {
      log,
      report: validReports[0],
    }
  }

  throw new CCIPCommitNotFoundError(
    hints?.startBlock ?? String(requestTimestamp),
    message.sequenceNumber,
  )
}
