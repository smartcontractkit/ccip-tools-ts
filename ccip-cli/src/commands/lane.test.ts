import { spawn } from 'child_process'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_PATH = path.join(__dirname, '..', 'index.ts')

const RPCS = [
  process.env['RPC_SEPOLIA'] || 'https://ethereum-sepolia-rpc.publicnode.com',
  process.env['RPC_AVAX'] || 'https://avalanche-fuji-c-chain-rpc.publicnode.com',
  process.env['RPC_APTOS'] || 'testnet',
  process.env['RPC_SOLANA'] || 'https://api.devnet.solana.com',
  process.env['RPC_TON'] || 'https://testnet.toncenter.com/api/v2',
]

async function spawnCLI(
  args: string[],
  timeout = 60000,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_PATH, ...args], { env: { ...process.env } })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => (stdout += data.toString()))
    child.stderr.on('data', (data) => (stderr += data.toString()))

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`CLI command timed out after ${timeout / 1e3}s`))
    }, timeout)

    child.on('close', (code) => {
      clearTimeout(timeoutId)
      resolve({ stdout, stderr, exitCode: code })
    })

    child.on('error', (err) => {
      clearTimeout(timeoutId)
      reject(err)
    })
  })
}

function buildLaneArgs(
  source: string,
  dest: string,
  router: string,
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
    ...RPCS,
    '--rpcs-file',
    'package.json',
    ...additionalArgs,
  ]
}

describe('e2e command lane EVM v1.5', () => {
  const ONRAMP = '0x12492154714fBD28F28219f6fc4315d19de1025B'
  const OFFRAMP = '0x01e3D835b4C4697D7F81B9d7Abc89A6E478E4a2f'

  it('should show lane config Sepolia -> Fuji (v1.5) in JSON', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'ethereum-testnet-sepolia',
      'avalanche-testnet-fuji',
      ONRAMP,
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 120000)

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
    'should show lane config Sepolia -> Fuji (v1.5) in pretty format',
    { timeout: 120000 },
    async () => {
      const args = buildLaneArgs('ethereum-testnet-sepolia', 'avalanche-testnet-fuji', ONRAMP)
      const result = await spawnCLI(args, 120000)

      assert.equal(result.exitCode, 0, result.stdout + result.stderr)
      assert.match(result.stdout, /OnRamp.*ethereum-testnet-sepolia/i)
      assert.match(result.stdout, new RegExp(ONRAMP, 'i'))
      assert.match(result.stdout, /EVM2EVMOnRamp 1\.5\.0/)
      assert.match(result.stdout, /OffRamp.*avalanche-testnet-fuji/i)
      assert.match(result.stdout, new RegExp(OFFRAMP, 'i'))
      assert.match(result.stdout, /EVM2EVMOffRamp 1\.5\.0/)
    },
  )
})

describe('e2e command lane EVM v2.0', () => {
  const ONRAMP = '0xA94E45744553F4B2bea9DfB8979a02962B980732'

  it('should show lane config Sepolia -> Fuji (v2.0) in JSON', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'ethereum-testnet-sepolia',
      'avalanche-testnet-fuji',
      ONRAMP,
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 120000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(ONRAMP, 'i'))
    assert.match(envelope.onRampConfig.typeAndVersion, /OnRamp 2\.0\.0/)
    assert.ok(envelope.onRampConfig.router, 'onRampConfig should have router')
    assert.ok(envelope.offRamp, 'offRamp should be discovered')
    assert.match(envelope.offRampConfig.typeAndVersion, /OffRamp 2\.0\.0/)
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
})

describe('e2e command lane EVM <-> Aptos (v1.6)', () => {
  const EVM_ONRAMP = '0x23a5084Fa78104F3DF11C63Ae59fcac4f6AD9DeE'
  const APTOS_PACKAGE = '0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45'
  const EVM_OFFRAMP = '0x0820f975ce90EE5c508657F0C58b71D1fcc85cE0'

  it('should show lane config Sepolia -> Aptos (v1.6)', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'ethereum-testnet-sepolia',
      'aptos-testnet',
      EVM_ONRAMP,
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 120000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(EVM_ONRAMP, 'i'))
    assert.match(envelope.onRampConfig.typeAndVersion, /OnRamp 1\.6\.0/)
    assert.ok(envelope.onRampConfig.router, 'onRampConfig should have router')
    assert.match(envelope.offRamp, new RegExp(APTOS_PACKAGE, 'i'))
    assert.match(envelope.offRampConfig.typeAndVersion, /1\.6\.0/)
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

  it('should show lane config Aptos -> Sepolia (v1.6)', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'aptos-testnet',
      'ethereum-testnet-sepolia',
      APTOS_PACKAGE,
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 120000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(APTOS_PACKAGE, 'i'))
    assert.match(envelope.onRampConfig.typeAndVersion, /1\.6\.0/)
    assert.ok(envelope.onRampConfig.router, 'onRampConfig should have router')
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
  const EVM_ONRAMP = '0x23a5084Fa78104F3DF11C63Ae59fcac4f6AD9DeE'
  const SOLANA_OFFRAMP = 'offqSMQWgQud6WJz694LRzkeN5kMYpCHTpXQr3Rkcjm'
  const SOLANA_ONRAMP = 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C'
  const EVM_OFFRAMP = '0x0820f975ce90EE5c508657F0C58b71D1fcc85cE0'

  it('should show lane config Sepolia -> Solana (v1.6)', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'ethereum-testnet-sepolia',
      'solana-devnet',
      EVM_ONRAMP,
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 120000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(EVM_ONRAMP, 'i'))
    assert.match(envelope.onRampConfig.typeAndVersion, /OnRamp 1\.6\.0/)
    assert.ok(envelope.onRampConfig.router, 'onRampConfig should have router')
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
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 120000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(SOLANA_ONRAMP))
    assert.match(envelope.onRampConfig.typeAndVersion, /1\.6\./)
    assert.ok(envelope.onRampConfig.router, 'onRampConfig should have router')
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
  const TON_ONRAMP = 'EQA-CUZI_USus4w0_Erf-wTj5uhaAR7XldEimU0w0WAJGGod'
  const EVM_ONRAMP_TON = '0xa36871bde0f98b84066405462e4a9709fb71c905'

  it('should show lane config TON -> Sepolia (v1.6)', { timeout: 120000 }, async () => {
    const args = buildLaneArgs(
      'ton-testnet',
      'ethereum-testnet-sepolia',
      TON_ONRAMP,
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 120000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(TON_ONRAMP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(envelope.onRampConfig.typeAndVersion, /1\.6\.0/)
    assert.ok(envelope.onRampConfig.router, 'onRampConfig should have router')
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
      '--format',
      'json',
    )
    const result = await spawnCLI(args, 120000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)

    const envelope = JSON.parse(result.stdout)
    assert.match(envelope.onRamp, new RegExp(EVM_ONRAMP_TON, 'i'))
    assert.match(envelope.onRampConfig.typeAndVersion, /OnRamp 1\.6\.0/)
    assert.ok(envelope.onRampConfig.router, 'onRampConfig should have router')
    assert.match(envelope.offRamp, /^0:[0-9a-fA-F]+$/, 'offRamp should be a raw TON address')
    assert.match(envelope.offRampConfig.typeAndVersion, /1\.6\.0/)
    assert.ok(envelope.offRampConfig.router, 'offRampConfig should have router')
    assert.ok(Array.isArray(envelope.offRampConfig.onRamps))
  })
})
