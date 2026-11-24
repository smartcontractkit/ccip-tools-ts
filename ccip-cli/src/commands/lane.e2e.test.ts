import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { useResourceForDescribe } from '../../../scripts/useResource.ts'
import {
  APTOS_TESTNET_RPCS,
  BASE_SEPOLIA_RPCS,
  ETHEREUM_MAINNET_RPCS,
  GNOSIS_MAINNET_RPCS,
  ROBINHOOD_TESTNET_RPCS,
  SEPOLIA_RPCS,
  SOLANA_DEVNET_RPCS,
  TON_TESTNET_RPCS,
  spawnCLI,
} from './e2e-helpers.test.ts'

// Cross-family lanes make the CLI resolve Aptos/Solana/TON endpoints too.
// These are pure eth_call lookups, so the lanes were moved onto quiet chains
// wherever a live deployment allowed it; fuji is gone entirely and sepolia is
// only kept for the lanes whose counterpart chain has no other live pair.
//
// Locks are held per describe block and each invocation is pointed only at its
// own lane's endpoints (see e2e-helpers.test.ts), so the blocks of this suite
// interleave with other suites instead of queueing them all for the whole
// file lifetime. The ton-testnet block is the only one that contends with the
// SDK's TON live-scan suites; it waits for them rather than the reverse.
//
// Per-test spawn timeouts are kept 30s under the test timeout: spawnCLI's
// rejection carries the child's captured output, so a hung endpoint surfaces
// as a diagnosable failure instead of an opaque "test timed out".

function buildLaneArgs(
  source: string,
  dest: string,
  router: string,
  rpcs: string[],
  ...additionalArgs: string[]
): string[] {
  return [
    'lane',
    '--source',
    source,
    '--dest',
    dest,
    '--router',
    router,
    '--rpc',
    ...rpcs,
    '--rpcs-file',
    '', // Disable rpcs file loading
    ...additionalArgs,
  ]
}

// Pin the historical v1.5 OnRamp, not the active Gnosis → Ethereum v2.0 route.
// A config lookup still needs to pair this OnRamp with its historical OffRamp.
describe('e2e command lane EVM v1.5', () => {
  useResourceForDescribe(['gnosis-mainnet', 'ethereum-mainnet'])
  const LANE_RPCS = [...GNOSIS_MAINNET_RPCS, ...ETHEREUM_MAINNET_RPCS]
  const ONRAMP = '0x014abcfdbce9f67d0df34574664a6c0a241ec03a'
  const OFFRAMP = '0x70C705ff3eCAA04c8c61d581a59a168a1c49c2ec'

  it('should show lane config Gnosis -> Ethereum (v1.5) in JSON', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'gnosis_chain-mainnet',
      'ethereum-mainnet',
      ONRAMP,
      LANE_RPCS,
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 90000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(ONRAMP, 'i'))
    assert.match(envelope.onRampConfig.typeAndVersion, /EVM2EVMOnRamp 1\.5\.0/)
    assert.ok(envelope.onRampConfig.router, 'onRampConfig should have router')
    assert.ok(envelope.onRampConfig.feeQuoter, 'onRampConfig should have feeQuoter')
    assert.match(envelope.offRamp, new RegExp(OFFRAMP, 'i'))
    assert.match(envelope.offRampConfig.typeAndVersion, /EVM2EVMOffRamp 1\.5\.0/)
    assert.ok(envelope.offRampConfig.router, 'offRampConfig should have router')
    assert.ok(
      Array.isArray(envelope.offRampConfig.onRamps),
      'offRampConfig.onRamps should be an array',
    )
    assert.ok(
      envelope.offRampConfig.onRamps.some((r: string) => r.toLowerCase() === ONRAMP.toLowerCase()),
      `offRampConfig.onRamps should include ${ONRAMP}`,
    )
  })

  it(
    'should show lane config Gnosis -> Ethereum (v1.5) in pretty format',
    { timeout: 120000 },
    async () => {
      const args = buildLaneArgs('gnosis_chain-mainnet', 'ethereum-mainnet', ONRAMP, LANE_RPCS)
      const result = await spawnCLI(args, 90000)

      assert.equal(result.exitCode, 0, result.stdout + result.stderr)
      assert.match(result.stdout, /OnRamp.*gnosis_chain-mainnet/i)
      assert.match(result.stdout, new RegExp(ONRAMP, 'i'))
      assert.match(result.stdout, /EVM2EVMOnRamp 1\.5\.0/)
      assert.match(result.stdout, /OffRamp.*ethereum-mainnet/i)
      assert.match(result.stdout, new RegExp(OFFRAMP, 'i'))
      assert.match(result.stdout, /EVM2EVMOffRamp 1\.5\.0/)
    },
  )
})

