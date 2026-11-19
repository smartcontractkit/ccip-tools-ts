/**
 * Tests for the Solana router config route: the lane version selects the 1.6 dest_chain_state
 * account or the 2.0 dest_chain_state_v2 one.
 */
import { Buffer } from 'buffer'
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { type Connection, Keypair, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import '../evm/index.ts' // registers the EVM family, the destination of this lane
import { networkInfo } from '../networks.ts'
import { CCIPVersion } from '../types.ts'
import { getAddressBytes, toLeArray } from '../utils.ts'
import { sizedCoder } from './coder.ts'
import { IDL as CCIP_ROUTER_IDL } from './idl/1.6.0/CCIP_ROUTER.ts'
import { IDL as CCIP_ROUTER_V2_IDL } from './idl/2.0.0/CCIP_ROUTER.ts'
import { SolanaChain } from './index.ts'

const silent = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Console
const randomKey = () => Keypair.generate().publicKey
const DEST = networkInfo('ethereum-testnet-sepolia').chainSelector
const routerCoder = sizedCoder(CCIP_ROUTER_IDL)
const routerV2Coder = sizedCoder(CCIP_ROUTER_V2_IDL)

describe('SolanaChain.getOnRampConfig version routing', () => {
  it('reads a 2.0 lane from dest_chain_state_v2, not the 1.6 dest_chain_state', async () => {
    const router = randomKey()
    const feeQuoter = randomKey()
    const linkTokenMint = randomKey()
    const onrampBytes = Buffer.from(getAddressBytes('0x9eC0e4A4c411493773E01e2ABF4D42395788846b'))

    const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], router)
    const [destChainStateV2] = PublicKey.findProgramAddressSync(
      [Buffer.from('dest_chain_state_v2'), toLeArray(DEST, 8)],
      router,
    )
    const configData = await routerCoder.accounts.encode('config', {
      version: 1,
      defaultCodeVersion: { default: {} },
      svmChainSelector: new BN(1),
      owner: randomKey(),
      proposedOwner: PublicKey.default,
      feeQuoter,
      rmnRemote: randomKey(),
      linkTokenMint,
      feeAggregator: randomKey(),
    })
    const destChainData = await routerV2Coder.accounts.encode('destChainCcipV2', {
      bump: 255,
      version: 1,
      chainSelector: new BN(DEST.toString()),
      state: {
        messageNumber: new BN(9),
        messageNumberToRestore: new BN(0),
        restoreOnAction: { none: {} },
      },
      config: {
        laneCodeVersion: { default: {} },
        addressBytesLength: 20,
        tokenReceiverAllowed: true,
        allowedSenders: [],
        allowListEnabled: false,
        defaultCcvs: [],
        laneMandatedCcvs: [],
        defaultExecutor: PublicKey.default,
        offramp: onrampBytes,
        messageNetworkFee: 5,
        tokenTransferNetworkFee: 6,
        baseExecutionGasCost: 7,
        maxFeePerMessage: 8,
      },
    })
    const accountInfo = async (key: PublicKey) => {
      const data = key.equals(configPda)
        ? configData
        : key.equals(destChainStateV2)
          ? destChainData
          : null
      return data ? { owner: router, data, lamports: 1, executable: false } : null
    }
    const getAccountInfoAndContext = mock.fn(async (key: PublicKey) => ({
      context: { slot: 1 },
      value: await accountInfo(key),
    }))
    const connection = {
      getAccountInfoAndContext,
      getAccountInfo: mock.fn(accountInfo),
      getSignaturesForAddress: mock.fn(async () => []),
    } as unknown as Connection
    const chain = new SolanaChain(connection, networkInfo('solana-devnet'), {
      apiClient: null,
      logger: silent,
    })
    mock.method(
      chain,
      'typeAndVersion',
      async () => ['Router', '2.0.0', 'Router 2.0.0'] as [string, string, string],
    )

    const config = await chain.getOnRampConfig(router.toBase58(), DEST, {
      version: CCIPVersion.V2_0,
    })

    assert.equal(config.laneVersion, CCIPVersion.V2_0)
    assert.equal(config.destChainSelector, DEST)
    assert.equal(config.router, router.toBase58())
    assert.equal(config.typeAndVersion, 'Router 2.0.0')
    assert.equal(String(config.feeQuoter), feeQuoter.toBase58())
    const lane = config as unknown as Record<string, unknown>
    assert.equal(lane.allowListEnabled, false)
    assert.equal(lane.tokenReceiverAllowed, true)
    assert.equal(lane.offramp, '0x9eC0e4A4c411493773E01e2ABF4D42395788846b')
    assert.equal(lane.messageNetworkFee, 5)
    assert.equal(lane.addressBytesLength, 20)
    assert.deepEqual(
      getAccountInfoAndContext.mock.calls.map((call) => call.arguments[0].toBase58()),
      [configPda.toBase58(), destChainStateV2.toBase58()],
    )
  })
})
