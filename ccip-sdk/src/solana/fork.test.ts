import assert from 'node:assert/strict'
import { type ChildProcess, execSync, spawn } from 'node:child_process'
import { Console } from 'node:console'
import { after, before, describe, it } from 'node:test'

import { BorshCoder, Wallet as AnchorWallet } from '@coral-xyz/anchor'
import {
  NATIVE_MINT,
  createApproveInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token'
import {
  type AccountMeta,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SendTransactionError,
} from '@solana/web3.js'
import { hexlify } from 'ethers'

import { rpcEndpoint } from '../../../scripts/test-endpoints.ts'
import { useResource, useResourceForDescribe } from '../../../scripts/useResource.ts'
import { CCIPAPIClient } from '../api/index.ts'
import {
  CCIPSolanaExecutionBufferIncompleteError,
  CCIPSolanaV2LaneUnavailableError,
} from '../errors/index.ts'
import type { GenericExtraArgsV3 } from '../extra-args.ts'
import { networkInfo } from '../index.ts'
import {
  type CCIPMessage,
  type MessageInput,
  CCIPVersion,
  ExecutionState,
  MessageStatus,
} from '../types.ts'
import { executeV2 } from './exec-v2.ts'
import {
  ETHEREUM_TO_SOLANA,
  SEPOLIA_TO_SOLANA_DEVNET_V2_NOEXEC as NOEXEC,
  SOLANA_DEVNET_V2_STAGING as STAGING,
} from './fork.test.data.ts'
import { IDL as CCIP_OFFRAMP_V2_IDL } from './idl/2.0.0/CCIP_OFFRAMP.ts'
import { IDL as CCIP_ROUTER_V2_IDL } from './idl/2.0.0/CCIP_ROUTER.ts'
import {
  type ExecutionInputsV2,
  fetchLookupTables,
  resolveCcipSendV2,
  resolveExecuteV2,
  resolveGetFeeV2,
} from './resolution.ts'
import { getExecutionInputsBufferPda, simulateAndSendTxs, simulateTransaction } from './utils.ts'
import { SolanaChain } from './index.ts'

// Surfpool forks live Solana mainnet state; the API-driven execution path uses the staging API.
await useResource(['solana-mainnet', 'api'])

// ── Constants ──

const VERBOSE = !!process.env.VERBOSE

const SOLANA_ROUTER = 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C'
const ETH_MAINNET_SELECTOR = networkInfo('ethereum-mainnet').chainSelector

// ── Surfpool helpers ──
interface SurfpoolInstance {
  host: string
  port: number
  start(): Promise<void>
  stop(): Promise<void>
}

function isSurfpoolAvailable(): boolean {
  try {
    execSync('surfpool --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function createSurfpoolInstance({
  rpcUrl,
  network = 'mainnet',
  host = '127.0.0.1',
  port = 8899,
}: {
  rpcUrl?: string
  network?: 'devnet' | 'mainnet' | 'testnet'
  port?: number
  host?: string
} = {}): SurfpoolInstance {
  let child: ChildProcess | undefined

  return {
    host,
    port,
    async start() {
      const args = [
        'start',
        '--port',
        String(port),
        '--host',
        host,
        '--no-tui',
        '--no-studio',
        '--no-deploy',
        '--ws-port',
        String(port + 1),
      ]
      if (rpcUrl) {
        args.push('--rpc-url', rpcUrl)
      } else {
        args.push('--network', network)
      }

      child = spawn('surfpool', args, { stdio: ['ignore', 'pipe', 'pipe'] })

      child.stdout?.on('data', (data: Buffer) => {
        if (VERBOSE) process.stdout.write(`[surfpool] ${String(data)}`)
      })
      child.stderr?.on('data', (data: Buffer) => {
        if (VERBOSE) process.stderr.write(`[surfpool] ${String(data)}`)
      })

      // Wait for RPC to become ready
      const url = `http://${host}:${port}`
      const deadline = Date.now() + 60_000
      while (Date.now() < deadline) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVersion', params: [] }),
          })
          if (res.ok) return
        } catch {
          // not ready yet
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      throw new Error(`Surfpool did not become ready within 60s at ${url}`)
    },

    async stop() {
      if (!child) return
      const proc = child
      child = undefined

      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          proc.kill('SIGKILL')
          resolve()
        }, 5_000)

        proc.on('exit', () => {
          clearTimeout(timeout)
          resolve()
        })

        proc.kill('SIGTERM')
      })
    },
  }
}

/**
 * Tears down the web3.js websocket BEFORE stopping surfpool. Sends confirm through it
 * (connection.confirmTransaction), and web3.js hands its client `max_reconnects: Infinity` — once
 * surfpool is gone the client would retry the dead socket every second forever, keeping the test
 * process alive long after every test has passed. There is no public accessor for the client, so
 * this pokes the private field, but only through its public CommonClient API
 * (setAutoReconnect/close).
 */
function closeWebSocket(connection: Connection | undefined) {
  const wsClient = (
    connection as unknown as
      | {
          _rpcWebSocket?: {
            setAutoReconnect?: (enable: boolean) => void
            close?: (code?: number, data?: string) => void
          }
        }
      | undefined
  )?._rpcWebSocket
  wsClient?.setAutoReconnect?.(false)
  try {
    wsClient?.close?.(1000, 'fork tests done')
  } catch {
    // socket already gone
  }
}

// ── Tests ──

const skip = !!process.env.SKIP_INTEGRATION_TESTS || !isSurfpoolAvailable()

const testLogger = new Console(process.stdout, process.stderr)
if (!VERBOSE) testLogger.debug = () => {}