// Same move as the v1.5 block above, onto the quietest chain pair carrying a live
// v2.0 lane: no other suite locks robinhood-testnet, so this one queues behind
// nothing (ink -> arbitrum-sepolia would have re-shared a lock with the SDK's EVM
// suites).
describe('e2e command lane EVM v2.0', () => {
  useResourceForDescribe(['robinhood-testnet', 'base-sepolia'])
  const LANE_RPCS = [...ROBINHOOD_TESTNET_RPCS, ...BASE_SEPOLIA_RPCS]
  const ONRAMP = '0xe001b46cd0df94a92fe62220f524d63e4d916ce8'

  it(
    'should show lane config Robinhood -> Base Sepolia (v2.0) in JSON',
    { timeout: 120000 },
    async () => {
      const args = buildLaneArgs(
        'robinhood-testnet',
        'ethereum-testnet-sepolia-base-1',
        ONRAMP,
        LANE_RPCS,
        '--format',
        'json',
      )
      const result = await spawnCLI(args, 90000)

      assert.equal(result.exitCode, 0, result.stdout + result.stderr)

      const envelope = JSON.parse(result.stdout)
      assert.match(envelope.onRamp, new RegExp(ONRAMP, 'i'))
      assert.match(envelope.onRampConfig.typeAndVersion, /OnRamp 2\.0\.0/)
      assert.ok(envelope.onRampConfig.router, 'onRampConfig should have router')
      assert.ok(envelope.onRampConfig.feeQuoterConfig, 'onRampConfig should have feeQuoterConfig')
      assert.ok(
        envelope.onRampConfig.feeQuoterConfig.typeAndVersion,
        'feeQuoterConfig should have typeAndVersion',
      )
      assert.ok(envelope.offRamp, 'offRamp should be discovered')
      assert.match(envelope.offRampConfig.typeAndVersion, /OffRamp 2\.0\.0/)
      assert.ok(envelope.offRampConfig.router, 'offRampConfig should have router')
      assert.ok(
        Array.isArray(envelope.offRampConfig.onRamps),
        'offRampConfig.onRamps should be an array',
      )
      assert.ok(
        envelope.offRampConfig.onRamps.some(
          (r: string) => r.toLowerCase() === ONRAMP.toLowerCase(),
        ),
        `offRampConfig.onRamps should include ${ONRAMP}`,
      )
    },
  )
})

