import { type ContractRunner, type EventFragment, type Provider, Contract, Interface } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import Router from '../abi/Router.js'
import { Tree, getLeafHasher, proofFlagsToBits } from './hasher/index.js'
import {
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type CCIPVersion,
  type ExecutionReceipt,
  type Lane,
  CCIPContractTypeOffRamp,
  CCIP_ABIs,
  ExecutionState,
} from './types.js'
import {
  blockRangeGenerator,
  chainNameFromSelector,
  getTypeAndVersion,
  lazyCached,
} from './utils.js'

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
  messagesInBatch: readonly CCIPMessage[],
  lane: Lane,
  messageIds: string[],
  merkleRoot?: string,
): {
  messages: CCIPMessage[]
  proofs: string[]
  proofFlagBits: bigint
} {
  const leaves: string[] = []
  const hasher = getLeafHasher(lane)
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

export async function validateOffRamp<V extends CCIPVersion>(
  runner: ContractRunner,
  address: string,
  lane: Lane<V>,
): Promise<TypedContract<(typeof CCIP_ABIs)[CCIPContractTypeOffRamp][V]> | undefined> {
  const [staticConfig, offRampContract] = await getOffRampStaticConfig(runner, address)

  if (
    lane.sourceChainSelector === staticConfig.sourceChainSelector &&
    lane.destChainSelector === staticConfig.chainSelector &&
    lane.onRamp === staticConfig.onRamp
  ) {
    return offRampContract as unknown as TypedContract<
      (typeof CCIP_ABIs)[CCIPContractTypeOffRamp][V]
    >
  }
}

export async function discoverOffRamp<V extends CCIPVersion>(
  runner: ContractRunner,
  lane: Lane<V>,
  hints?: { fromBlock?: number },
): Promise<TypedContract<(typeof CCIP_ABIs)[CCIPContractTypeOffRamp][V]>> {
  const dest = runner.provider!
  // we use Router interface to find a router, and from there find the OffRamp,
  // because these events are more frequent than some low-activity OffRamp's
  const routerInterface = lazyCached('Interface Router', () => new Interface(Router))
  const offRampInterface = getOffRampInterface(lane.version)
  const routerTopics = new Set<string>([routerInterface.getEvent('MessageExecuted')!.topicHash])
  // OffRamps have 2 ConfigSet events; to avoid having to use the typed overload of
  // interface.getEvent, we just iterate and pick the one with 2 args
  let configSetFrag!: EventFragment
  offRampInterface.forEachEvent((frag) => {
    if (frag.name === 'ConfigSet' && frag.inputs.length === 2) configSetFrag = frag
  })
  const offRampTopics = new Set<string>([
    offRampInterface.getEvent('ExecutionStateChanged')!.topicHash,
    configSetFrag.topicHash,
  ])

  const seen = new Set<string>()
  const latestBlock = await dest.getBlockNumber()

  function* interleaveBlockRanges() {
    const it1 = blockRangeGenerator({
      endBlock: latestBlock,
      startBlock: hints?.fromBlock,
    })
    if (!hints?.fromBlock) {
      yield* it1
      return
    }
    // if we receive hints.fromBlock, alternate between paging forward and backwards
    const it2 = blockRangeGenerator({
      endBlock: hints.fromBlock - 1,
    })

    let res1, res2
    do {
      if (!res1 || !res1.done) res1 = it1.next()
      if (!res1.done) yield res1.value
      if (!res2 || !res2.done) res2 = it2.next()
      if (!res2.done) yield res2.value
    } while (!res1.done || !res2.done)
  }

  for (const blockRange of interleaveBlockRanges()) {
    // we don't know our OffRamp address yet, so fetch any compatible log from OffRamps or Routers
    const logs = (
      await dest.getLogs({
        ...blockRange,
        topics: [Array.from(new Set([...offRampTopics, ...routerTopics]))],
      })
    )
      .filter(({ address }) => {
        // keep only one log per address
        if (seen.has(address)) return false
        seen.add(address)
        return true
      })
      .sort((a, b) => {
        // sort OffRamp logs before Router logs (to possibly save on the `Router.getOffRamps` call)
        if (offRampTopics.has(a.topics[0]) && routerTopics.has(b.topics[0])) return -1
        if (routerTopics.has(a.topics[0]) && offRampTopics.has(b.topics[0])) return 1
        return 0
      })
    console.debug('discoverOffRamp', { blockRange, logs, seen })

    for (const log of logs) {
      try {
        // if an offRamp log, check it directly; otherwise, check each offRamp of the router
        const offRamps = offRampTopics.has(log.topics[0])
          ? [log.address]
          : (
              await (
                new Contract(log.address, routerInterface, dest) as unknown as TypedContract<
                  typeof Router
                >
              ).getOffRamps()
            )
              .filter(({ sourceChainSelector: sel }) => sel === lane.sourceChainSelector)
              .map(({ offRamp }) => offRamp as string)
        for (const offRamp of offRamps) {
          const contract = await validateOffRamp<V>(runner, offRamp, lane)
          if (contract) {
            console.debug('Found offRamp', offRamp, 'for lane', lane)
            return contract
          }
        }
      } catch (_) {
        // passthrough to seen + continue
      }
    }
  }

  throw new Error(
    `Could not find OffRamp on "${chainNameFromSelector(lane.destChainSelector)}" for OnRamp=${lane.onRamp} on "${chainNameFromSelector(lane.sourceChainSelector)}"`,
  )
}

async function getOffRampStaticConfig(dest: ContractRunner, address: string) {
  return lazyCached(`OffRamp ${address}.staticConfig`, async () => {
    const [type_, version] = await getTypeAndVersion(dest.provider!, address)
    if (type_ != CCIPContractTypeOffRamp)
      throw new Error(`Not an OffRamp: ${address} is "${type_} ${version}"`)
    const offRampContract = new Contract(
      address,
      getOffRampInterface(version),
      dest,
    ) as unknown as TypedContract<(typeof CCIP_ABIs)[CCIPContractTypeOffRamp][typeof version]>
    const staticConfig = await offRampContract.getStaticConfig()
    return [staticConfig, offRampContract] as const
  })
}

function getOffRampInterface(version: CCIPVersion): Interface {
  return lazyCached(
    `Interface ${CCIPContractTypeOffRamp} ${version}`,
    () => new Interface(CCIP_ABIs[CCIPContractTypeOffRamp][version]),
  )
}

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
  requests: readonly Omit<CCIPRequest, 'tx' | 'timestamp'>[],
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
    const topic0s = new Set(
      requests.map(({ lane }) => {
        const offRampInterface = getOffRampInterface(lane.version)
        return offRampInterface.getEvent('ExecutionStateChanged')!.topicHash
      }),
    )

    // we don't know our OffRamp address yet, so fetch any compatible log
    const logs = await dest.getLogs({
      ...blockRange,
      ...(addressFilter.size ? { address: Array.from(addressFilter) } : {}),
      // ExecutionStateChanged v1.2-v1.5 (at least) has messageId as indexed topic2
      topics: [Array.from(topic0s), null, requests.map(({ message }) => message.messageId)],
    })
    if (onlyLast) logs.reverse()
    console.debug('fetchExecutionReceipts: found', logs.length, 'logs in', blockRange)

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

          const offRampInterface = getOffRampInterface(request.lane.version)
          const decoded = offRampInterface.parseLog(log)
          if (!decoded) continue

          const receipt = Object.assign(decoded.args.toObject(), {
            state: Number(decoded.args.state),
          }) as ExecutionReceipt
          if (
            receipt.messageId !== request.message.messageId ||
            messageIdsCompleted.has(receipt.messageId)
          )
            continue
          // onlyLast if we're paging blockRanges backwards, or if receipt.state is success (last state)
          if (onlyLast || receipt.state === ExecutionState.Success) {
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
