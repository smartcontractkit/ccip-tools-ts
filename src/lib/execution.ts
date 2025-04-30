import {
  type ContractRunner,
  type EventFragment,
  type Provider,
  Contract,
  Interface,
  toBeHex,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import Router from '../abi/Router.ts'
import { Tree, getLeafHasher, proofFlagsToBits } from './hasher/index.ts'
import {
  type CCIPContract,
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type ExecutionReceipt,
  type Lane,
  CCIPContractType,
  CCIPVersion,
  CCIP_ABIs,
  ExecutionState,
} from './types.ts'
import {
  blockRangeGenerator,
  chainNameFromSelector,
  decodeAddress,
  getContractProperties,
  lazyCached,
  networkInfo,
  toObject,
  validateContractType,
} from './utils.ts'

/**
 * Pure/sync function to calculate/generate OffRamp.executeManually report for messageIds
 *
 * @param messagesInBatch - Array containing all messages in batch, ordered
 * @param lane - Arguments for leafeHasher (lane info)
 * @param messageIds - list of messages (from batch) to prove for manual execution
 * @param merkleRoot - Optional merkleRoot of the CommitReport, for validation
 * @returns ManualExec report arguments
 **/
export function calculateManualExecProof<V extends CCIPVersion = CCIPVersion>(
  messagesInBatch: readonly CCIPMessage<V>[],
  lane: Lane<V>,
  messageIds: string[],
  merkleRoot?: string,
): {
  messages: CCIPMessage<V>[]
  proofs: string[]
  proofFlagBits: bigint
} {
  const leaves: string[] = []
  const hasher = getLeafHasher(lane)
  const prove: number[] = []
  const messages: CCIPMessage<V>[] = []
  const seen = new Set<string>()

  messagesInBatch.forEach((message, index) => {
    const msg = { ...message, tokenAmounts: message.tokenAmounts.map((ta) => ({ ...ta })) }
    // Hash leaf node
    leaves.push(hasher(msg))
    seen.add(message.header.messageId)
    // Find the proving leaf index with the matching sequence number
    if (messageIds.includes(message.header.messageId)) {
      messages.push(msg)
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

/**
 * Validates the provided address belongs to an OffRamp for given lane
 * @param runner - ContractRunner/Provider to use
 * @param address - OffRamp contract address
 * @param lane - Lane to validate OffRamp for
 * @returns Typed OffRamp contract, if compatible, or undefined otherwise
 **/
export async function validateOffRamp<V extends CCIPVersion>(
  runner: ContractRunner,
  address: string,
  lane: Lane<V>,
): Promise<CCIPContract<typeof CCIPContractType.OffRamp, V> | undefined> {
  const [version] = await validateContractType(runner.provider!, address, CCIPContractType.OffRamp)
  if (version !== lane.version) return

  const offRampContract = new Contract(
    address,
    getOffRampInterface(version),
    runner,
  ) as unknown as CCIPContract<typeof CCIPContractType.OffRamp, typeof version>

  let sourceChainSelector, onRamp
  if (lane.version < CCIPVersion.V1_6) {
    const [staticConfig] = await getOffRampStaticConfig(runner, address)
    if (!('sourceChainSelector' in staticConfig)) return
    sourceChainSelector = staticConfig.sourceChainSelector
    onRamp = staticConfig.onRamp
  } else {
    const sourceConfig = await lazyCached(
      `OffRamp ${address}.sourceConfig(${lane.sourceChainSelector})`,
      async () => {
        return toObject(await offRampContract.getSourceChainConfig(lane.sourceChainSelector))
      },
    )
    sourceChainSelector = lane.sourceChainSelector
    onRamp = decodeAddress(sourceConfig.onRamp, networkInfo(sourceChainSelector).family)
  }

  if (lane.sourceChainSelector === sourceChainSelector && lane.onRamp === onRamp) {
    return offRampContract as unknown as CCIPContract<typeof CCIPContractType.OffRamp, V>
  }
}

/**
 * Discover an OffRamp for a given lane (source, dest, onRamp)
 * It paginates on dest chain's logs, looking for OffRamp's ExecutionStateChanged events or
 * Router's MessageExecuted events, and validates the OffRamp belongs to the given lane.
 *
 * @param runner - Dest ContractRunner/Provider to use
 * @param lane - Lane to discover OffRamp for
 * @param hints.fromBlock - A block from where to start paging forward; otherwise, pages backwards
 *   from latest
 * @param hints.page - getLogs pagination range param
 * @returns Typed OffRamp contract
 **/
export async function discoverOffRamp<V extends CCIPVersion>(
  runner: ContractRunner,
  lane: Lane<V>,
  hints?: { fromBlock?: number; page?: number },
): Promise<CCIPContract<typeof CCIPContractType.OffRamp, V>> {
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
    if (
      (frag.name === 'ConfigSet' && frag.inputs.length === 2) ||
      frag.name === 'SourceChainConfigSet'
    )
      configSetFrag = frag
  })
  const offRampTopics = new Set<string>([
    offRampInterface.getEvent('ExecutionStateChanged')!.topicHash,
    configSetFrag.topicHash,
  ])

  const seen = new Set<string>()
  const latestBlock = await dest.getBlockNumber()

  function* interleaveBlockRanges() {
    const it1 = blockRangeGenerator(
      { endBlock: latestBlock, startBlock: hints?.fromBlock },
      hints?.page,
    )
    if (!hints?.fromBlock) {
      yield* it1
      return
    }
    // if we receive hints.fromBlock, alternate between paging forward and backwards
    const it2 = blockRangeGenerator({ endBlock: hints.fromBlock - 1 }, hints.page)

    let res1, res2
    do {
      if (!res1?.done) res1 = it1.next()
      if (!res1.done) yield res1.value
      if (!res2?.done) res2 = it2.next()
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
    console.debug('discoverOffRamp', { blockRange, logs, seen, offRampTopics, routerTopics })

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
  const [version] = await validateContractType(dest.provider!, address, CCIPContractType.OffRamp)
  const offRampContract = new Contract(
    address,
    getOffRampInterface(version),
    dest,
  ) as unknown as CCIPContract<typeof CCIPContractType.OffRamp, typeof version>
  const [staticConfig] = await getContractProperties(offRampContract, 'getStaticConfig')
  return [toObject(staticConfig), offRampContract] as const
}

function getOffRampInterface(version: CCIPVersion): Interface {
  return lazyCached(
    `Interface ${CCIPContractType.OffRamp} ${version}`,
    () => new Interface(CCIP_ABIs[CCIPContractType.OffRamp][version]),
  )
}

/**
 * Fetch ExecutionReceipts for given requests
 * If more than one request is given, may yield them interleaved
 * Completes as soon as there's no more work to be done
 * 2 possible behaviors:
 * - if `hints.fromBlock` is given, pages forward from that block up;
 *   completes when success (final) receipt is found for all requests (or reach latest)
 * - otherwise, pages backwards and returns only the most recent receipt per request;
 *   completes when receipts for all requests were seen
 *
 * @param dest - provider to page through
 * @param requests - CCIP requests to search executions for
 * @param hints.fromBlock - A block from where to start paging forward;
 *  otherwise, page backwards and completes on first (most recent) receipt
 * @param hints.page - getLogs pagination range param
 **/
export async function* fetchExecutionReceipts(
  dest: Provider,
  requests: readonly Omit<CCIPRequest, 'tx' | 'timestamp'>[],
  hints?: { fromBlock?: number; page?: number },
): AsyncGenerator<CCIPExecution, void, unknown> {
  const onlyLast = !hints?.fromBlock // backwards
  const latestBlock = await dest.getBlockNumber()

  const onrampToOfframp = new Map<string, string>()
  const messageIdsCompleted = new Set<string>()
  for (const blockRange of blockRangeGenerator(
    { endBlock: latestBlock, startBlock: hints?.fromBlock },
    hints?.page,
  )) {
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
    const topics: (null | string[])[] = [Array.from(topic0s)]
    if (requests.every(({ lane }) => lane.version < CCIPVersion.V1_6)) {
      // ExecutionStateChanged v1.2-v1.5 has messageId as indexed topic2
      topics.push(
        null,
        requests.map(
          ({ message }) =>
            (message as CCIPMessage<typeof CCIPVersion.V1_2 | typeof CCIPVersion.V1_5>).messageId,
        ),
      )
    } else if (requests.every(({ lane }) => lane.version >= CCIPVersion.V1_6)) {
      // ExecutionStateChanged v1.6 has sourceChainSelector as indexed topic1, messageId as indexed topic3
      topics.push(
        Array.from(
          new Set(
            requests.map(({ message }) =>
              toBeHex(
                (message as CCIPMessage<typeof CCIPVersion.V1_6>).header.sourceChainSelector,
                32,
              ),
            ),
          ),
        ),
        null,
        requests.map(
          ({ message }) => (message as CCIPMessage<typeof CCIPVersion.V1_6>).header.messageId,
        ),
      )
    }

    // we don't know our OffRamp address yet, so fetch any compatible log
    const logs = await dest.getLogs({
      ...blockRange,
      ...(addressFilter.size ? { address: Array.from(addressFilter) } : {}),
      topics,
    })
    if (onlyLast) logs.reverse()
    console.debug('fetchExecutionReceipts: found', logs.length, 'logs in', blockRange)

    let lastLogBlock: readonly [block: number, timestamp: number] | undefined
    for (const log of logs) {
      try {
        const [version] = await validateContractType(dest, log.address, CCIPContractType.OffRamp)

        const offRampInterface = getOffRampInterface(version)
        const decoded = offRampInterface.parseLog(log)
        if (!decoded) continue

        const receipt = Object.assign(decoded.args.toObject(), {
          state: Number(decoded.args.state),
        }) as ExecutionReceipt

        let sourceChainSelector
        if (version === CCIPVersion.V1_2 || version === CCIPVersion.V1_5) {
          const [staticConfig] = await getOffRampStaticConfig(dest, log.address)
          if ('sourceChainSelector' in staticConfig)
            sourceChainSelector = staticConfig.sourceChainSelector
        } else {
          sourceChainSelector = receipt.sourceChainSelector!
        }

        for (const request of requests) {
          // reject if it's not an OffRamp for our onRamp
          if (
            request.lane.sourceChainSelector !== sourceChainSelector
            // || request.log.address !== staticConfig.onRamp
          )
            continue
          onrampToOfframp.set(request.log.address, log.address) // found an offramp of interest!

          if (
            receipt.messageId !== request.message.header.messageId ||
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
    requests = requests.filter(({ message }) => !messageIdsCompleted.has(message.header.messageId))
    // all messages were seen (if onlyLast) or completed (state==success)
    if (!requests.length) break
  }
}