// Aptos testnet CCIP 2.0.0 development deployment: refresh these fixtures after a redeploy.
// The SDK and remote chains name an Aptos 2.0 ramp by its state address.
describe('e2e command lane EVM <-> Aptos (v2.0)', () => {
  useResourceForDescribe(['aptos-testnet', 'sepolia'])
  const LANE_RPCS = [...APTOS_TESTNET_RPCS, ...SEPOLIA_RPCS]
  const SEPOLIA_ONRAMP = '0x82c5bace65956959076ee14074c7551b345e4835'
  const SEPOLIA_OFFRAMP = '0x6D817BB162b36be1Cf33b55977a9Fc8BD18a342c'
  const APTOS_ROUTER = '0x4408fcf09ba8aba2569958fe32ae7227d96a5ecba0c6dfe978d268a929ed5ee7'
  const APTOS_ONRAMP = '0x21cb562592180cdf573cd142dd96321bd47d78f32e34ea277725cee9a23b97a1'
  const APTOS_OFFRAMP = '0x62f92b897b1bd2351a59a229ac895f95909d621ab22e12ac71a7b62792dd7d86'

  it('should show lane config Sepolia -> Aptos (v2.0)', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'ethereum-testnet-sepolia',
      'aptos-testnet',
      SEPOLIA_ONRAMP,
      LANE_RPCS,
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 90000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(SEPOLIA_ONRAMP, 'i'))
    assert.equal(envelope.version, '2.0.0')
    assert.match(envelope.onRampConfig.typeAndVersion, /OnRamp 2\.0\.0/)
    assert.ok(envelope.onRampConfig.router, 'onRampConfig should have router')
    assert.ok(envelope.onRampConfig.feeQuoterConfig, 'onRampConfig should have feeQuoterConfig')
    assert.ok(
      envelope.onRampConfig.feeQuoterConfig.typeAndVersion,
      'feeQuoterConfig should have typeAndVersion',
    )
    assert.equal(envelope.offRamp, APTOS_OFFRAMP)
    assert.match(envelope.offRampConfig.typeAndVersion, /OffRamp 2\.0\.0/)
    assert.equal(envelope.offRampConfig.router, `${APTOS_ROUTER}::router`)
    assert.ok(
      envelope.offRampConfig.onRamps.some(
        (r: string) => r.toLowerCase() === SEPOLIA_ONRAMP.toLowerCase(),
      ),
      `offRampConfig.onRamps should include ${SEPOLIA_ONRAMP}`,
    )
  })

  it('should show lane config Aptos -> Sepolia (v2.0)', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'aptos-testnet',
      'ethereum-testnet-sepolia',
      APTOS_ROUTER,
      LANE_RPCS,
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 90000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    // the Router resolves the OnRamp state address
    assert.equal(envelope.onRamp, APTOS_ONRAMP)
    assert.equal(envelope.version, '2.0.0')
    assert.match(envelope.onRampConfig.typeAndVersion, /OnRamp 2\.0\.0/)
    assert.equal(envelope.onRampConfig.router, `${APTOS_ROUTER}::router`)
    assert.ok(
      envelope.onRampConfig.feeQuoterConfig,
      'onRampConfig (Aptos) should have feeQuoterConfig',
    )
    assert.match(envelope.offRamp, new RegExp(SEPOLIA_OFFRAMP, 'i'))
    assert.match(envelope.offRampConfig.typeAndVersion, /OffRamp 2\.0\.0/)
    assert.ok(envelope.offRampConfig.router, 'offRampConfig should have router')
    assert.ok(
      envelope.offRampConfig.onRamps.some((r: string) => r.toLowerCase() === APTOS_ONRAMP),
      `offRampConfig.onRamps should include ${APTOS_ONRAMP}`,
    )
  })
})

