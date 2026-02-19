import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import { JsonRpcProvider, Wallet } from 'ethers'
import { anvil } from 'prool/instances'

import { calculateManualExecProof, discoverOffRamp, execute } from '../execution.ts'
import { type ExecutionReport, ExecutionState } from '../types.ts'
import { EVMChain } from './index.ts'

const FUJI_RPC = process.env['RPC_FUJI'] || 'https://avalanche-fuji-c-chain-rpc.publicnode.com'
const FUJI_CHAIN_ID = 43113

const SEPOLIA_RPC = process.env['RPC_SEPOLIA'] || 'https://ethereum-sepolia-rpc.publicnode.com'
const SEPOLIA_CHAIN_ID = 11155111

const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// Known message stuck in FAILED state on sepolia, sent from fuji (v1.6)
const SOURCE_TX_HASH = '0xccf840f3e8268ad00822458862408a642d3bbef079096cacf65a68c8f2e21bc9'
const MESSAGE_ID = '0xe7b71ffcab4fc1ad029c412bb75b33a2d036b59853f08b9306cc317690a29246'

// Second known message: gasLimit: 0, readyForManualExecution, no token transfers (v1.6)
const SOURCE_TX_HASH_2 = '0xe0caad74f4981c8972dce452a20096183d3a1181217ac83c164a484876c54a65'
const MESSAGE_ID_2 = '0x31a9803ec2bf6626efad053aefff0c7087e6ed62b3875025b915f1e18d5fc437'

function isAnvilAvailable(): boolean {
  try {
    execSync('anvil --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const skip = !!process.env.SKIP_INTEGRATION_TESTS || !isAnvilAvailable()

describe('executeReport - Anvil Fork Tests', { skip, timeout: 180_000 }, () => {
  let source: EVMChain | undefined
  let dest: EVMChain | undefined
  let wallet: Wallet
  let fujiInstance: ReturnType<typeof anvil> | undefined
  let sepoliaInstance: ReturnType<typeof anvil> | undefined

  before(async () => {
    fujiInstance = anvil({ forkUrl: FUJI_RPC, chainId: FUJI_CHAIN_ID, port: 8645 })
    sepoliaInstance = anvil({ forkUrl: SEPOLIA_RPC, chainId: SEPOLIA_CHAIN_ID, port: 8646 })
    await Promise.all([fujiInstance.start(), sepoliaInstance.start()])

    const fujiProvider = new JsonRpcProvider(`http://${fujiInstance.host}:${fujiInstance.port}`)
    const sepoliaProvider = new JsonRpcProvider(
      `http://${sepoliaInstance.host}:${sepoliaInstance.port}`,
    )

    source = await EVMChain.fromProvider(fujiProvider, { apiClient: null })
    dest = await EVMChain.fromProvider(sepoliaProvider, { apiClient: null })
    wallet = new Wallet(ANVIL_PRIVATE_KEY, sepoliaProvider)
  })

  after(async () => {
    source?.destroy?.()
    dest?.destroy?.()
    await Promise.all([fujiInstance?.stop(), sepoliaInstance?.stop()])
  })

  it('should manually execute a failed v1.6 message (Fuji -> Sepolia)', async () => {
    assert.ok(source, 'source chain should be initialized')
    assert.ok(dest, 'dest chain should be initialized')

    // 1. Get source transaction and extract CCIPRequest
    const tx = await source.getTransaction(SOURCE_TX_HASH)
    const requests = await source.getMessagesInTx(tx)
    const request = requests.find((r) => r.message.messageId === MESSAGE_ID) ?? requests[0]!
    assert.equal(request.message.messageId, MESSAGE_ID, 'should find the expected message')

    // 2. Discover OffRamp on destination chain
    const offRamp = await discoverOffRamp(source, dest, request.lane.onRamp, source)
    assert.ok(offRamp, 'offRamp should be discovered')

    // 3. Get commit store and commit report
    const commitStore = await dest.getCommitStoreForOffRamp(offRamp)
    const commit = await dest.getVerifications({ commitStore, request })
    assert.ok('report' in commit, 'commit should have an onchain report')
    assert.ok(commit.report.merkleRoot, 'commit should have a merkle root')

    // 4. Get all messages in the commit batch from source
    const messagesInBatch = await source.getMessagesInBatch(request, commit.report)

    // 5. Calculate manual execution proof
    const execReportProof = calculateManualExecProof(
      messagesInBatch,
      request.lane,
      request.message.messageId,
      commit.report.merkleRoot,
      dest,
    )

    // 6. Get offchain token data
    const offchainTokenData = await source.getOffchainTokenData(request)

    // 7. Build execution report and execute
    const execReport: ExecutionReport = {
      ...execReportProof,
      message: request.message,
      offchainTokenData,
    }
    const execution = await dest.executeReport({
      offRamp,
      execReport,
      wallet,
      gasLimit: 500_000,
    })

    assert.equal(execution.receipt.messageId, MESSAGE_ID, 'receipt messageId should match')
    assert.ok(execution.log.transactionHash, 'execution log should have a transaction hash')
    assert.ok(execution.timestamp > 0, 'execution should have a positive timestamp')
    assert.ok(
      execution.receipt.state === ExecutionState.Success,
      'execution state should be Success',
    )
  })

  it('should execute a failed v1.6 message via execute() (Fuji -> Sepolia)', async () => {
    assert.ok(fujiInstance, 'fuji anvil instance should be initialized')
    assert.ok(sepoliaInstance, 'sepolia anvil instance should be initialized')

    const fujiUrl = `http://${fujiInstance.host}:${fujiInstance.port}`
    const sepoliaUrl = `http://${sepoliaInstance.host}:${sepoliaInstance.port}`

    const execution = await execute({
      rpcs: [fujiUrl, sepoliaUrl],
      txHash: SOURCE_TX_HASH_2,
      messageId: MESSAGE_ID_2,
      wallet: new Wallet(ANVIL_PRIVATE_KEY),
      gasLimit: 500_000,
    })

    assert.equal(execution.receipt.messageId, MESSAGE_ID_2, 'receipt messageId should match')
    assert.ok(execution.log.transactionHash, 'execution log should have a transaction hash')
    assert.ok(execution.timestamp > 0, 'execution should have a positive timestamp')
    assert.ok(
      execution.receipt.state === ExecutionState.Success,
      'execution state should be Success',
    )
  })
})
