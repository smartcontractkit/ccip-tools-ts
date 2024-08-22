import { Contract, Interface, type Provider } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import { getLeafHasher, proofFlagsToBits, Tree } from './hasher/index.js'
import type { CCIPExecution, CCIPRequest, ExecutionReceipt } from './types.js'
import {
  CCIP_ABIs,
  CCIPContractTypeOffRamp,
  type CCIPMessage,
  type CCIPVersion,
  type LeafHasherArgs,
} from './types.js'
import { blockRangeGenerator, getTypeAndVersion, lazyCached } from './utils.js'

/**
 * Pure/sync function to calculate/generate OffRamp.executeManually report for messageIds
 *
 * @param messagesInBatch - Array containing all messages in batch, ordered
 * @param LeafHasherArgs - Arguments for leafeHasher (lane info)
 * @param messageIds - list of messages (from batch) to manually execute
 * @param merkleRoot - Optional merkleRoot of the CommitReport, for validation
 * @returns ManualExec report arguments
 **/
export function calculateManualExecProof(
  messagesInBatch: CCIPMessage[],
  { destChainSelector, onRamp }: Pick<LeafHasherArgs, 'destChainSelector' | 'onRamp'>,
  messageIds: string[],
  merkleRoot?: string,
): {
  messages: CCIPMessage[]
  proofs: string[]
  proofFlagBits: bigint
} {
  const leaves: string[] = []
  const hasher = getLeafHasher({
    sourceChainSelector: messagesInBatch[0].sourceChainSelector,
    destChainSelector,
    onRamp,
  })
  const prove: number[] = []
  const messages: CCIPMessage[] = []
  const seen = new Set<string>()

  messagesInBatch.forEach((message, index) => {
    // Hash leaf node
    leaves.push(hasher(message))
    seen.add(message.messageId)
    // Find the providng leaf index with the matching sequence number
    if (messageIds.includes(message.messageId)) {
      messages.push(message)
      prove.push(index)
    }
  })

  const missing = messageIds.filter((id) => !seen.has(id))
  if (missing.length > 0) {
    throw new Error(`Could not find messageIds: ${missing.join(', ')}`)
  }

  // Create multi-merkle tree
  const tree = new Tree(leaves)

  if (merkleRoot && tree.root() !== merkleRoot) {
    throw new Error(
      `Merkle root created from send events doesn't match ReportAccepted merkle root: expected=${merkleRoot}, got=${tree.root()}`,
    )
  }

  // Generate proof from multi-merkle tree
  const proof = tree.prove(prove)

  const offRampProof = {
    messages,
    proofs: proof.hashes,
    proofFlagBits: proofFlagsToBits(proof.sourceFlags),
  }
  return offRampProof
}

export async function fetchOffRamp<V extends CCIPVersion>(
  dest: Provider,
  { sourceChainSelector, destChainSelector, onRamp }: LeafHasherArgs,
  ccipVersion: V,
  hints?: { fromBlock?: number },
): Promise<TypedContract<(typeof CCIP_ABIs)[CCIPContractTypeOffRamp][V]>> {
  const offRampABI = CCIP_ABIs[CCIPContractTypeOffRamp][ccipVersion]
  const offRampInterface = new Interface(offRampABI)
  const topic0 = offRampInterface.getEvent('ExecutionStateChanged')!.topicHash

  const seen = new Set<string>()
  const latestBlock = await dest.getBlockNumber()
  for (const blockRange of blockRangeGenerator({ endBlock: latestBlock, startBlock: hints?.fromBlock })) {
    // we don't know our OffRamp address yet, so fetch any compatible log
    const logs = await dest.getLogs({ ...blockRange, topics: [topic0] })

    for (const log of logs) {
      if (seen.has(log.address)) continue

      try {
        const [staticConfig, offRampContract] = await getOffRampStaticConfig(dest, log.address)

        // reject if it's not an OffRamp for our onRamp
        if (
          sourceChainSelector === staticConfig.sourceChainSelector &&
          destChainSelector == staticConfig.chainSelector &&
          onRamp === staticConfig.onRamp
        ) {
          return offRampContract as unknown as TypedContract<
            (typeof CCIP_ABIs)[CCIPContractTypeOffRamp][V]
          >
        }
      } catch (_) {
        // passthrough to seen + continue
      }
      seen.add(log.address)
    }
  }

  throw new Error(`Could not find OffRamp for onRamp=${onRamp}`)
}