describe('e2e command lane EVM <-> Solana (v1.6 and v2.0)', () => {
  useResourceForDescribe(['sepolia', 'solana-devnet'])
  const LANE_RPCS = [...SEPOLIA_RPCS, ...SOLANA_DEVNET_RPCS]
  const EVM_ONRAMP = '0x23a5084Fa78104F3DF11C63Ae59fcac4f6AD9DeE'
  const SOLANA_OFFRAMP = 'offqSMQWgQud6WJz694LRzkeN5kMYpCHTpXQr3Rkcjm'
  // a 2.0 router (also the onRamp) that keeps serving its 1.6 lanes: `--lane-version` selects one
  const SOLANA_ONRAMP = 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C'
  const EVM_OFFRAMP = '0x0820f975ce90EE5c508657F0C58b71D1fcc85cE0'
  const EVM_OFFRAMP_V2 = '0xc6A246A9AcdAaE651708706494720F79C3E5d0A1'
  const EVM_ONRAMP_V2 = '0x8dcf17f298c881A547D91ca4aA3C2AD7568C6777'
  const SOLANA_OFFRAMP_V2 = 'off43sBHBsmWTU6VbfwKYCNwyJ4rSDhunYvz3QL7bF9'

  it('should show lane config Sepolia -> Solana (v1.6)', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'ethereum-testnet-sepolia',
      'solana-devnet',
      EVM_ONRAMP,
      LANE_RPCS,
      '--lane-version',
      '1.6',
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 90000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(EVM_ONRAMP, 'i'))
    assert.match(envelope.onRampConfig.typeAndVersion, /OnRamp 1\.6\.0/)
    assert.ok(envelope.onRampConfig.router, 'onRampConfig should have router')
    assert.ok(envelope.onRampConfig.feeQuoterConfig, 'onRampConfig should have feeQuoterConfig')
    assert.ok(
      envelope.onRampConfig.feeQuoterConfig.typeAndVersion,
      'feeQuoterConfig should have typeAndVersion',
    )
    assert.match(envelope.offRamp, new RegExp(SOLANA_OFFRAMP))
    assert.match(envelope.offRampConfig.typeAndVersion, /1\.6\./)
    assert.ok(envelope.offRampConfig.router, 'offRampConfig should have router')
    assert.ok(
      Array.isArray(envelope.offRampConfig.onRamps),
      'offRampConfig.onRamps should be an array',
    )
    assert.ok(
      envelope.offRampConfig.onRamps.some(
        (r: string) => r.toLowerCase() === EVM_ONRAMP.toLowerCase(),
      ),
      `offRampConfig.onRamps should include ${EVM_ONRAMP}`,
    )
  })

  it('should show lane config Solana -> Sepolia (v1.6)', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'solana-devnet',
      'ethereum-testnet-sepolia',
      SOLANA_ONRAMP,
      LANE_RPCS,
      '--lane-version',
      '1.6',
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 90000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(SOLANA_ONRAMP))
    assert.equal(envelope.version, '1.6.0')
    // the 1.6 lane config (`dest_chain_state`) of the 2.0 router
    assert.match(envelope.onRampConfig.typeAndVersion, /^ccip-router 2\./)
    assert.ok(envelope.onRampConfig.router, 'onRampConfig should have router')
    assert.ok(
      envelope.onRampConfig.feeQuoterConfig,
      'onRampConfig (Solana) should have feeQuoterConfig',
    )
    assert.match(envelope.offRamp, new RegExp(EVM_OFFRAMP, 'i'))
    assert.match(envelope.offRampConfig.typeAndVersion, /OffRamp 1\.6\.0/)
    assert.ok(envelope.offRampConfig.router, 'offRampConfig should have router')
    assert.ok(
      Array.isArray(envelope.offRampConfig.onRamps),
      'offRampConfig.onRamps should be an array',
    )
    assert.ok(
      envelope.offRampConfig.onRamps.some((r: string) => r === SOLANA_ONRAMP),
      `offRampConfig.onRamps should include ${SOLANA_ONRAMP}`,
    )
  })

  it('should show lane config Solana -> Sepolia (the default)', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'solana-devnet',
      'ethereum-testnet-sepolia',
      SOLANA_ONRAMP,
      LANE_RPCS,
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 90000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(SOLANA_ONRAMP))
    // The default is the active 2.0 lane. Its config (`dest_chain_state_v2`) names its offRamp.
    assert.equal(envelope.version, '2.0.0')
    assert.equal(envelope.onRampConfig.laneVersion, '2.0.0')
    assert.match(envelope.onRampConfig.typeAndVersion, /^ccip-router 2\./)
    assert.match(envelope.onRampConfig.offramp, new RegExp(EVM_OFFRAMP_V2, 'i'))
    assert.match(envelope.offRamp, new RegExp(EVM_OFFRAMP_V2, 'i'))
    assert.match(envelope.offRampConfig.typeAndVersion, /OffRamp 2\.0\./)
    assert.ok(
      envelope.offRampConfig.onRamps.some((r: string) => r === SOLANA_ONRAMP),
      `offRampConfig.onRamps should include ${SOLANA_ONRAMP}`,
    )
  })

  it('should show lane config Sepolia -> Solana (v2.0)', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'ethereum-testnet-sepolia',
      'solana-devnet',
      EVM_ONRAMP_V2,
      LANE_RPCS,
      '--lane-version',
      '2.0',
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 90000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(EVM_ONRAMP_V2, 'i'))
    assert.equal(envelope.version, '2.0.0')
    assert.match(envelope.offRamp, new RegExp(SOLANA_OFFRAMP_V2))
    assert.match(envelope.offRampConfig.typeAndVersion, /^ccip-offramp 2\./)
    // the same router allows the 1.6 offRamp of the other test for this source chain
    assert.equal(envelope.offRampConfig.router, SOLANA_ONRAMP)
    assert.ok(
      envelope.offRampConfig.onRamps.some(
        (r: string) => r.toLowerCase() === EVM_ONRAMP_V2.toLowerCase(),
      ),
      `offRampConfig.onRamps should include ${EVM_ONRAMP_V2}`,
    )
  })
})