// WARNING: these assume the mainnet router has no CCIP 2.0 support yet, so sends go over 1.6.
// Once mainnet gets 2.0 support (an in-place upgrade), the sends switch to ccip_send_v2 and the
// 2.0 rejection test below fails: update them then.
describe('Solana Fork Tests', { skip, timeout: 180_000 }, () => {
  let solanaChain: SolanaChain | undefined
  let surfpoolInstance: SurfpoolInstance | undefined
  let connection: Connection | undefined
  let wallet: AnchorWallet | undefined

  before(async () => {
    surfpoolInstance = createSurfpoolInstance({
      network: 'mainnet',
      port: 8647,
    })
    await surfpoolInstance.start()

    connection = new Connection(`http://${surfpoolInstance.host}:${surfpoolInstance.port}`, {
      commitment: 'confirmed',
      wsEndpoint: `ws://${surfpoolInstance.host}:${surfpoolInstance.port + 1}`,
    })

    solanaChain = new SolanaChain(connection, networkInfo('solana-mainnet'), {
      apiClient: null,
      logger: testLogger,
    })

    // Create and fund a wallet for send tests
    const keypair = Keypair.generate()
    wallet = new AnchorWallet(keypair)
    const airdropSig = await connection.requestAirdrop(keypair.publicKey, 10 * LAMPORTS_PER_SOL)
    await connection.confirmTransaction(airdropSig)
  })

  after(async () => {
    closeWebSocket(connection)
    await surfpoolInstance?.stop()
  })

  it('should connect to the surfpool instance', async () => {
    assert.ok(solanaChain, 'solana chain should be initialized')
    assert.ok(wallet, 'wallet should be initialized')
    const balance = await solanaChain.getBalance({ holder: wallet.publicKey.toBase58() })
    assert.ok(balance > 0n, 'wallet should have SOL balance from airdrop')
  })

  describe('sendMessage', () => {
    it('should send a data-only message (Solana -> Ethereum)', async () => {
      assert.ok(solanaChain, 'chain should be initialized')
      assert.ok(wallet, 'wallet should be initialized')

      const request = await solanaChain.sendMessage({
        router: SOLANA_ROUTER,
        destChainSelector: ETH_MAINNET_SELECTOR,
        message: {
          receiver: '0x9eC0e4A4c411493773E01e2ABF4D42395788846b',
          data: '0x1337',
          extraArgs: { gasLimit: 0n },
        },
        wallet,
      })

      // Message ID assertions
      assert.ok(request.message.messageId, 'messageId should be defined')
      assert.match(request.message.messageId, /^0x[0-9a-f]{64}$/i)

      // Lane assertions
      assert.equal(
        request.lane.sourceChainSelector,
        networkInfo('solana-mainnet').chainSelector,
        'source selector should be Solana mainnet',
      )
      assert.equal(
        request.lane.destChainSelector,
        ETH_MAINNET_SELECTOR,
        'dest selector should be Ethereum mainnet',
      )

      // Transaction assertions
      assert.ok(request.tx.hash, 'tx hash should be defined')

      // Message data round-trip
      assert.ok(
        String(request.message.data).includes('1337'),
        'message data should contain sent payload',
      )

      // Verify the CCIPMessageSent event log from the router
      assert.ok(request.log, 'request should contain the event log')
      assert.equal(request.log.address, SOLANA_ROUTER, 'log should be from the CCIP router')
      assert.equal(request.log.transactionHash, request.tx.hash, 'log tx hash should match')

      // Re-read the transaction and verify the message can be decoded from logs
      const tx = await solanaChain.getTransaction(request.tx.hash)
      const requests = await solanaChain.getMessagesInTx(tx)
      assert.equal(requests.length, 1, 'should find exactly one CCIP message in tx')
      assert.equal(
        requests[0]!.message.messageId,
        request.message.messageId,
        'decoded messageId should match',
      )
    })

    it('should send an oversized token-transfer message via a v1 transaction', async () => {
      assert.ok(solanaChain, 'chain should be initialized')
      assert.ok(wallet, 'wallet should be initialized')
      assert.ok(connection, 'connection should be initialized')

      // Fund the wallet's USDC associated token account through the surfpool
      // cheatcode (the forked mainnet USDC pool burns from the sender's ATA)
      const rpc = connection as unknown as {
        _rpcRequest(m: string, a: unknown[]): Promise<{ result?: unknown }>
      }
      const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      await rpc._rpcRequest('surfnet_setTokenAccount', [
        wallet.publicKey.toBase58(),
        usdcMint,
        { amount: 1_000_000_000, state: 'initialized' }, // 1000 USDC
      ])

      // Pad the message data so the ccipSend wire exceeds the 1232-byte v0 packet
      // even with address-lookup-table compression (v0 ≈ 1370 bytes), while still
      // fitting the 4096-byte v1 limit (SIMD-0385) the SDK falls back to. Token
      // transfers require allowOutOfOrderExecution (the router pulls the tokens in
      // a follow-up transaction).
      const data = `0x${'ab'.repeat(256)}`
      const request = await solanaChain.sendMessage({
        router: SOLANA_ROUTER,
        destChainSelector: ETH_MAINNET_SELECTOR,
        message: {
          receiver: '0x9eC0e4A4c411493773E01e2ABF4D42395788846b',
          data,
          tokenAmounts: [{ token: usdcMint, amount: 1_000_000n }],
          extraArgs: { gasLimit: 0n, allowOutOfOrderExecution: true },
        },
        wallet,
      })

      // The SDK prefers v0 and only falls back to v1 when the v0 wire does not fit;
      // re-read the transaction to assert the version the cluster recorded
      const tx = await solanaChain.getTransaction(request.tx.hash)
      assert.equal(
        tx.tx.version,
        1,
        `the oversized send should have been a v1 transaction (got ${tx.tx.version})`,
      )

      // Token transfer assertions
      assert.equal(request.message.tokenAmounts.length, 1)
      assert.equal(request.message.tokenAmounts[0]?.amount, 1_000_000n)

      // Verify the message (incl. tokenAmounts) decodes from the on-chain logs
      const decoded = await solanaChain.getMessagesInTx(tx)
      assert.equal(decoded.length, 1, 'should find exactly one CCIP message in tx')
      assert.equal(
        decoded[0]!.message.messageId,
        request.message.messageId,
        'decoded messageId should match',
      )
      assert.equal(decoded[0]!.message.tokenAmounts.length, 1)
      assert.equal(decoded[0]!.message.tokenAmounts[0]?.amount, 1_000_000n)
    })

    // WARNING: fails once the mainnet router gets CCIP 2.0 support; see the note on this suite
    it('should reject GenericExtraArgsV3 on a router without CCIP 2.0', async () => {
      assert.ok(solanaChain, 'chain should be initialized')
      assert.ok(wallet, 'wallet should be initialized')

      // the legacy sends above went over 1.6: this router doesn't have 2.0 support yet
      await assert.rejects(
        solanaChain.getFee({
          router: SOLANA_ROUTER,
          destChainSelector: ETH_MAINNET_SELECTOR,
          message: {
            receiver: '0x9eC0e4A4c411493773E01e2ABF4D42395788846b',
            extraArgs: { finality: 'finalized' },
          },
        }),
        (err: unknown) =>
          err instanceof CCIPSolanaV2LaneUnavailableError &&
          err.context.reason === 'router-without-v2-support',
      )
    })
  })

  describe('execute', () => {
    const EXEC_MSG = ETHEREUM_TO_SOLANA.find((m) => m.status === MessageStatus.Failed)!

    it('should execute a failed message via API-driven path (* -> Solana)', async () => {
      assert.ok(EXEC_MSG, 'should have a failed message in test data')
      assert.ok(connection, 'connection should be initialized')
      assert.ok(wallet, 'wallet should be initialized')

      const stagingApi = new CCIPAPIClient('https://api.ccip.cldev.cloud', { logger: testLogger })
      const solanaWithApi = new SolanaChain(connection, networkInfo('solana-mainnet'), {
        apiClient: stagingApi,
        logger: testLogger,
      })

      const execution = await solanaWithApi.execute({
        messageId: EXEC_MSG.messageId,
        wallet,
      })

      assert.equal(
        execution.receipt.messageId,
        EXEC_MSG.messageId,
        'receipt messageId should match',
      )
      assert.ok(execution.log.transactionHash, 'should have tx hash')
      assert.ok(execution.log.blockTimestamp > 0, 'should have timestamp')
      assert.equal(execution.receipt.state, ExecutionState.Success, 'execution should succeed')

      // Confirm by re-reading the execution tx and decoding the ExecutionStateChanged log
      const tx = await solanaWithApi.getTransaction(execution.log.transactionHash)
      const offRampLogs = tx.logs.filter(
        (l) => l.address === 'offqSMQWgQud6WJz694LRzkeN5kMYpCHTpXQr3Rkcjm',
      )
      const receipt = offRampLogs
        .map((l) => SolanaChain.decodeReceipt(l))
        .find((r) => r?.messageId === EXEC_MSG.messageId)
      assert.ok(receipt, 'should find ExecutionStateChanged in offRamp logs')
      assert.equal(receipt.state, ExecutionState.Success, 'offRamp log should confirm Success')
    })
  })
})

