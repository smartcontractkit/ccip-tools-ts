import { Buffer } from 'buffer'

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { RemoveRemotePoolAddresses } from './remove-remote-pool-addresses.ts'
import { encodeRemotePoolAddressBytes } from './common.ts'
import {
  PAYER,
  POOL_PROGRAM,
  POOL_STATE,
  SELECTOR,
  anchorDiscriminator,
  chainConfigPda,
  stubChain,
} from './test-helpers.ts'

const EVM_TOKEN = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
const POOL_A = '0xd7BF0d8E6C242b6Dde4490Ab3aFc8C1e811ec9aD'
const POOL_B = '0x1111111111111111111111111111111111111111'

function remotesWith(pools: string[]) {
  return {
    'some-remote': {
      remoteToken: EVM_TOKEN,
      remotePools: pools,
      inboundRateLimiterState: null,
      outboundRateLimiterState: { tokens: 10n, capacity: 1000n, rate: 5n },
    },
  }
}

describe('Solana token-pool removeRemotePoolAddresses', () => {
  it('re-applies the chain with only the remaining pools', async () => {
    const chain = stubChain({ remotes: remotesWith([POOL_A, POOL_B]) })
    const unsigned = await new RemoveRemotePoolAddresses().generate(chain, {
      poolAddress: POOL_STATE.toBase58(),
      remoteChainSelector: SELECTOR,
      remotePoolAddresses: [POOL_A],
      payer: PAYER,
    })

    assert.equal(unsigned.family, ChainFamily.Solana)
    // delete + init + append + rateLimit
    assert.equal(unsigned.instructions.length, 4)
    const discs = unsigned.instructions.map((ix) => ix.data.subarray(0, 8).toString('hex'))
    assert.deepEqual(discs, [
      anchorDiscriminator('delete_chain_config').toString('hex'),
      anchorDiscriminator('init_chain_remote_config').toString('hex'),
      anchorDiscriminator('append_remote_pool_addresses').toString('hex'),
      anchorDiscriminator('set_chain_rate_limit').toString('hex'),
    ])
    for (const ix of unsigned.instructions) {
      assert.equal(ix.programId.toBase58(), POOL_PROGRAM.toBase58())
    }

    assert.equal(
      unsigned.instructions[0]!.keys[1]!.pubkey.toBase58(),
      chainConfigPda(SELECTOR).toBase58(),
    )

    // append keeps POOL_B, drops POOL_A
    const appendData = unsigned.instructions[2]!.data
    assert.ok(appendData.includes(Buffer.from(encodeRemotePoolAddressBytes(POOL_B))))
    assert.ok(!appendData.includes(Buffer.from(encodeRemotePoolAddressBytes(POOL_A))))
  })

  it('rejects when none of the addresses match the current config', async () => {
    const chain = stubChain({ remotes: remotesWith([POOL_A]) })
    await assert.rejects(
      () =>
        new RemoveRemotePoolAddresses().generate(chain, {
          poolAddress: POOL_STATE.toBase58(),
          remoteChainSelector: SELECTOR,
          remotePoolAddresses: [POOL_B],
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })

  it('rejects removing all pool addresses', async () => {
    const chain = stubChain({ remotes: remotesWith([POOL_A, POOL_B]) })
    await assert.rejects(
      () =>
        new RemoveRemotePoolAddresses().generate(chain, {
          poolAddress: POOL_STATE.toBase58(),
          remoteChainSelector: SELECTOR,
          remotePoolAddresses: [POOL_A, POOL_B],
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })

  it('rejects when no chain config exists for the selector', async () => {
    const chain = stubChain({ remotes: {} })
    await assert.rejects(
      () =>
        new RemoveRemotePoolAddresses().generate(chain, {
          poolAddress: POOL_STATE.toBase58(),
          remoteChainSelector: SELECTOR,
          remotePoolAddresses: [POOL_A],
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })

  it('rejects invalid params before RPC', async () => {
    await assert.rejects(
      () =>
        new RemoveRemotePoolAddresses().generate(stubChain(), {
          poolAddress: POOL_STATE.toBase58(),
          remoteChainSelector: SELECTOR,
          remotePoolAddresses: [],
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })
})
