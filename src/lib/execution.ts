import { Contract, type ContractRunner, Interface, type Provider } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import { getLeafHasher, proofFlagsToBits, Tree } from './hasher/index.js'
import type { CCIPExecution, CCIPRequest, ExecutionReceipt } from './types.js'
import {
  CCIP_ABIs,
  CCIPContractTypeOffRamp,
  type CCIPMessage,
  type CCIPVersion,
  type Lane,
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
  { destChainSelector, onRamp }: Pick<Lane, 'destChainSelector' | 'onRamp'>,
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
  runner: ContractRunner,
  { sourceChainSelector, destChainSelector, onRamp }: Lane,
  ccipVersion: V,
  hints?: { fromBlock?: number },
): Promise<TypedContract<(typeof CCIP_ABIs)[CCIPContractTypeOffRamp][V]>> {
  const dest = runner.provider!
  const offRampABI = CCIP_ABIs[CCIPContractTypeOffRamp][ccipVersion]
  const offRampInterface = new Interface(offRampABI)
  const topic0 = offRampInterface.getEvent('ExecutionStateChanged')!.topicHash

  const seen = new Set<string>()
  const latestBlock = await dest.getBlockNumber()
  for (const blockRange of blockRangeGenerator({
    endBlock: latestBlock,
    startBlock: hints?.fromBlock,
  })) {
    // we don't know our OffRamp address yet, so fetch any compatible log
    const logs = await dest.getLogs({ ...blockRange, topics: [topic0] })

    for (const log of logs) {
      if (seen.has(log.address)) continue

      try {
        const [staticConfig, offRampContract] = await getOffRampStaticConfig(runner, log.address)

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

export async function getOffRampStaticConfig(dest: ContractRunner, address: string) {
  return lazyCached(`OffRamp ${address}.staticConfig`, async () => {
    const [type_, version] = await getTypeAndVersion(dest.provider!, address)
    if (type_ != CCIPContractTypeOffRamp)
      throw new Error(`Not an OffRamp: ${address} is "${type_} ${version}"`)
    const offRampABI = CCIP_ABIs[CCIPContractTypeOffRamp][version]
    const offRampContract = new Contract(address, offRampABI, dest) as unknown as TypedContract<
      typeof offRampABI
    >
    const staticConfig = await offRampContract.getStaticConfig()
    return [staticConfig, offRampContract] as const
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
  requests: readonly Pick<CCIPRequest, 'message' | 'log' | 'version'>[],
  hints?: { fromBlock?: number },
): AsyncGenerator<CCIPExecution, void, unknown> {
  const onlyLast = !hints?.fromBlock // backwards
  const latestBlock = await dest.getBlockNumber()

  const onrampToOfframp = new Map<string, string>()
  const messageIdsCompleted = new Set<string>()
  for (const blockRange of blockRangeGenerator({
    endBlock: latestBlock,
    startBlock: hints?.fromBlock,
  })) {
    // we build filters on every loop, so we can narrow them down
    // depending on the remaining work to do (discovered offramps, requests left)
    const addressFilter = new Set<string>()
    for (const request of requests) {
      const offramp = onrampToOfframp.get(request.log.address)
      if (offramp) addressFilter.add(offramp)
      else {
        addressFilter.clear() // we haven't discovered some offramp yet,
        break // so don't filter by offramps contract address
      }
    }
    // support fetching with different versions/topics
    const topics = new Set(
      requests.map(({ version }) => {
        const offRampInterface = getOffRampInterface(version)
        return offRampInterface.getEvent('ExecutionStateChanged')!.topicHash
      }),
    )

    // we don't know our OffRamp address yet, so fetch any compatible log
    const logs = await dest.getLogs({
      ...blockRange,
      ...(addressFilter.size ? { address: Array.from(addressFilter) } : {}),
      topics: Array.from(topics),
    })
    if (onlyLast) logs.reverse()

    let lastLogBlock: readonly [block: number, timestamp: number] | undefined
    for (const log of logs) {
      try {
        const [staticConfig] = await getOffRampStaticConfig(dest, log.address)

        for (const request of requests) {
          // reject if it's not an OffRamp for our onRamp
          if (
            request.message.sourceChainSelector !== staticConfig.sourceChainSelector ||
            request.log.address !== staticConfig.onRamp
          )
            continue
          onrampToOfframp.set(request.log.address, log.address) // found an offramp of interest!

          const offRampInterface = getOffRampInterface(request.version)
          const decoded = offRampInterface.parseLog(log)
          if (!decoded) continue

          const receipt = decoded.args.toObject() as ExecutionReceipt
          if (
            receipt.messageId !== request.message.messageId ||
            messageIdsCompleted.has(receipt.messageId)
          )
            continue
          // onlyLast if we're paging blockRanges backwards, or if receipt.state is success (last state)
          if (onlyLast || Number(receipt.state) === SUCCESS) {
            messageIdsCompleted.add(receipt.messageId)
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
    }
    // cleanup requests, which _may_ also simplify next pages' topics
    requests = requests.filter(({ message }) => !messageIdsCompleted.has(message.messageId))
    // all messages were seen (if onlyLast) or completed (state==success)
    if (!requests.length) break
  }
}
