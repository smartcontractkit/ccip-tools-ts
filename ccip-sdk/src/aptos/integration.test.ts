import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

// Register every chain family the way SDK consumers do via the package root
import '../index.ts'
import { rpcEndpoint } from '../../../scripts/test-endpoints.ts'
import { useResource } from '../../../scripts/useResource.ts'
import { type ChainLog, ExecutionState } from '../types.ts'
import { AptosChain } from './index.ts'

// Live RPC: aptos-testnet. Fullnodes prune older txs/events; the archival
// endpoint retains them, so it is the single default. The indexer GraphQL
// defaults to the network's official endpoint. Override via RPC_APTOS_TESTNET.
await useResource(['aptos-testnet'])
const APTOS_RPC = rpcEndpoint('RPC_APTOS_TESTNET')

const skip = !!process.env.SKIP_INTEGRATION_TESTS

describe('Aptos failed execution detection integration (aptos-testnet)', { skip }, () => {
  // A live FAILED execution (ethereum-testnet-sepolia → aptos-testnet, seq 138):
  // the OffRamp ran out of gas (vmStatus EXECUTION_LIMIT_REACHED), so the tx
  // carries no ExecutionStateChanged event — the receipt is reconstructed from
  // the failed transaction's BCS ExecutionReport + VM status.
  const FAILED_TX = '0xb44743a78efbf929c571058d5e300b74dc46304b48975960a8d3584cb7425349'
  const FAILED_VERSION = 8_670_099_586
  const FAILED_MESSAGE_ID = '0x861809896b597ee0f1ae8a64b81cc40925690a8b97abdb07379f605d8973cd72'
  const FAILED_SEQUENCE = 138n
  const SEPOLIA_SELECTOR = 16015286601757825753n
  const DEST_CHAIN_SELECTOR = 743186221051783445n // aptos-testnet, from the report
  const OFFRAMP = '0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45::offramp'
  // ~100 versions around the failure, so the merged stream picks it up
  const FAILURE_RANGE = {
    startBlock: 8_670_099_486,
    endBlock: 8_670_099_686,
  }

  let chain: AptosChain
  before(async () => {
    chain = await AptosChain.fromUrl(APTOS_RPC)
  })

  it('getTransaction reconstructs the failed receipt with the VM status', async () => {
    const tx = await chain.getTransaction(FAILED_VERSION)
    assert.equal(tx.blockNumber, FAILED_VERSION)
    assert.ok(tx.logs.length >= 1)
    const failure = tx.logs.find((log) => log.topics[0] === 'ExecutionStateChanged')
    assert.ok(failure, 'the failed execute tx carries a synthetic failure log')
    assert.equal(failure.index, 0)
    // the OffRamp's bare address — the same form real event logs carry
    assert.equal(failure.address, OFFRAMP)
    assert.equal(
      failure.transactionHash,
      FAILED_TX,
      'the synthetic log carries the failed transaction hash',
    )
    const receipt = AptosChain.decodeReceipt(failure)
    assert.ok(receipt)
    assert.equal(receipt.state, ExecutionState.Failed)
    assert.equal(receipt.messageId, FAILED_MESSAGE_ID)
    assert.equal(receipt.sequenceNumber, FAILED_SEQUENCE)
    assert.equal(receipt.sourceChainSelector, SEPOLIA_SELECTOR)
    assert.ok(receipt.returnData, 'the VM failure is decoded into returnData')
    assert.equal(
      (receipt.returnData as Record<string, unknown>).vmStatus,
      'EXECUTION_LIMIT_REACHED',
    )
    // every consumer surface agrees on the decoded failure
    assert.deepEqual(tx.error, receipt.returnData)
  })

  it('getLogs merges the failed execution into ExecutionStateChanged streams over a bounded range', async () => {
    const logs: ChainLog[] = []
    for await (const log of chain.getLogs({
      address: OFFRAMP,
      topics: ['ExecutionStateChanged'],
      ...FAILURE_RANGE,
    })) {
      logs.push(log)
    }
    assert.ok(logs.length >= 1, 'the failure inside the window is picked up')

    // the failed message surfaces as a synthetic state=3 log merged into the
    // ascending stream (the failure scan stamps the caller's address form)
    const failures = logs.filter(
      (log) => (log.data as { state?: number }).state === ExecutionState.Failed,
    )
    assert.equal(failures.length, 1, 'exactly the one failed execution in the window')
    const failure = failures[0]!
    assert.equal(failure.transactionHash, FAILED_TX)
    assert.equal(failure.index, 0, 'synthetic failures use uint-friendly index 0')
    assert.equal(failure.address, OFFRAMP)
    assert.equal(failure.blockNumber, FAILED_VERSION)
    const receipt = AptosChain.decodeReceipt(failure)
    assert.ok(receipt)
    assert.equal(receipt.messageId, FAILED_MESSAGE_ID)
    assert.equal(receipt.sequenceNumber, FAILED_SEQUENCE)
    assert.equal(receipt.sourceChainSelector, SEPOLIA_SELECTOR)
    assert.equal(receipt.state, ExecutionState.Failed)
    assert.equal(
      (receipt.returnData as Record<string, unknown>).vmStatus,
      'EXECUTION_LIMIT_REACHED',
    )

    // the merged stream stays globally ascending (block, then log index)
    for (let i = 1; i < logs.length; i++)
      assert.ok(
        logs[i]!.blockNumber >= logs[i - 1]!.blockNumber,
        `log ${i} must not precede its predecessor`,
      )
    // dedupe keys stay unique across both sources
    const keys = new Set(logs.map((log) => `${log.transactionHash}:${log.index}`))
    assert.equal(logs.length, logs.length && keys.size)
  })

  it('getExecutionReceipts reconstructs the failed receipt with the decoded VM error', async () => {
    const executions = []
    for await (const execution of chain.getExecutionReceipts({
      offRamp: OFFRAMP,
      messageId: FAILED_MESSAGE_ID,
      sourceChainSelector: SEPOLIA_SELECTOR,
      sequenceNumber: FAILED_SEQUENCE,
      startBlock: FAILED_VERSION - 100,
    })) {
      executions.push(execution)
    }
    // the message failed exactly once on-chain, inside the scanned window
    assert.equal(executions.length, 1, 'exactly the failed receipt is picked up by the scan')
    const { receipt, log, error } = executions[0]!
    assert.equal(receipt.state, ExecutionState.Failed)
    assert.equal(receipt.messageId, FAILED_MESSAGE_ID)
    assert.equal(receipt.sequenceNumber, FAILED_SEQUENCE)
    assert.equal(receipt.sourceChainSelector, SEPOLIA_SELECTOR)
    assert.equal(receipt.gasUsed, 9250n)
    assert.equal(error!.vmStatus, 'EXECUTION_LIMIT_REACHED')
    assert.equal(error!.function, `${OFFRAMP}::execute`)
    assert.equal(error!.destChainSelector, DEST_CHAIN_SELECTOR)
    // the log surfaces with the caller's offRamp form, at the failed version
    assert.equal(log.address, OFFRAMP)
    assert.equal(log.blockNumber, FAILED_VERSION)
  })
})
