import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { useResourceForDescribe } from '../../../scripts/useResource.ts'
import {
  APTOS_TESTNET_RPCS,
  BASE_SEPOLIA_RPCS,
  BSC_TESTNET_RPCS,
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

// Moved off sepolia -> fuji: a lane lookup is call-only, so it does not need a
// testnet hub at all — this v1.5 lane is live on gnosis -> ethereum and leaves
// both hub locks to the suites that must scan them.
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

describe('e2e command lane EVM <-> Aptos (v1.6)', () => {
  useResourceForDescribe(['bsc-testnet', 'aptos-testnet', 'sepolia'])
  const LANE_RPCS = [...BSC_TESTNET_RPCS, ...APTOS_TESTNET_RPCS, ...SEPOLIA_RPCS]
  // EVM -> Aptos rides the same bsc-testnet lane as the show fixture; the
  // reverse direction has no live counterpart other than sepolia, so it stays.
  const BSC_ONRAMP = '0x28A025d34c830BF212f5D2357C8DcAB32dD92A20'
  const APTOS_PACKAGE = '0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45'
  const EVM_OFFRAMP = '0x0820f975ce90EE5c508657F0C58b71D1fcc85cE0'

  it('should show lane config BSC -> Aptos (v1.6)', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'binance_smart_chain-testnet',
      'aptos-testnet',
      BSC_ONRAMP,
      LANE_RPCS,
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 90000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(BSC_ONRAMP, 'i'))
    assert.match(envelope.onRampConfig.typeAndVersion, /OnRamp 1\.6\.0/)
    assert.ok(envelope.onRampConfig.router, 'onRampConfig should have router')
    assert.ok(envelope.onRampConfig.feeQuoterConfig, 'onRampConfig should have feeQuoterConfig')
    assert.ok(
      envelope.onRampConfig.feeQuoterConfig.typeAndVersion,
      'feeQuoterConfig should have typeAndVersion',
    )
    assert.match(envelope.offRamp, new RegExp(APTOS_PACKAGE, 'i'))
    assert.match(envelope.offRampConfig.typeAndVersion, /1\.6\.0/)
    assert.ok(envelope.offRampConfig.router, 'offRampConfig should have router')
    assert.ok(
      Array.isArray(envelope.offRampConfig.onRamps),
      'offRampConfig.onRamps should be an array',
    )
    assert.ok(
      envelope.offRampConfig.onRamps.some(
        (r: string) => r.toLowerCase() === BSC_ONRAMP.toLowerCase(),
      ),
      `offRampConfig.onRamps should include ${BSC_ONRAMP}`,
    )
  })

  it('should show lane config Aptos -> Sepolia (v1.6)', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'aptos-testnet',
      'ethereum-testnet-sepolia',
      APTOS_PACKAGE,
      LANE_RPCS,
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 90000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(APTOS_PACKAGE, 'i'))
    assert.match(envelope.onRampConfig.typeAndVersion, /1\.6\.0/)
    assert.ok(envelope.onRampConfig.router, 'onRampConfig should have router')
    assert.ok(
      envelope.onRampConfig.feeQuoterConfig,
      'onRampConfig (Aptos) should have feeQuoterConfig',
    )
    assert.match(envelope.offRamp, new RegExp(EVM_OFFRAMP, 'i'))
    assert.match(envelope.offRampConfig.typeAndVersion, /OffRamp 1\.6\.0/)
    assert.ok(envelope.offRampConfig.router, 'offRampConfig should have router')
    assert.ok(
      Array.isArray(envelope.offRampConfig.onRamps),
      'offRampConfig.onRamps should be an array',
    )
    assert.ok(
      envelope.offRampConfig.onRamps.some((r: string) =>
        r.toLowerCase().startsWith(APTOS_PACKAGE.toLowerCase()),
      ),
      `offRampConfig.onRamps should include ${APTOS_PACKAGE}`,
    )
  })
})

describe('e2e command lane EVM <-> Solana (v1.6)', () => {
  useResourceForDescribe(['sepolia', 'solana-devnet'])
  const LANE_RPCS = [...SEPOLIA_RPCS, ...SOLANA_DEVNET_RPCS]
  const EVM_ONRAMP = '0x23a5084Fa78104F3DF11C63Ae59fcac4f6AD9DeE'
  const SOLANA_OFFRAMP = 'offqSMQWgQud6WJz694LRzkeN5kMYpCHTpXQr3Rkcjm'
  const SOLANA_ONRAMP = 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C'
  const EVM_OFFRAMP = '0x0820f975ce90EE5c508657F0C58b71D1fcc85cE0'

  it('should show lane config Sepolia -> Solana (v1.6)', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'ethereum-testnet-sepolia',
      'solana-devnet',
      EVM_ONRAMP,
      LANE_RPCS,
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
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 90000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(SOLANA_ONRAMP))
    assert.match(envelope.onRampConfig.typeAndVersion, /1\.6\./)
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
