import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

// Register every chain family the way SDK consumers do via the package root
import '../index.ts'
import { rpcEndpoint } from '../../../scripts/test-endpoints.ts'
import { useResource } from '../../../scripts/useResource.ts'
import { networkInfo } from '../networks.ts'
import { hexDiscriminator } from './utils.ts'
import { SolanaChain } from './index.ts'

// Live RPC: solana-devnet. Devnet runs Agave 4.x, which emits version-1
// transactions (version byte bumped, message layout still v0-compatible);
// @solana/web3.js >= 1.99.0 adds v1 transaction read support (its TransactionVersion
// struct and VersionedMessage deserialization accept version 1 and build a MessageV1).
// The fixture below is a real router tx (CcipSend, Solana → TON testnet).
// Override via RPC_SOLANA_DEVNET.
await useResource(['solana-devnet'])
const SOLANA_RPC = rpcEndpoint('RPC_SOLANA_DEVNET')

const skip = !!process.env.SKIP_INTEGRATION_TESTS

describe('Solana devnet v1 transaction logs', { skip, timeout: 120_000 }, () => {
  // A real router transaction (CcipSend, Solana → TON testnet) on the Agave 4.x
  // devnet: transaction version 1, with the CCIPMessageSent event emitted as an
  // anchor "Program data:" log.
  const V1_TX =
    '4bNhirt1ekTBac7pmNsGuwvzZWu3jLYEtJWDMSNmytzwjxYzBBU9M3TeRUS58nQ6LtJtwB5ue9NrsGpzM3vA4hfk'
  const V1_TX_SLOT = 494_724_511
  const ROUTER = 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C'
  const MESSAGE_SENT = hexDiscriminator('CCIPMessageSent')
  const MESSAGE_ID = '0x77f89a907830b14988ce1a5675b77007521d2410dd0fb31227238d349dfb874b'
  const TON_TESTNET_SELECTOR = networkInfo('ton-testnet').chainSelector

  let chain: SolanaChain
  before(async () => {
    chain = await SolanaChain.fromUrl(SOLANA_RPC)
  })

  it('getTransaction parses a version-1 transaction', async () => {
    const tx = await chain.getTransaction(V1_TX)
    assert.equal(tx.blockNumber, V1_TX_SLOT)
    assert.ok(tx.logs.length > 0, 'the tx carries parsed logs')
    const sender = tx.logs.find((log) => log.address === ROUTER && log.type === 'data')
    assert.ok(sender, 'the router emits a CCIPMessageSent anchor event log')
    assert.equal(sender.topics[0], MESSAGE_SENT)
  })

  it('getLogs streams the CCIPMessageSent event from the version-1 transaction', async () => {
    const logs = []
    for await (const log of chain.getLogs({
      address: ROUTER,
      topics: ['CCIPMessageSent'],
      startBlock: V1_TX_SLOT - 10,
      endBlock: V1_TX_SLOT,
    })) {
      logs.push(log)
    }
    const event = logs.find((log) => log.transactionHash === V1_TX)
    assert.ok(event, 'the v1 tx event is streamed by getLogs')
    assert.equal(event.address, ROUTER)
    assert.equal(event.topics[0], MESSAGE_SENT)
  })

  it('getMessagesInTx decodes the message carried by the version-1 transaction', async () => {
    const requests = await chain.getMessagesInTx(V1_TX)
    assert.equal(requests.length, 1)
    const message = requests[0]!.message
    assert.equal(message.messageId, MESSAGE_ID)
    if (!('destChainSelector' in message)) throw new Error('unexpected message variant')
    assert.equal(message.destChainSelector, TON_TESTNET_SELECTOR)
    assert.match(String(message.data), /^0x417262206d7367/, 'the payload starts with "Arb msg"')
  })
})