// Surfpool forks the private CCIP 2.0 staging deployment on Solana devnet
// (RPC_SOLANA_DEVNET, or the public default endpoint).
describe('Solana Devnet v2 Account Resolution Fork Tests', { skip, timeout: 300_000 }, () => {
  useResourceForDescribe(['solana-devnet'])

  const router = new PublicKey(STAGING.router)
  const offRamp = new PublicKey(STAGING.offRamp)
  const routerV2Coder = new BorshCoder(CCIP_ROUTER_V2_IDL)
  const offrampV2Coder = new BorshCoder(CCIP_OFFRAMP_V2_IDL)
  // lane defaults: CCVs, executor and finality all come from the lane's config
  const extraArgs: GenericExtraArgsV3 = {
    gasLimit: 0n,
    finality: 'finalized',
    ccvs: [],
    ccvArgs: [],
    executor: '',
    executorArgs: '0x',
    tokenReceiver: '',
    tokenArgs: '0x',
  }
  const receiver = '0x9eC0e4A4c411493773E01e2ABF4D42395788846b'

  let surfpoolInstance: SurfpoolInstance | undefined
  let connection: Connection | undefined
  let solanaChain: SolanaChain | undefined
  let wallet: AnchorWallet | undefined

  before(async () => {
    surfpoolInstance = createSurfpoolInstance({
      rpcUrl: rpcEndpoint('RPC_SOLANA_DEVNET'),
      port: 8657,
    })
    await surfpoolInstance.start()

    connection = new Connection(`http://${surfpoolInstance.host}:${surfpoolInstance.port}`, {
      commitment: 'confirmed',
      wsEndpoint: `ws://${surfpoolInstance.host}:${surfpoolInstance.port + 1}`,
    })
    solanaChain = new SolanaChain(connection, networkInfo('solana-devnet'), {
      apiClient: null,
      logger: testLogger,
    })

    wallet = new AnchorWallet(Keypair.generate())
    const airdropSig = await connection.requestAirdrop(wallet.publicKey, 10 * LAMPORTS_PER_SOL)
    await connection.confirmTransaction(airdropSig)

    // token transfers need the sender's token account to exist to send (quotes don't)
    await (
      connection as unknown as { _rpcRequest(m: string, a: unknown[]): Promise<unknown> }
    )._rpcRequest('surfnet_setTokenAccount', [
      wallet.publicKey.toBase58(),
      STAGING.sepoliaToken,
      { amount: 1_000_000_000, state: 'initialized' },
    ])
  })

  after(async () => {
    closeWebSocket(connection)
    await surfpoolInstance?.stop()
  })

  const ctx = () => ({ connection: connection!, logger: testLogger })

  /** Simulates a resolved get_fee_v2 and decodes its GetFeeResultV2. */
  async function quote(message: Parameters<typeof resolveGetFeeV2>[1]['message']) {
    const { instruction, lookupTables, metadata } = await resolveGetFeeV2(ctx(), {
      router,
      destChainSelector: STAGING.sepoliaSelector,
      message,
      payer: wallet!.publicKey,
    })
    // the fixed deployment lookup table isn't part of resolution; token transfers need it to fit v0
    const [sendLookupTable] = await fetchLookupTables(connection!, [
      new PublicKey(STAGING.sendLookupTable),
    ])
    const simResult = await simulateTransaction(ctx(), {
      payerKey: wallet!.publicKey,
      instructions: [ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }), instruction],
      addressLookupTableAccounts: [...lookupTables, sendLookupTable!],
    })
    assert.ok(simResult.returnData?.data[0], 'get_fee_v2 should return data')
    const result = routerV2Coder.types.decode<{ amount: { toString(): string }; token: PublicKey }>(
      'GetFeeResultV2',
      Buffer.from(simResult.returnData.data[0], 'base64'),
    )
    return {
      amount: BigInt(result.amount.toString()),
      token: result.token,
      instruction,
      lookupTables,
      metadata,
    }
  }

  /** Resolves and lands a ccip_send_v2, returning the decoded CCIP request. */
  async function send(message: Parameters<typeof resolveCcipSendV2>[1]['message']) {
    const { instruction, lookupTables } = await resolveCcipSendV2(ctx(), {
      router,
      destChainSelector: STAGING.sepoliaSelector,
      sender: wallet!.publicKey,
      message,
    })
    const [sendLookupTable] = await fetchLookupTables(connection!, [
      new PublicKey(STAGING.sendLookupTable),
    ])

    const instructions = [ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 })]
    for (const { token, amount } of message.tokenAmounts ?? []) {
      // the pool pulls the tokens through the router's fee billing signer
      const [spender] = PublicKey.findProgramAddressSync(
        [Buffer.from('fee_billing_signer')],
        router,
      )
      const ata = getAssociatedTokenAddressSync(new PublicKey(token), wallet!.publicKey)
      instructions.push(createApproveInstruction(ata, spender, wallet!.publicKey, amount))
    }
    instructions.push(instruction)

    const { hash } = await simulateAndSendTxs(
      ctx(),
      wallet!,
      {
        instructions,
        mainIndex: instructions.length - 1,
        lookupTables: [...lookupTables, sendLookupTable!],
      },
      { split: 'atomic' },
    )
    const requests = await solanaChain!.getMessagesInTx(await solanaChain!.getTransaction(hash))
    assert.equal(requests.length, 1, 'should find exactly one CCIP message in tx')
    const request = requests[0]!
    const sent = request.message as CCIPMessage<typeof CCIPVersion.V2_0>

    // Checks common to every send: lane, event origin and message envelope
    assert.equal(request.lane.sourceChainSelector, networkInfo('solana-devnet').chainSelector)
    assert.equal(request.lane.destChainSelector, STAGING.sepoliaSelector)
    assert.equal(request.lane.onRamp, STAGING.router)
    assert.equal(request.lane.version, CCIPVersion.V2_0)
    assert.equal(request.log.address, STAGING.router, 'event should come from the router')
    assert.equal(request.log.transactionHash, hash)
    assert.match(sent.messageId, /^0x[0-9a-f]{64}$/i)
    assert.ok(sent.sequenceNumber > 0n, 'sequence number should be assigned')
    assert.equal(sent.sender, wallet!.publicKey.toBase58())
    assert.equal(String(sent.receiver).toLowerCase(), message.receiver.toLowerCase())
    assert.equal(hexlify(sent.data), hexlify(message.data ?? '0x'))

    // Fee: native by default, and the total is exactly what the issuers' receipts charged
    assert.equal(sent.feeToken, NATIVE_MINT.toBase58(), 'native fee should be paid in WSOL')
    assert.ok(sent.feeTokenAmount > 0n, 'fee should be positive')
    assert.equal(
      sent.receipts.reduce((sum, receipt) => sum + receipt.feeTokenAmount, 0n),
      sent.feeTokenAmount,
      'receipts should add up to the fee',
    )
    // Resolution applied the lane defaults: the committee verifier and executor both charged
    const issuers = sent.receipts.map((receipt) => receipt.issuer)
    assert.ok(issuers.includes(STAGING.committeeVerifier), 'default CCV should issue a receipt')
    assert.ok(issuers.includes(STAGING.executor), 'default executor should issue a receipt')
    return { request, sent }
  }

  describe('get_fee_v2', () => {
    it('quotes a data-only message in native SOL', async () => {
      const { amount, token, instruction, metadata } = await quote({
        receiver,
        data: '0x1337',
        extraArgs,
      })
      assert.ok(amount > 0n, 'fee should be positive')
      assert.ok(amount < BigInt(LAMPORTS_PER_SOL), `fee should be under 1 SOL, got ${amount}`)
      assert.ok(
        token.equals(NATIVE_MINT),
        `native fee should be quoted in WSOL, got ${token.toBase58()}`,
      )

      // the resolved instruction: router's config first, 14 named accounts plus the remaining
      // ones, nothing to sign (it's a quote), and the account-list lengths as metadata
      const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], router)
      assert.ok(instruction.programId.equals(router))
      assert.ok(instruction.keys[0]?.pubkey.equals(config), 'first account should be the config')
      assert.ok(instruction.keys.length > 14, 'should resolve named and remaining accounts')
      assert.ok(
        instruction.keys.every(({ isSigner }) => !isSigner),
        'a fee quote should have no signers',
      )
      assert.ok(metadata.length > 0, 'resolution should return metadata')
    })

    it('quotes a token transfer, resolving the token pool lookup table', async () => {
      const dataOnly = await quote({ receiver, data: '0x', extraArgs })
      const withToken = await quote({
        receiver,
        data: '0x',
        tokenAmounts: [{ token: STAGING.sepoliaToken, amount: 1n }],
        extraArgs,
      })
      assert.ok(withToken.lookupTables.length > 0, 'token pool lookup table should be resolved')
      assert.ok(withToken.token.equals(NATIVE_MINT), 'native fee should be quoted in WSOL')
      assert.ok(withToken.amount > dataOnly.amount, 'token transfers should cost more')
      assert.ok(
        withToken.instruction.keys.length > dataOnly.instruction.keys.length,
        'token transfers should resolve the pool accounts',
      )
    })
  })

  describe('ccip_send_v2', () => {
    it('sends a data-only message (Solana -> Sepolia)', async () => {
      const message = { receiver, data: '0x1337', extraArgs }
      const quoted = await quote(message)
      const balanceBefore = await connection!.getBalance(wallet!.publicKey)

      const { sent } = await send(message)

      assert.equal(sent.feeTokenAmount, quoted.amount, 'fee paid should match the quote')
      assert.equal(sent.tokenAmounts.length, 0)
      const spent = BigInt(balanceBefore - (await connection!.getBalance(wallet!.publicKey)))
      assert.ok(spent >= sent.feeTokenAmount, `sender paid ${spent}, less than the fee`)
    })

    it('sends a token transfer (Solana -> Sepolia)', async () => {
      const amount = 1_000n
      const message = {
        receiver,
        data: '0x',
        tokenAmounts: [{ token: STAGING.sepoliaToken, amount }],
        extraArgs,
      }
      const ata = getAssociatedTokenAddressSync(
        new PublicKey(STAGING.sepoliaToken),
        wallet!.publicKey,
      )
      const tokenBalance = async () =>
        BigInt((await connection!.getTokenAccountBalance(ata)).value.amount)
      const quoted = await quote(message)
      const tokensBefore = await tokenBalance()

      const { sent } = await send(message)

      assert.equal(sent.feeTokenAmount, quoted.amount, 'fee paid should match the quote')
      assert.equal(sent.tokenAmounts.length, 1)
      const transfer = sent.tokenAmounts[0]!
      assert.equal(transfer.amount, amount)
      assert.equal(transfer.sourceTokenAddress, STAGING.sepoliaToken)
      assert.equal(String(transfer.tokenReceiver).toLowerCase(), receiver.toLowerCase())
      // the pool program charged its share of the fee too
      assert.ok(
        sent.receipts.some(({ issuer }) => issuer === STAGING.sepoliaTokenPool),
        'token pool should issue a receipt',
      )
      assert.equal(tokensBefore - (await tokenBalance()), amount, 'tokens should leave the sender')
    })
  })

  describe('execute_v2', () => {
    // Re-resolves a landed execution from its own inputs. Resolution is read-only, so it works
    // for an already executed message, and must reproduce the account list the transaction used.
    // A program upgrade that changes the account list shows up here, and so does one that
    // changes the metadata layout, which is why only its message_id suffix is compared.
    it('reproduces the accounts of a landed execution', async () => {
      const tx = await connection!.getTransaction(STAGING.executeTx, {
        maxSupportedTransactionVersion: 0,
      })
      assert.ok(tx?.meta, 'execution tx should exist')
      const msg = tx.transaction.message
      const keys = msg.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses })
      const landed = msg.compiledInstructions.find((ix) =>
        keys.get(ix.programIdIndex)?.equals(offRamp),
      )
      assert.ok(landed, 'execution tx should call the offramp')
      const landedAccounts: AccountMeta[] = landed.accountKeyIndexes.map((i) => ({
        pubkey: keys.get(i)!,
        isSigner: msg.isAccountSigner(i),
        isWritable: msg.isAccountWritable(i),
      }))
      const { execInputs } = offrampV2Coder.types.decode<{ execInputs: ExecutionInputsV2 }>(
        'ExecuteParams',
        Buffer.from(landed.data).subarray(8),
      )

      const { instruction, lookupTables, metadata } = await resolveExecuteV2(ctx(), {
        offramp: offRamp,
        caller: keys.get(0)!,
        execInputs,
      })

      assert.deepEqual(
        instruction.keys.map(({ pubkey, isSigner, isWritable }) => [
          pubkey.toBase58(),
          isSigner,
          isWritable,
        ]),
        landedAccounts.map(({ pubkey, isSigner, isWritable }) => [
          pubkey.toBase58(),
          isSigner,
          isWritable,
        ]),
      )
      assert.deepEqual(
        lookupTables.map(({ key }) => key.toBase58()),
        msg.addressTableLookups.map(({ accountKey }) => accountKey.toBase58()),
      )
      assert.equal(hexlify(metadata.subarray(-32)), STAGING.executeMessageId)
    })

    /** The landed execution's inputs, as an `ExecutionInput`. */
    async function landedInput() {
      const tx = await connection!.getTransaction(STAGING.executeTx, {
        maxSupportedTransactionVersion: 0,
      })
      const msg = tx!.transaction.message
      const keys = msg.getAccountKeys({ accountKeysFromLookups: tx!.meta!.loadedAddresses })
      const landed = msg.compiledInstructions.find((ix) =>
        keys.get(ix.programIdIndex)?.equals(offRamp),
      )!
      const { execInputs } = offrampV2Coder.types.decode<{ execInputs: ExecutionInputsV2 }>(
        'ExecuteParams',
        Buffer.from(landed.data).subarray(8),
      )
      return {
        encodedMessage: hexlify(execInputs.encodedMessage),
        verifications: execInputs.ccvs.map((ccv, i) => ({
          destAddress: ccv.toBase58(),
          ccvData: hexlify(execInputs.verifierResults[i]!),
        })),
      }
    }

    // The policy of a message its landed verifier results satisfied: those cover it, without any
    // indexer or API to fetch them from
    it('reads the verification policy of a landed execution', async () => {
      const input = await landedInput()
      const request = {
        lane: {
          sourceChainSelector: STAGING.sepoliaSelector,
          destChainSelector: networkInfo('solana-devnet').chainSelector,
          onRamp: '',
          version: CCIPVersion.V2_0,
        },
        message: { messageId: STAGING.executeMessageId, encodedMessage: input.encodedMessage },
        log: { blockTimestamp: 0 },
      } as unknown as Parameters<SolanaChain['getVerifications']>[0]['request']

      const result = await solanaChain!.getVerifications({
        offRamp: STAGING.offRamp,
        request,
        indexer: [],
        ccvData: Object.fromEntries(input.verifications.map((v) => [v.destAddress, v.ccvData])),
      })

      assert.ok('verificationPolicy' in result)
      const landedCcvs = input.verifications.map(({ destAddress }) => destAddress)
      assert.ok(result.verificationPolicy.requiredCCVs.length, 'lanes require some CCV')
      for (const ccv of result.verificationPolicy.requiredCCVs) assert.ok(landedCcvs.includes(ccv))
      assert.deepEqual(
        result.verifications.map(({ destAddress }) => destAddress).sort(),
        [...landedCcvs].sort(),
      )
    })

    // execute_v2 skips an already executed message after resolving and checking it, closing the
    // buffer it came from, if any: this runs every path up to the CCV verification
    it('executes a landed message again, inline and from a buffer', async () => {
      const input = await landedInput()
      const ctx_ = ctx()

      const inline = await executeV2(ctx_, wallet!, { offramp: offRamp, input })
      const inlineTx = await connection!.getTransaction(inline, {
        maxSupportedTransactionVersion: 1,
      })
      assert.equal(inlineTx?.meta?.err, null, 'inline execution should succeed')

      const buffered = await executeV2(ctx_, wallet!, {
        offramp: offRamp,
        input,
        forceBuffer: true,
      })
      const bufferedTx = await connection!.getTransaction(buffered, {
        maxSupportedTransactionVersion: 1,
      })
      assert.equal(bufferedTx?.meta?.err, null, 'buffered execution should succeed')
      const buffer = getExecutionInputsBufferPda(
        offRamp,
        Buffer.from(STAGING.executeMessageId.slice(2), 'hex'),
        wallet!.publicKey,
      )
      assert.ok(
        bufferedTx.transaction.message
          .getAccountKeys({ accountKeysFromLookups: bufferedTx.meta!.loadedAddresses })
          .keySegments()
          .flat()
          .some((key) => key.equals(buffer)),
        'buffered execution should read the buffer',
      )
      assert.equal(await connection!.getAccountInfo(buffer), null, 'the buffer should be closed')
    })

    // An external signer's buffered execution, in unsigned steps: the buffering ahead, one chunk
    // per transaction, then the execution resolved from the complete buffer
    it('executes a landed message again from a buffer written ahead', async () => {
      const input = await landedInput()
      const opts = { offRamp: STAGING.offRamp, input, payer: wallet!.publicKey.toBase58() }
      const buffer = getExecutionInputsBufferPda(
        offRamp,
        Buffer.from(STAGING.executeMessageId.slice(2), 'hex'),
        wallet!.publicKey,
      )

      await assert.rejects(
        solanaChain!.generateUnsignedExecute({ ...opts, forceBuffer: true }),
        CCIPSolanaExecutionBufferIncompleteError,
      )
      const buffering = await solanaChain!.generateUnsignedExecuteBuffer(opts)
      assert.ok(buffering.instructions.length, 'the inputs should need buffering')
      for (const ix of buffering.instructions)
        await simulateAndSendTxs(ctx(), wallet!, { instructions: [ix] })
      assert.deepEqual(
        (await solanaChain!.generateUnsignedExecuteBuffer(opts)).instructions,
        [],
        'the buffer should be complete',
      )

      const unsigned = await solanaChain!.generateUnsignedExecute({ ...opts, forceBuffer: true })
      const { hash } = await simulateAndSendTxs(ctx(), wallet!, unsigned)
      const tx = await connection!.getTransaction(hash, { maxSupportedTransactionVersion: 1 })
      assert.equal(tx?.meta?.err, null, 'buffered execution should succeed')
      assert.ok(
        tx.transaction.message
          .getAccountKeys({ accountKeysFromLookups: tx.meta!.loadedAddresses })
          .keySegments()
          .flat()
          .some((key) => key.equals(buffer)),
        'buffered execution should read the buffer',
      )
      assert.equal(await connection!.getAccountInfo(buffer), null, 'the buffer should be closed')
    })

    // A message sent with NO_EXECUTION_ADDRESS stays unexecuted on devnet, so the fork executes it
    // for real: a token-only transfer, which the pool mints to the token receiver's ATA
    describe('an unexecuted message', () => {
      const input = { encodedMessage: NOEXEC.encodedMessage, verifications: NOEXEC.verifications }

      it('reads its verification policy', async () => {
        const request = {
          lane: {
            sourceChainSelector: STAGING.sepoliaSelector,
            destChainSelector: networkInfo('solana-devnet').chainSelector,
            onRamp: NOEXEC.onRamp,
            version: CCIPVersion.V2_0,
          },
          message: { messageId: NOEXEC.messageId, encodedMessage: NOEXEC.encodedMessage },
          log: { blockTimestamp: 0 },
        } as unknown as Parameters<SolanaChain['getVerifications']>[0]['request']

        const result = await solanaChain!.getVerifications({
          offRamp: STAGING.offRamp,
          request,
          indexer: [],
          ccvData: Object.fromEntries(NOEXEC.verifications.map((v) => [v.destAddress, v.ccvData])),
        })

        assert.ok('verificationPolicy' in result)
        assert.ok(result.verificationPolicy.requiredCCVs.includes(STAGING.committeeVerifier))
        assert.deepEqual(
          result.verifications.map(({ destAddress }) => destAddress),
          [STAGING.committeeVerifier],
        )
      })

      it('executes it', async () => {
        const mint = new PublicKey(NOEXEC.destToken)
        const ata = getAssociatedTokenAddressSync(mint, new PublicKey(NOEXEC.tokenReceiver))
        // the ATA may not exist yet: execute_v2 creates it
        const balance = async () =>
          BigInt(
            (await connection!.getTokenAccountBalance(ata).catch(() => null))?.value.amount ?? 0,
          )
        const before = await balance()
        // the pool converts the amount from the source token's 18 decimals
        const { decimals } = await getMint(connection!, mint)

        // Surfpool 1.5.0 ignores the compute-unit limit of v1 transactions, capping this ~270k CU
        // execution at the 200k default; a lookup table keeps it in a v0 transaction instead
        const execution = await solanaChain!.execute({
          offRamp: STAGING.offRamp,
          input,
          wallet: wallet!,
          forceLookupTable: true,
        })

        assert.equal(execution.receipt.messageId, NOEXEC.messageId)
        assert.equal(execution.receipt.state, ExecutionState.Success, 'execution should succeed')
        assert.equal(
          (await balance()) - before,
          (NOEXEC.amount * 10n ** BigInt(decimals)) / 10n ** 18n,
          'tokens should reach the token receiver',
        )
      })
    })
  })

  // SolanaChain picks the router entrypoint per message: 2.0 whenever the lane supports it
  describe('SolanaChain send lane routing', () => {
    const legacyArgs = { gasLimit: 0n, allowOutOfOrderExecution: true }
    const sendOpts = (message: MessageInput) => ({
      router: STAGING.router,
      destChainSelector: STAGING.sepoliaSelector,
      message,
      wallet: wallet!,
    })

    /** The confirmed transaction of a send, as v0 (throws for any later version). */
    async function landedV0(hash: string) {
      const tx = await connection!.getTransaction(hash, { maxSupportedTransactionVersion: 0 })
      assert.ok(tx, 'send tx should exist')
      return tx
    }

    it('quotes legacy extraArgs over 2.0, as their GenericExtraArgsV3 conversion', async () => {
      const fee = await solanaChain!.getFee({
        router: STAGING.router,
        destChainSelector: STAGING.sepoliaSelector,
        message: { receiver, data: '0x1337', extraArgs: legacyArgs },
      })
      const { amount } = await quote({ receiver, data: '0x1337', extraArgs })
      assert.equal(fee, amount)
    })

    it('quotes a token transfer over 2.0 without a sender, at what the send charges', async () => {
      const message = {
        receiver,
        data: '0x',
        tokenAmounts: [{ token: STAGING.sepoliaToken, amount: 1n }],
        extraArgs: legacyArgs,
      }
      const fee = await solanaChain!.getFee({
        router: STAGING.router,
        destChainSelector: STAGING.sepoliaSelector,
        message,
      })
      const request = await solanaChain!.sendMessage(sendOpts(message))
      assert.equal(request.lane.version, CCIPVersion.V2_0)
      const sent = request.message as CCIPMessage<typeof CCIPVersion.V2_0>
      assert.equal(sent.feeTokenAmount, fee, 'the send should charge the sender-less quote')
    })

    it('sends legacy extraArgs over 2.0', async () => {
      const request = await solanaChain!.sendMessage(
        sendOpts({ receiver, data: '0x1337', extraArgs: legacyArgs }),
      )
      assert.equal(request.lane.version, CCIPVersion.V2_0)
      assert.equal(request.log.address, STAGING.router)
      const sent = request.message as CCIPMessage<typeof CCIPVersion.V2_0>
      const issuers = sent.receipts.map((receipt) => receipt.issuer)
      assert.ok(issuers.includes(STAGING.committeeVerifier), 'default CCV should issue a receipt')
      assert.ok(issuers.includes(STAGING.executor), 'default executor should issue a receipt')
    })

    it('sends a GenericExtraArgsV3 token transfer in a v0 tx, with the fixed lookup table', async () => {
      const amount = 1_000n
      const ata = getAssociatedTokenAddressSync(
        new PublicKey(STAGING.sepoliaToken),
        wallet!.publicKey,
      )
      const tokenBalance = async () =>
        BigInt((await connection!.getTokenAccountBalance(ata)).value.amount)
      const tokensBefore = await tokenBalance()

      const request = await solanaChain!.sendMessage(
        sendOpts({
          receiver,
          tokenAmounts: [{ token: STAGING.sepoliaToken, amount }],
          extraArgs: { finality: 'finalized' },
        }),
      )

      assert.equal(request.lane.version, CCIPVersion.V2_0)
      const sent = request.message as CCIPMessage<typeof CCIPVersion.V2_0>
      assert.equal(sent.tokenAmounts[0]?.amount, amount)
      assert.equal(tokensBefore - (await tokenBalance()), amount, 'tokens should leave the sender')
      const tx = await landedV0(request.tx.hash)
      assert.ok(
        tx.transaction.message.addressTableLookups.some(
          ({ accountKey }) => accountKey.toBase58() === STAGING.sendLookupTable,
        ),
        'the send should use the deployment lookup table',
      )
    })

    it('rejects GenericExtraArgsV3 to a lane not configured for 2.0', async () => {
      await assert.rejects(
        solanaChain!.getFee({
          router: STAGING.router,
          destChainSelector: ETH_MAINNET_SELECTOR,
          message: { receiver, extraArgs: { finality: 'finalized' } },
        }),
        (err: unknown) =>
          err instanceof CCIPSolanaV2LaneUnavailableError &&
          err.context.reason === 'lane-not-configured',
      )
    })

    // Rewrites the Sepolia lane's `dest_chain_state_v2` on the fork to enable its allowlist
    describe('with the lane allowlist enabled', () => {
      const selectorLe = Buffer.alloc(8)
      selectorLe.writeBigUInt64LE(STAGING.sepoliaSelector)
      const [laneState] = PublicKey.findProgramAddressSync(
        [Buffer.from('dest_chain_state_v2'), selectorLe],
        router,
      )
      let original: Buffer | undefined

      async function setLaneState(data: Buffer) {
        await (
          connection as unknown as { _rpcRequest(m: string, a: unknown[]): Promise<unknown> }
        )._rpcRequest('surfnet_setAccount', [
          laneState.toBase58(),
          { data: data.toString('hex'), lamports: LAMPORTS_PER_SOL },
        ])
      }
      async function setAllowlist(allowedSenders: PublicKey[]) {
        const state = routerV2Coder.accounts.decode<{
          config: { allowListEnabled: boolean; allowedSenders: PublicKey[] }
        }>('destChainCcipV2', original!)
        await setLaneState(
          await routerV2Coder.accounts.encode('destChainCcipV2', {
            ...state,
            config: { ...state.config, allowListEnabled: true, allowedSenders },
          }),
        )
      }

      before(async () => {
        const account = await connection!.getAccountInfoAndContext(laneState)
        assert.ok(account.value, 'the lane state should exist')
        original = account.value.data
      })
      after(async () => {
        if (original) await setLaneState(original)
      })

      const v3 = { receiver, data: '0x1337', extraArgs: { finality: 'finalized' as const } }
      const feeOpts = (message: MessageInput) => ({
        router: STAGING.router,
        destChainSelector: STAGING.sepoliaSelector,
        message,
      })

      it("doesn't quote or send over 2.0, even for an allowlisted sender", async () => {
        await setAllowlist([Keypair.generate().publicKey, wallet!.publicKey])

        const allowlistEnabled = (err: unknown) =>
          err instanceof CCIPSolanaV2LaneUnavailableError &&
          err.context.reason === 'allowlist-enabled'
        await assert.rejects(solanaChain!.getFee(feeOpts(v3)), allowlistEnabled)
        await assert.rejects(solanaChain!.sendMessage(sendOpts(v3)), allowlistEnabled)
        // legacy args fall back to 1.6 instead, which this 2.0-only deployment doesn't have
        const legacy = { ...v3, extraArgs: legacyArgs }
        await assert.rejects(
          solanaChain!.getFee(feeOpts(legacy)),
          (err: unknown) => !(err instanceof CCIPSolanaV2LaneUnavailableError),
        )
        await assert.rejects(
          solanaChain!.sendMessage(sendOpts(legacy)),
          (err: unknown) => !(err instanceof CCIPSolanaV2LaneUnavailableError),
        )
      })

      describe('with sendV2OnAllowlistedLanes', () => {
        const optedIn = { sendV2OnAllowlistedLanes: true }

        it('quotes and sends over 2.0 for an allowlisted sender, at the quoted fee', async () => {
          await setAllowlist([Keypair.generate().publicKey, wallet!.publicKey])
          const fee = await solanaChain!.getFee({ ...feeOpts(v3), ...optedIn })
          const request = await solanaChain!.sendMessage({
            ...sendOpts({ ...v3, fee }),
            ...optedIn,
          })
          assert.equal(request.lane.version, CCIPVersion.V2_0)
          const sent = request.message as CCIPMessage<typeof CCIPVersion.V2_0>
          assert.equal(sent.feeTokenAmount, fee, 'the send should charge the quoted fee')
        })

        it('leaves rejecting a sender off the allowlist to the router', async () => {
          await setAllowlist([Keypair.generate().publicKey])
          await assert.rejects(
            solanaChain!.sendMessage({ ...sendOpts(v3), ...optedIn }),
            (err: unknown) =>
              err instanceof SendTransactionError &&
              !!err.logs?.some((log) => log.includes('SenderNotAllowed')),
          )
        })
      })
    })
  })
})
