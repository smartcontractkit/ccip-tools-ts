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

const BASE_SEPOLIA_RPC =
  process.env['RPC_BASE_SEPOLIA'] || 'https://base-sepolia-rpc.publicnode.com'
const BASE_SEPOLIA_CHAIN_ID = 84532

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
  let baseSepoliaInstance: ReturnType<typeof anvil> | undefined
  let extraInstance: ReturnType<typeof anvil> | undefined

  before(async () => {
    fujiInstance = anvil({ forkUrl: FUJI_RPC, chainId: FUJI_CHAIN_ID, port: 8645 })
    sepoliaInstance = anvil({ forkUrl: SEPOLIA_RPC, chainId: SEPOLIA_CHAIN_ID, port: 8646 })
    baseSepoliaInstance = anvil({
      forkUrl: BASE_SEPOLIA_RPC,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      port: 8648,
    })
    extraInstance = anvil({ chainId: EXTRA_CHAIN_ID, port: 8647 })
    await Promise.all([
      fujiInstance.start(),
      sepoliaInstance.start(),
      baseSepoliaInstance.start(),
      extraInstance.start(),
    ])

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
    await Promise.all([
      fujiInstance?.stop(),
      sepoliaInstance?.stop(),
      baseSepoliaInstance?.stop(),
      extraInstance?.stop(),
    ])
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
    const verifications = await dest.getVerifications({ commitStore, request })
    assert.ok('report' in verifications, 'commit should have an onchain report')
    assert.ok(verifications.report.merkleRoot, 'commit should have a merkle root')

    // 4. Get all messages in the commit batch from source
    const messagesInBatch = await source.getMessagesInBatch(request, verifications.report)

    // 5. Calculate manual execution proof
    const execReportProof = calculateManualExecProof(
      messagesInBatch,
      request.lane,
      request.message.messageId,
      verifications.report.merkleRoot,
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

  it('should execute a v2.0 message that originally failed (Sepolia -> Fuji)', async () => {
    const messageId = '0xa7bcdc5f31942e8024885fc25c375168050245370d50155b29d60301b6f53968'

    assert.ok(source, 'source (fuji) chain should be initialized')
    assert.ok(fujiInstance, 'fuji anvil instance should be initialized')

    const fujiProvider = new JsonRpcProvider(`http://${fujiInstance.host}:${fujiInstance.port}`)
    const fujiWallet = new Wallet(ANVIL_PRIVATE_KEY, fujiProvider)

    const execution = await source.executeV2Message({
      offRamp: '0x119b61664bd2c837a18b00837f88aa9a179173f8',
      encodedMessage:
        '0x01de41ba4fc9d91ad9ccf0a31a221f3c9b0000000000000010000749b00000000000015b6dbe238e41978c0a7ae4c8bfd488f2c8696256c95062188c9db7ff760cd3fc200000000000000000000000000f887309075403d02563cbcbb3d98fb2ef2d294614119b61664bd2c837a18b00837f88aa9a179173f8200000000000000000000000004f32ae7f112c26b109357785e5c66dc5d747fbce144f32ae7f112c26b109357785e5c66dc5d747fbce0000009301000000000000000000000000000000000000000000000000000000000000000120000000000000000000000000e72b27de4ee51b48848958bb20cdbcafd652e077200000000000000000000000001c7d4b196cb0c7b01d743fbc6116a902379c7238145425890298aed601595a70ab815c96711a31bc65144f32ae7f112c26b109357785e5c66dc5d747fbce00043047587c0000',
      ccvAddresses: [
        '0x997bbb1be075e6e9e7802b84c27c79e820a337a3',
        '0x7d974aae9002e40d85f2f552b080c83bfd2b979f',
      ],
      verifierResults: [
        '0x49ff34ed0180208cf7cc720d7ff545706db2fa524aa7c16117aaaddc3eed248dfaf4a02edecddca8eb3df1ca45c1419345a549d4572bbefb8a6fc817733b0a1c279b670658f9b8bfe1125c0f98b08d3e73edef37aa4f80395c0967608001cb3b86575ba5d170f0a71b4ff7d67cd3ebe7af8e3bda8d2818bba63b667859d801a8b6ec0185431e13d002fdecac93c7ff5fe66c79b132570eb5c19b7fd5ef14e7688c5731977a8212dcad222c137c34a0729238e0aa381f1dcb4d622f8d72234155e7a190acee7a9d741eaa9d94ee10ac451a81ec3043a3b981fee4e9a59bc827440335ddcdc2c5d6d5538f8bdbdfcf25ec6c7bea2c16340daa7a667c3136fe0ef799c43d479070b305b92db7d67dc362af70ba9ac3e23f760ff3ce39a929bff33d5ec3cd7469fcf368930e76767ad34feccc9d595c54bfb06cb0a0d31138eda85c95bc8f67cc6b3eb408d016bca0336ca46ecbe5e65490106e8e2ff77f78eec261175ab1074451bf0257ac522aef2faf38082c817d706d64c7b48250bd3e2ab2d641588c16e4f7',
        '0x8e1d1a9d000000010000000000000001b0fd224313b87ca8615e7b66a5d61e05e33e3ab97fc0961f1e41324a410f053e0000000000000000000000008fe6b999dc680ccfdd5bf7eb0974218be2542daa0000000000000000000000008fe6b999dc680ccfdd5bf7eb0974218be2542daa000000000000000000000000e23c4b54127d9a73e483a05b6978d8c0008ed817000003e8000007d0000000010000000000000000000000001c7d4b196cb0c7b01d743fbc6116a902379c72380000000000000000000000004f32ae7f112c26b109357785e5c66dc5d747fbce0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000a3ae889af2026b931a7711eb3acb54f69d071c6f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008e1d1a9da7bcdc5f31942e8024885fc25c375168050245370d50155b29d60301b6f53968d3af1a1a1ae0a3c9e7c849e396e9a90277b4729921db5f46bea1a52be6898fd010d2cc95f61254acd850d3e59f768f3a9a36459153f268a6ae00088e9a34b6061ce8eaca0938380784e9dc8391c0a497782d40c89f7abf3a767f40f008e8cb972a07ee190228f505ee170dd7ae812bbe24aa5c557ab9a963a1bd2f8242ec7cd9121c',
      ],
      wallet: fujiWallet,
    })

    assert.equal(execution.receipt.messageId, messageId, 'receipt messageId should match')
    assert.ok(execution.log.transactionHash, 'execution log should have a transaction hash')
    assert.ok(execution.timestamp > 0, 'execution should have a positive timestamp')
    assert.ok(
      execution.receipt.state === ExecutionState.Success,
      `execution state should be Success, got ${execution.receipt.state}`,
    )
  })

  it('should execute a noexec v2.0 message waiting for execution (Arbitrum Sepolia -> Base Sepolia)', async () => {
    const messageId = '0x985661989074adde4b0c45fdfa4de9c5bc4a6c1c553e93e9303b150bc514fc51'

    assert.ok(baseSepoliaInstance, 'base sepolia anvil instance should be initialized')

    const baseSepoliaProvider = new JsonRpcProvider(
      `http://${baseSepoliaInstance.host}:${baseSepoliaInstance.port}`,
    )
    const baseSepolia = await EVMChain.fromProvider(baseSepoliaProvider, { apiClient: null })
    const baseSepoliaWallet = new Wallet(ANVIL_PRIVATE_KEY, baseSepoliaProvider)

    try {
      const execution = await baseSepolia.executeV2Message({
        offRamp: '0x3039886f3e597dfd3171aa6397b709a4f68956ac',
        encodedMessage:
          '0x01304611b6affba76a8f90b8876dee6538000000000000000d00058490000000000000fc76ef6af690994784894d58b10eecf323c6140cf609ff501c1052b935fefa0520000000000000000000000000639c66c134293be91bc2263cc96f59fe5b2a143b143039886f3e597dfd3171aa6397b709a4f68956ac200000000000000000000000009d087fc03ae39b088326b67fa3c788236645b717149d087fc03ae39b088326b67fa3c788236645b717000000af0100000000000000000000000000000000000000000000000000000000000003e820000000000000000000000000c012c4cb0acb2a859e10a0ed04ffacac60ac2b2c20000000000000000000000000dd39c3e7ebaec7739a55250275ddb44b1b37230f14c82ee0dac12f2d9460d2ae0edc0789a92ac2e674149d087fc03ae39b088326b67fa3c788236645b717002000000000000000000000000000000000000000000000000000000000000000120000',
        ccvAddresses: ['0x997bbb1be075e6e9e7802b84c27c79e820a337a3'],
        verifierResults: [
          '0x49ff34ed018056590028d8a389e8109824079827e06d667b22b8271c4dfb4071cb54129bc14d883800f99e3d9108e0e656a955ac9dea4e7ad0cd82886ed2c19a0e6b9825e6ea795f765099e9928d10ae2d9cae31e93b710907efa8373c53e746c174edeb2f8bb52ba607f254f651e0d43081d07eca55fe5162c56aef6e22d8da325e799fe01e3ba606eb0fa58bc07b354d00a085fc665f1f19517563372f39b457e9e0a7e231fb687b0619e754b4fd8f95ba6a79abd9e0f6ed4db2f7d608ebf0fd36a6758a77d3394a0fd7e33432e2c8298983b24a2fa31e4db55aa1f1b15081bed43db02fc810fd800eca3bf0613fc4a61912d2d7ba8612199b643ccf0fcda002388190a259e5321fea25770cf314821716c46d13aac7a36cc0be4989e12971ca1d0eda83ec9c96ee9be84f6ed7ffbf0611ffbdf54ffecb77131b34cc5c091735fce9ffb283920a2626872fbffe9d3199e5ee0b12b541df0c1808b8762478a36d1cbcd3bd6aafd376d2359bdfe72b2288c07ade956cb1970a5dd65ca83d81cdfb94ce14e32d',
        ],
        wallet: baseSepoliaWallet,
      })

      assert.equal(execution.receipt.messageId, messageId, 'receipt messageId should match')
      assert.ok(execution.log.transactionHash, 'execution log should have a transaction hash')
      assert.ok(execution.timestamp > 0, 'execution should have a positive timestamp')
      assert.ok(
        execution.receipt.state === ExecutionState.Success,
        `execution state should be Success, got ${execution.receipt.state}`,
      )
    } finally {
      baseSepolia.destroy?.()
    }
  })

  it('should reject when source chain RPC is missing', async () => {
    const sourceTxHash = '0xe0caad74f4981c8972dce452a20096183d3a1181217ac83c164a484876c54a65'
    const messageId = '0x31a9803ec2bf6626efad053aefff0c7087e6ed62b3875025b915f1e18d5fc437'

    assert.ok(sepoliaInstance, 'sepolia anvil instance should be initialized')

    const sepoliaUrl = `http://${sepoliaInstance.host}:${sepoliaInstance.port}`

    await assert.rejects(
      execute(
        messageId,
        new Wallet(ANVIL_PRIVATE_KEY),
        [sepoliaUrl], // only dest, no source
        { gasLimit: 500_000, api: false, txHash: sourceTxHash },
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
        new Wallet(ANVIL_PRIVATE_KEY),
        [fujiUrl], // only source, no dest
        { gasLimit: 500_000, api: false, txHash: sourceTxHash },
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
      new Wallet(ANVIL_PRIVATE_KEY),
      [extraUrl, fujiUrl, sepoliaUrl],
      { gasLimit: 500_000, api: false, txHash: sourceTxHash },
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
      const messageId = '0x03ea73d3aa58a5358b06e8df8ca3ae71e171b63616bf4568d40f9ed9f907cff5'

      assert.ok(fujiInstance, 'fuji anvil instance should be initialized')
      assert.ok(sepoliaInstance, 'sepolia anvil instance should be initialized')

      const fujiUrl = `http://${fujiInstance.host}:${fujiInstance.port}`
      const sepoliaUrl = `http://${sepoliaInstance.host}:${sepoliaInstance.port}`

      // Execute using staging API to fetch execution inputs
      const execution = await execute(
        messageId,
        new Wallet(ANVIL_PRIVATE_KEY),
        [fujiUrl, sepoliaUrl],
        {
          gasLimit: 500_000,
          apiUrlOverride: STAGING_API_URL,
          txHash: sourceTxHash,
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

    it('should execute a v2.0 message via execute() + API (Base Sepolia -> Fuji)', async () => {
      const sourceTxHash = '0xb64da37467013d09030688b165ce1ca90c5415c99e1580dcddfeff825dd91dd7'
      const messageId = '0x0d6344c93e7dcd535fe5a4af0a733b4501db703d5540c2d301856abf903b70d1'

      assert.ok(baseSepoliaInstance, 'base sepolia anvil instance should be initialized')
      assert.ok(fujiInstance, 'fuji anvil instance should be initialized')

      const baseSepoliaUrl = `http://${baseSepoliaInstance.host}:${baseSepoliaInstance.port}`
      const fujiUrl = `http://${fujiInstance.host}:${fujiInstance.port}`

      // Execute using staging API — V2 execution inputs (encodedMessage, verifierAddresses, ccvData)
      // are fetched from the API and routed through the V2 path in execute()
      const execution = await execute(
        messageId,
        new Wallet(ANVIL_PRIVATE_KEY),
        [baseSepoliaUrl, fujiUrl],
        { apiUrlOverride: STAGING_API_URL, txHash: sourceTxHash },
      )

      assert.equal(execution.receipt.messageId, messageId, 'receipt messageId should match')
      assert.ok(execution.log.transactionHash, 'execution log should have a transaction hash')
      assert.ok(execution.timestamp > 0, 'execution should have a positive timestamp')
      assert.ok(
        execution.receipt.state === ExecutionState.Success,
        `execution state should be Success, got ${execution.receipt.state}`,
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
        new Wallet(ANVIL_PRIVATE_KEY),
        [fujiUrl, sepoliaUrl],
        {
          gasLimit: 500_000,
          api: false,
          txHash: sourceTxHash,
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