export async function getOffRampStaticConfig(dest: Provider, address: string) {
  return lazyCached(`OffRamp ${address}.staticConfig`, async () => {
    const [type_, version] = await getTypeAndVersion(dest, address)
    if (type_ != CCIPContractTypeOffRamp)
      throw new Error(`Not an OffRamp: ${address} is "${type_} ${version}"`)
    const offRampABI = CCIP_ABIs[CCIPContractTypeOffRamp][version]
    const offRampContract = new Contract(address, offRampABI, dest) as unknown as TypedContract<
      typeof offRampABI
    >
    return [await offRampContract.getStaticConfig(), offRampContract] as const
  })
}

export function getOffRampInterface(version: CCIPVersion): Interface {
  return lazyCached(
    `OffRampInterface ${version}`,
    () => new Interface(CCIP_ABIs[CCIPContractTypeOffRamp][version]),
  )
}

const SUCCESS = 2

/**
 * Fetch ExecutionReceipts for given requests
 * If more than one request is given, may yield them interleaved
 * 2 possible behaviors:
 * - if `hints.fromBlock` is given, pages forward from that block up
 * - otherwise, pages backwards and returns only the last receipt per request
 * Either way, it completes as soon as there's no more work to be done
 *
 * @param dest - provider to page through
 * @param requests - CCIP requests to search executions for
 * @param hints.fromBlock - A block from where to start paging forward;
 *  otherwise, page backwards and completes on first (most recent) receipt
 **/
export async function* fetchExecutionReceipts(
  dest: Provider,
  requests: CCIPRequest[],
  hints?: { fromBlock?: number },
): AsyncGenerator<CCIPExecution, void, unknown> {
  const onlyLast = !hints?.fromBlock // backwards
  const contractsToIgnore = new Set<string>()
  const completed = new Set<string>()
  const latestBlock = await dest.getBlockNumber()
  for (const blockRange of blockRangeGenerator({ endBlock: latestBlock, startBlock: hints?.fromBlock })) {
    const topics = new Set(
      requests.map(({ version }) => {
        const offRampInterface = getOffRampInterface(version)
        return offRampInterface.getEvent('ExecutionStateChanged')!.topicHash
      }),
    )
    // we don't know our OffRamp address yet, so fetch any compatible log
    const logs = await dest.getLogs({ ...blockRange, topics: Array.from(topics) })
    if (onlyLast) logs.reverse()

    let lastLogBlock: readonly [block: number, timestamp: number] | undefined
    for (const log of logs) {
      if (contractsToIgnore.has(log.address)) continue

      let laneOfInterest = false
      try {
        const [staticConfig] = await getOffRampStaticConfig(dest, log.address)

        for (const request of requests) {
          // reject if it's not an OffRamp for our onRamp
          if (
            request.message.sourceChainSelector !== staticConfig.sourceChainSelector ||
            request.log.address !== staticConfig.onRamp
          )
            continue
          // _some_ of our requests are on this lane
          laneOfInterest = true

          const offRampInterface = getOffRampInterface(request.version)
          const decoded = offRampInterface.parseLog(log)
          if (!decoded) continue

          const receipt = decoded.args.toObject() as ExecutionReceipt
          if (receipt.messageId !== request.message.messageId || completed.has(receipt.messageId))
            continue
          // onlyLast if we're paging blockRanges backwards, or if receipt.state is success (last state)
          if (onlyLast || Number(receipt.state) === SUCCESS) {
            completed.add(receipt.messageId)
          }
          if (log.blockNumber !== lastLogBlock?.[0]) {
            lastLogBlock = [log.blockNumber, (await dest.getBlock(log.blockNumber))!.timestamp]
          }
          yield { receipt, log, timestamp: lastLogBlock[1] }
          break // no need to check the other requests
        }
      } catch (_) {
        // passthrough to contractsToIgnore + continue
      }
      if (!laneOfInterest) contractsToIgnore.add(log.address)
    }
    // cleanup requests, which _may_ also simplify next pages' topics
    requests = requests.filter(({ message }) => !completed.has(message.messageId))
    // all messages were seen (if onlyLast) or completed (state==success)
    if (!requests.length) break
  }
}
