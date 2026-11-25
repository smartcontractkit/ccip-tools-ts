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

// Fixtures of the aptos-testnet CCIP 2.0.0 development deployment: refresh them after a redeploy.
const SEPOLIA_SELECTOR = 16015286601757825753n
const APTOS_SELECTOR = 743186221051783445n
// OffRamp 2.0.0: its module (the address of its logs), and its state address (the OffRamp's own
// address, as remote chains and messages use)
const OFFRAMP = '0xc02937630416456dbd9ca4b54d186e213f1f25f8ec57d4dc592ab778c56620f3::offramp'
const OFFRAMP_STATE = '0x62f92b897b1bd2351a59a229ac895f95909d621ab22e12ac71a7b62792dd7d86'
// OnRamp 2.0.0 state address
const ONRAMP = '0x21cb562592180cdf573cd142dd96321bd47d78f32e34ea277725cee9a23b97a1'

describe('Aptos failed execution detection integration (aptos-testnet)', { skip }, () => {
  // A live FAILED 2.0 execution (ethereum-testnet-sepolia → aptos-testnet, message number 4):
  // the OffRamp's `execute` aborted in 0x1::from_bcs, so the tx carries no
  // ExecutionStateChanged event — the receipt is reconstructed from the failed
  // transaction's encoded message + VM status. The message is still not executed.
  const FAILED_TX = '0x1d1f6b81c0735823a3460d80abba1e22c0183e5132860d62d458b201cb506634'
  const FAILED_VERSION = 466_258_314
  const FAILED_MESSAGE_ID = '0xbad01a1fffff9ceb45ff179dbd3dfad56c239c4487d61731fedc0cf36ee0db6b'
  const FAILED_SEQUENCE = 4n
  const VM_STATUS_RE = /^Move abort in 0x1::from_bcs: EINVALID_UTF8\(0x10001\)/
  // ~100 versions around the failure, so the merged stream picks it up
  const FAILURE_RANGE = {
    startBlock: FAILED_VERSION - 100,
    endBlock: FAILED_VERSION + 100,
  }

  /** The decoded Move abort every consumer surface reports for this failure. */
  function assertVmFailure(returnData: unknown) {
    const data = returnData as Record<string, unknown>
    assert.match(data.vmStatus as string, VM_STATUS_RE)
    assert.equal(data.location, '0x1::from_bcs')
    assert.equal(data.abortCode, 65537n)
    assert.equal(data.abortName, 'EINVALID_UTF8')
    assert.equal(data.function, `${OFFRAMP}::execute`)
    assert.equal(data.destChainSelector, APTOS_SELECTOR)
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
    // the OffRamp's `<package>::offramp` — the same form real event logs carry
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
    assertVmFailure(receipt.returnData)
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
    assertVmFailure(receipt.returnData)

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
    // the message failed exactly once on-chain, and was never executed since
    assert.equal(executions.length, 1, 'exactly the failed receipt is picked up by the scan')
    const { receipt, log, error } = executions[0]!
    assert.equal(receipt.state, ExecutionState.Failed)
    assert.equal(receipt.messageId, FAILED_MESSAGE_ID)
    assert.equal(receipt.sequenceNumber, FAILED_SEQUENCE)
    assert.equal(receipt.sourceChainSelector, SEPOLIA_SELECTOR)
    assert.equal(receipt.gasUsed, 741n)
    assertVmFailure(error)
    // the log surfaces with the caller's offRamp form, at the failed version
    assert.equal(log.address, OFFRAMP)
    assert.equal(log.blockNumber, FAILED_VERSION)
    assert.equal(log.transactionHash, FAILED_TX)
  })
})

