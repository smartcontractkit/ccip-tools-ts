import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import { JsonRpcProvider, Wallet } from 'ethers'
import { anvil } from 'prool/instances'

import { CCIPRpcNotFoundError, CCIPTransactionNotFoundError } from '../errors/index.ts'
import { calculateManualExecProof, discoverOffRamp, execute } from '../execution.ts'
import { type ExecutionReport, ExecutionState } from '../types.ts'
import { EVMChain } from './index.ts'

const FUJI_RPC = process.env['RPC_FUJI'] || 'https://avalanche-fuji-c-chain-rpc.publicnode.com'
const FUJI_CHAIN_ID = 43113

const SEPOLIA_RPC = process.env['RPC_SEPOLIA'] || 'https://ethereum-sepolia-rpc.publicnode.com'
const SEPOLIA_CHAIN_ID = 11155111

const EXTRA_CHAIN_ID = 421614 // Arbitrum Sepolia — unrelated to the Fuji→Sepolia test lane

const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

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
  let extraInstance: ReturnType<typeof anvil> | undefined

  before(async () => {
    fujiInstance = anvil({ forkUrl: FUJI_RPC, chainId: FUJI_CHAIN_ID, port: 8645 })
    sepoliaInstance = anvil({ forkUrl: SEPOLIA_RPC, chainId: SEPOLIA_CHAIN_ID, port: 8646 })
    extraInstance = anvil({ chainId: EXTRA_CHAIN_ID, port: 8647 })
    await Promise.all([fujiInstance.start(), sepoliaInstance.start(), extraInstance.start()])

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
    await Promise.all([fujiInstance?.stop(), sepoliaInstance?.stop(), extraInstance?.stop()])
  })

  it('should manually execute a failed v1.6 message (Fuji -> Sepolia)', async () => {
    const sourceTxHash = '0xccf840f3e8268ad00822458862408a642d3bbef079096cacf65a68c8f2e21bc9'
    const messageId = '0xe7b71ffcab4fc1ad029c412bb75b33a2d036b59853f08b9306cc317690a29246'

    assert.ok(source, 'source chain should be initialized')
    assert.ok(dest, 'dest chain should be initialized')

    // 1. Get source transaction and extract CCIPRequest
    const tx = await source.getTransaction(sourceTxHash)
    const requests = await source.getMessagesInTx(tx)
    const request = requests.find((r) => r.message.messageId === messageId) ?? requests[0]!
    assert.equal(request.message.messageId, messageId, 'should find the expected message')

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

    assert.equal(execution.receipt.messageId, messageId, 'receipt messageId should match')
    assert.ok(execution.log.transactionHash, 'execution log should have a transaction hash')
    assert.ok(execution.timestamp > 0, 'execution should have a positive timestamp')
    assert.ok(
      execution.receipt.state === ExecutionState.Success,
      'execution state should be Success',
    )
  })

  it('should reject when source chain RPC is missing', async () => {
    const sourceTxHash = '0xe0caad74f4981c8972dce452a20096183d3a1181217ac83c164a484876c54a65'
    const messageId = '0x31a9803ec2bf6626efad053aefff0c7087e6ed62b3875025b915f1e18d5fc437'

    assert.ok(sepoliaInstance, 'sepolia anvil instance should be initialized')

    const sepoliaUrl = `http://${sepoliaInstance.host}:${sepoliaInstance.port}`

    await assert.rejects(
      execute(
        messageId,
        sourceTxHash,
        new Wallet(ANVIL_PRIVATE_KEY),
        [sepoliaUrl], // only dest, no source
        { gasLimit: 500_000, api: false },
      ),
      (err: unknown) => err instanceof CCIPTransactionNotFoundError,
    )
  })

  it('should reject when dest chain RPC is missing', async () => {
    const sourceTxHash = '0x1642f2675e0421519cfb5012c06fbcf987c81f6a862011f952acbab05594add5'
    const messageId = '0x4fbae75737085280a8ed2c20ce94cc749c89f9dcc4aeb03a3a09cc656d2a58ed'

    assert.ok(fujiInstance, 'fuji anvil instance should be initialized')

    const fujiUrl = `http://${fujiInstance.host}:${fujiInstance.port}`

    await assert.rejects(
      execute(
        messageId,
        sourceTxHash,
        new Wallet(ANVIL_PRIVATE_KEY),
        [fujiUrl], // only source, no dest
        { gasLimit: 500_000, api: false },
      ),
      (err: unknown) => err instanceof CCIPRpcNotFoundError,
    )
  })

  it('should execute via execute() with extra unrelated chain RPCs (Fuji -> Sepolia)', async () => {
    const sourceTxHash = '0x3beb2b516cf3bdb9d92ab6af6c71bf2ce8d7653284467c73064b39719f9f577b'
    const messageId = '0x7f6156b7bfb323c7b43a107dc5db1506d3db2d18e303a5a8e8f8a2935fb6d8d3'

    assert.ok(fujiInstance, 'fuji anvil instance should be initialized')
    assert.ok(sepoliaInstance, 'sepolia anvil instance should be initialized')
    assert.ok(extraInstance, 'extra anvil instance should be initialized')

    const fujiUrl = `http://${fujiInstance.host}:${fujiInstance.port}`
    const sepoliaUrl = `http://${sepoliaInstance.host}:${sepoliaInstance.port}`
    const extraUrl = `http://${extraInstance.host}:${extraInstance.port}`

    // Pass an extra RPC (Arbitrum Sepolia) that is unrelated to the Fuji→Sepolia lane;
    // discoverChains should discover it but not use it, and execution should succeed.
    // Use api: false to test RPC-only path (API is tested separately below)
    const execution = await execute(
      messageId,
      sourceTxHash,
      new Wallet(ANVIL_PRIVATE_KEY),
      [extraUrl, fujiUrl, sepoliaUrl],
      { gasLimit: 500_000, api: false },
    )

    assert.equal(execution.receipt.messageId, messageId, 'receipt messageId should match')
    assert.ok(execution.log.transactionHash, 'execution log should have a transaction hash')
    assert.ok(execution.timestamp > 0, 'execution should have a positive timestamp')
    assert.ok(
      execution.receipt.state === ExecutionState.Success,
      'execution state should be Success',
    )
  })

  describe('execute() API integration', () => {
    const STAGING_API_URL = 'https://api.ccip.cldev.cloud'

    it('should execute via API path (Fuji -> Sepolia)', async () => {
      const sourceTxHash = '0x487a96a7e970325c43eb035668cb1eab057ebe71eb6e815644cc13cd368b67a1'
      const messageId = '0xdeef1b4474b45145e95864e9ba8e9323b3093bd484e6fc6dd68bd44a8ae7589b'

      assert.ok(fujiInstance, 'fuji anvil instance should be initialized')
      assert.ok(sepoliaInstance, 'sepolia anvil instance should be initialized')

      const fujiUrl = `http://${fujiInstance.host}:${fujiInstance.port}`
      const sepoliaUrl = `http://${sepoliaInstance.host}:${sepoliaInstance.port}`

      // Execute using staging API to fetch execution inputs
      const execution = await execute(
        messageId,
        sourceTxHash,
        new Wallet(ANVIL_PRIVATE_KEY),
        [fujiUrl, sepoliaUrl],
        {
          gasLimit: 500_000,
          apiUrlOverride: STAGING_API_URL,
        },
      )

      assert.equal(execution.receipt.messageId, messageId, 'receipt messageId should match')
      assert.ok(execution.log.transactionHash, 'execution log should have a transaction hash')
      assert.ok(execution.timestamp > 0, 'execution should have a positive timestamp')
      assert.ok(
        execution.receipt.state === ExecutionState.Success,
        'execution state should be Success',
      )
    })

    it('should execute via RPC path when api: false (Fuji -> Sepolia)', async () => {
      const sourceTxHash = '0x75e717fd080fb9b921e42182fac2b80b209512aeb81d6c5ab06cb93fcd94971f'
      const messageId = '0x54045a6816c0124d21a7aad34ec5cf683dee5c4482535c647377b410900cac5a'

      assert.ok(fujiInstance, 'fuji anvil instance should be initialized')
      assert.ok(sepoliaInstance, 'sepolia anvil instance should be initialized')

      const fujiUrl = `http://${fujiInstance.host}:${fujiInstance.port}`
      const sepoliaUrl = `http://${sepoliaInstance.host}:${sepoliaInstance.port}`

      // Execute using RPC-only path (API disabled)
      const execution = await execute(
        messageId,
        sourceTxHash,
        new Wallet(ANVIL_PRIVATE_KEY),
        [fujiUrl, sepoliaUrl],
        {
          gasLimit: 500_000,
          api: false,
        },
      )

      assert.equal(execution.receipt.messageId, messageId, 'receipt messageId should match')
      assert.ok(execution.log.transactionHash, 'execution log should have a transaction hash')
      assert.ok(execution.timestamp > 0, 'execution should have a positive timestamp')
      assert.ok(
        execution.receipt.state === ExecutionState.Success,
        'execution state should be Success',
      )
    })
  })
})
