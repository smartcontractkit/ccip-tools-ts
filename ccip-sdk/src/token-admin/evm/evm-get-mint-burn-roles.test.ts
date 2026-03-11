import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AbiCoder, Interface, JsonRpcProvider, Network } from 'ethers'

import BurnMintERC20ABI from './abi/BurnMintERC20.ts'
import { EVMTokenAdmin } from './index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'

// ── Helpers ──

const dummyNetwork: NetworkInfo = {
  name: 'test',
  family: ChainFamily.EVM,
  chainSelector: 1n,
  chainId: 1,
  networkType: NetworkType.Testnet,
}

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

function makeAdmin(provider: JsonRpcProvider): EVMTokenAdmin {
  return new EVMTokenAdmin(provider, dummyNetwork, { logger: silentLogger, apiClient: null })
}

const tokenAddress = '0x1234567890abcdef1234567890abcdef12345678'

const MINTER_ROLE_HASH = '0x' + '01'.padStart(64, '0')
const BURNER_ROLE_HASH = '0x' + '02'.padStart(64, '0')

const iface = new Interface(BurnMintERC20ABI)
const coder = AbiCoder.defaultAbiCoder()

/**
 * Creates a mock provider whose `send` method returns ABI-encoded responses
 * based on the function selector in the call data.
 */
function mockProvider(minters: string[], burners: string[]): JsonRpcProvider {
  const minterRoleSelector = iface.getFunction('MINTER_ROLE')!.selector
  const burnerRoleSelector = iface.getFunction('BURNER_ROLE')!.selector
  const getRoleMemberCountSelector = iface.getFunction('getRoleMemberCount')!.selector
  const getRoleMemberSelector = iface.getFunction('getRoleMember')!.selector

  // Use staticNetwork to prevent initial connection attempt
  const provider = new JsonRpcProvider('http://localhost:8545', undefined, {
    staticNetwork: Network.from(1),
  })

  provider.send = async (method: string, params: unknown[]) => {
    if (method !== 'eth_call') return '0x'

    const tx = params[0] as { data: string }
    const data = tx.data

    if (data.startsWith(minterRoleSelector)) {
      return coder.encode(['bytes32'], [MINTER_ROLE_HASH])
    }

    if (data.startsWith(burnerRoleSelector)) {
      return coder.encode(['bytes32'], [BURNER_ROLE_HASH])
    }

    if (data.startsWith(getRoleMemberCountSelector)) {
      const [role] = coder.decode(['bytes32'], '0x' + data.slice(10))
      if (role === MINTER_ROLE_HASH) {
        return coder.encode(['uint256'], [minters.length])
      }
      if (role === BURNER_ROLE_HASH) {
        return coder.encode(['uint256'], [burners.length])
      }
      return coder.encode(['uint256'], [0])
    }

    if (data.startsWith(getRoleMemberSelector)) {
      const [role, index] = coder.decode(['bytes32', 'uint256'], '0x' + data.slice(10))
      const i = Number(index)
      if (role === MINTER_ROLE_HASH && i < minters.length) {
        return coder.encode(['address'], [minters[i]!])
      }
      if (role === BURNER_ROLE_HASH && i < burners.length) {
        return coder.encode(['address'], [burners[i]!])
      }
    }

    return '0x'
  }

  return provider
}

// ── Tests ──

describe('EVMTokenAdmin — getMintBurnRoles', () => {
  describe('getMintBurnRoles — multiple minters and burners', () => {
    const minters = [
      '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa',
      '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
    ]
    const burners = [
      '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
      '0xDDdDddDdDdddDDddDDddDDDDdDdDDdDDdDDDDDDd',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    ]

    const provider = mockProvider(minters, burners)
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should return all minters', async () => {
      const result = await admin.getMintBurnRoles(tokenAddress)
      assert.equal(result.minters.length, 2)
    })

    it('should return all burners', async () => {
      const result = await admin.getMintBurnRoles(tokenAddress)
      assert.equal(result.burners.length, 3)
    })

    it('should return correct minter addresses', async () => {
      const result = await admin.getMintBurnRoles(tokenAddress)
      assert.deepEqual(result.minters, minters)
    })

    it('should return correct burner addresses', async () => {
      const result = await admin.getMintBurnRoles(tokenAddress)
      assert.deepEqual(result.burners, burners)
    })
  })

  describe('getMintBurnRoles — no roles granted', () => {
    const provider = mockProvider([], [])
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should return empty minters array', async () => {
      const result = await admin.getMintBurnRoles(tokenAddress)
      assert.deepEqual(result.minters, [])
    })

    it('should return empty burners array', async () => {
      const result = await admin.getMintBurnRoles(tokenAddress)
      assert.deepEqual(result.burners, [])
    })
  })

  describe('getMintBurnRoles — single minter and single burner', () => {
    const minters = ['0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa']
    const burners = ['0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB']

    const provider = mockProvider(minters, burners)
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should return exactly one minter', async () => {
      const result = await admin.getMintBurnRoles(tokenAddress)
      assert.equal(result.minters.length, 1)
      assert.equal(result.minters[0], minters[0])
    })

    it('should return exactly one burner', async () => {
      const result = await admin.getMintBurnRoles(tokenAddress)
      assert.equal(result.burners.length, 1)
      assert.equal(result.burners[0], burners[0])
    })
  })
})