describe('Aptos 2.0 lane reads integration (aptos-testnet)', { skip }, () => {
  let chain: AptosChain
  before(async () => {
    chain = await AptosChain.fromUrl(APTOS_RPC)
  })

  it('getExecutionReceipts finds the success receipt with the OffRamp given as its state address', async () => {
    // ethereum-testnet-sepolia → aptos-testnet, message number 8, executed once
    const MESSAGE_ID = '0x6ff0adcef484c80ee36f3c5e354aadaa325a6859e9309f85089d6a7b2fc37ab8'
    const EXEC_TX = '0xd6dc368bb182d5d0bc270ada3d2774d9585de39662b7258418ae01472a3f0cc9'
    const EXEC_VERSION = 567_359_658

    const executions = []
    for await (const execution of chain.getExecutionReceipts({
      offRamp: OFFRAMP_STATE,
      messageId: MESSAGE_ID,
      sourceChainSelector: SEPOLIA_SELECTOR,
      sequenceNumber: 8n,
      startBlock: EXEC_VERSION - 100,
    })) {
      executions.push(execution)
    }
    const success = executions.filter(({ receipt }) => receipt.state === ExecutionState.Success)
    assert.equal(success.length, 1, 'exactly one success receipt')
    const { receipt, log } = success[0]!
    assert.equal(receipt.messageId, MESSAGE_ID)
    assert.equal(receipt.sequenceNumber, 8n)
    assert.equal(receipt.sourceChainSelector, SEPOLIA_SELECTOR)
    assert.equal(log.transactionHash, EXEC_TX)
    assert.equal(log.blockNumber, EXEC_VERSION)
    // the event's own module, not the state address the caller gave
    assert.equal(log.address, OFFRAMP)
  })

  it('getMessagesInTx decodes the 2.0 request of an Aptos send', async () => {
    // aptos-testnet → ethereum-testnet-sepolia, data only, message number 6
    const SEND_TX = '0x54cc3836d00da88bfa603a27428d9311dae0cebc8604d34ac6c7279f6e99b5b5'
    const MESSAGE_ID = '0x16b4714f77f31dfbe51a80cdd8c49940e2d6570a3201bed156fad3055b4127a6'

    const requests = await chain.getMessagesInTx(SEND_TX)
    assert.equal(requests.length, 1)
    const { lane, message, tx } = requests[0]!
    assert.equal(lane.version, '2.0.0')
    assert.equal(lane.sourceChainSelector, APTOS_SELECTOR)
    assert.equal(lane.destChainSelector, SEPOLIA_SELECTOR)
    assert.equal(lane.onRamp, ONRAMP)
    assert.equal(message.messageId, MESSAGE_ID)
    assert.equal((message as { sequenceNumber?: bigint }).sequenceNumber, 6n)
    assert.equal(
      (message as { sender?: string }).sender,
      '0x311cea5ace5299669444abd99fc787ddb0894e297ca0f21331aa4e0c5950ec5e',
    )
    assert.equal(
      (message as { receiver?: string }).receiver?.toLowerCase(),
      '0x1b03fb65877cdb7dabdb73e72b11ba1651ac7548',
    )
    assert.equal(tx.hash, SEND_TX)
  })

  it('reads the registry token, its 2.0 pool and the pool remote', async () => {
    const ROUTER = '0x4408fcf09ba8aba2569958fe32ae7227d96a5ecba0c6dfe978d268a929ed5ee7'
    const TOKEN = '0xea06209e4f7d5d9923144bd6bdcc992dc149a69488b6a500db4b8cb3d3e25608'
    const POOL = '0x352e096cc6d24c862d5e61d73294c473fa60feef785938890ad71d20b2c7653c'

    const registry = await chain.getTokenAdminRegistryFor(ROUTER)
    assert.ok((await chain.getSupportedTokens(registry)).includes(TOKEN))
    assert.equal((await chain.getRegistryTokenConfig(registry, TOKEN)).tokenPool, POOL)
    const pool = await chain.getTokenPoolConfig(POOL)
    assert.equal(pool.token, TOKEN)
    assert.equal(pool.typeAndVersion, 'ManagedTokenPool 2.0.0')
    const remote = (await chain.getTokenPoolRemotes(POOL, SEPOLIA_SELECTOR))[
      'ethereum-testnet-sepolia'
    ]
    assert.ok(remote, 'the pool has a Sepolia remote')
    assert.equal(remote.remoteToken, '0xCE009F314E8c1f3bE6C36d0365B466dB4386ED50')
    assert.deepEqual(remote.remotePools, ['0x9388C0436D77112C49c94CAd913B918DBb40CC15'])
  })
})