describe('e2e command lane EVM <-> TON (v1.6)', () => {
  useResourceForDescribe(['ton-testnet', 'sepolia'])
  const LANE_RPCS = [...TON_TESTNET_RPCS, ...SEPOLIA_RPCS]
  const TON_ONRAMP = 'EQA-CUZI_USus4w0_Erf-wTj5uhaAR7XldEimU0w0WAJGGod'
  const EVM_ONRAMP_TON = '0xa36871bde0f98b84066405462e4a9709fb71c905'

  it('should show lane config TON -> Sepolia (v1.6)', { timeout: 300000 }, async () => {
    const args = buildLaneArgs(
      'ton-testnet',
      'ethereum-testnet-sepolia',
      TON_ONRAMP,
      LANE_RPCS,
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 270000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(TON_ONRAMP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(envelope.onRampConfig.typeAndVersion, /1\.6\.0/)
    assert.ok(envelope.onRampConfig.router, 'onRampConfig should have router')
    assert.ok(
      envelope.onRampConfig.feeQuoterConfig,
      'onRampConfig (TON) should have feeQuoterConfig',
    )
    assert.ok(
      envelope.onRampConfig.feeQuoterConfig.maxFeeJuelsPerMsg !== undefined,
      'feeQuoterConfig should have maxFeeJuelsPerMsg',
    )
    assert.ok(
      envelope.onRampConfig.feeQuoterConfig.linkToken,
      'feeQuoterConfig should have linkToken',
    )
    assert.ok(
      envelope.onRampConfig.feeQuoterConfig.usdPerUnitGas,
      'feeQuoterConfig should have usdPerUnitGas',
    )
    assert.ok(
      envelope.onRampConfig.feeQuoterConfig.defaultTxGasLimit !== undefined,
      'feeQuoterConfig should have defaultTxGasLimit',
    )
    assert.match(envelope.offRamp, /^0x[0-9a-fA-F]{40}$/, 'offRamp should be an EVM address')
    assert.match(envelope.offRampConfig.typeAndVersion, /OffRamp 1\.6\.0/)
    assert.ok(envelope.offRampConfig.router, 'offRampConfig should have router')
    assert.ok(Array.isArray(envelope.offRampConfig.onRamps))
  })

  it('should show lane config Sepolia -> TON (v1.6)', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'ethereum-testnet-sepolia',
      'ton-testnet',
      EVM_ONRAMP_TON,
      LANE_RPCS,
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 90000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(EVM_ONRAMP_TON, 'i'))
    assert.match(envelope.onRampConfig.typeAndVersion, /OnRamp 1\.6\.0/)
    assert.ok(envelope.onRampConfig.router, 'onRampConfig should have router')
    assert.ok(envelope.onRampConfig.feeQuoterConfig, 'onRampConfig should have feeQuoterConfig')
    assert.ok(
      envelope.onRampConfig.feeQuoterConfig.typeAndVersion,
      'feeQuoterConfig should have typeAndVersion',
    )
    assert.match(envelope.offRamp, /^0:[0-9a-fA-F]+$/, 'offRamp should be a raw TON address')
    assert.match(envelope.offRampConfig.typeAndVersion, /1\.6\.0/)
    assert.ok(envelope.offRampConfig.router, 'offRampConfig should have router')
    assert.ok(Array.isArray(envelope.offRampConfig.onRamps))
  })
})
