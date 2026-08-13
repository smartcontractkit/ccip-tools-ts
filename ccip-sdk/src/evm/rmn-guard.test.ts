import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { AbiCoder, ZeroAddress, getAddress, hexlify, randomBytes } from 'ethers'

import { interfaces } from './const.ts'
import { EVMChain } from './index.ts'
import { ChainFamily, NetworkType } from '../networks.ts'
import { CCIPVersion } from '../types.ts'

// Regression test for a dead guard: `!rmnProxy && rmnProxy === ZeroAddress` can never be true
// (empty/undefined fails the second check, ZeroAddress fails the first), so getRmn always
// proceeded to call getARM() on whatever address it was given — including '' and the zero
// address, both of which fail before/at the network call.
const offRampIface = interfaces.OffRamp_v1_6
const rmnProxyIface = interfaces.RMNProxy
const GET_STATIC_CONFIG_SEL = offRampIface.getFunction('getStaticConfig')!.selector
const GET_DYNAMIC_CONFIG_SEL = offRampIface.getFunction('getDynamicConfig')!.selector
const GET_SOURCE_CHAIN_CONFIG_SEL = offRampIface.getFunction('getSourceChainConfig')!.selector
const GET_ARM_SEL = rmnProxyIface.getFunction('getARM')!.selector

const SOURCE_SELECTOR = 16015286601757825753n // ethereum-sepolia
const DEST_SELECTOR = 10344971235874465080n // base-sepolia

function makeChain(rmnRemote: string, getArmResult?: string) {
  const staticConfig = {
    chainSelector: DEST_SELECTOR,
    gasForCallExactCheck: 5000,
    rmnRemote,
    tokenAdminRegistry: getAddress(hexlify(randomBytes(20))),
    nonceManager: getAddress(hexlify(randomBytes(20))),
  }
  const dynamicConfig = {
    feeQuoter: getAddress(hexlify(randomBytes(20))),
    permissionLessExecutionThresholdSeconds: 0,
    messageInterceptor: ZeroAddress,
  }
  const sourceChainConfig = {
    router: getAddress(hexlify(randomBytes(20))),
    isEnabled: true,
    minSeqNr: 1n,
    isRMNVerificationDisabled: false,
    onRamp: AbiCoder.defaultAbiCoder().encode(['address'], [getAddress(hexlify(randomBytes(20)))]),
  }

  const getArmCalls: string[] = []
  const provider = {
    call: mock.fn(async (tx: { to?: string; data?: string }) => {
      const data = tx.data ?? '0x'
      const sel = data.slice(0, 10)
      if (sel === GET_STATIC_CONFIG_SEL)
        return offRampIface.encodeFunctionResult('getStaticConfig', [staticConfig])
      if (sel === GET_DYNAMIC_CONFIG_SEL)
        return offRampIface.encodeFunctionResult('getDynamicConfig', [dynamicConfig])
      if (sel === GET_SOURCE_CHAIN_CONFIG_SEL)
        return offRampIface.encodeFunctionResult('getSourceChainConfig', [sourceChainConfig])
      if (sel === GET_ARM_SEL) {
        getArmCalls.push(tx.to!)
        return rmnProxyIface.encodeFunctionResult('getARM', [getArmResult ?? ZeroAddress])
      }
      throw new Error(`unexpected call, selector=${sel}`)
    }),
  }

  const chain = Object.create(EVMChain.prototype) as EVMChain
  Object.assign(chain, {
    provider,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    network: {
      name: 'base-sepolia',
      chainId: 84532,
      chainSelector: DEST_SELECTOR,
      family: ChainFamily.EVM,
      networkType: NetworkType.Testnet,
    },
    typeAndVersion: mock.fn(async () => [
      'OffRamp',
      CCIPVersion.V1_6,
      'OffRamp 1.6.0',
    ]) as unknown as EVMChain['typeAndVersion'],
  })
  return { chain, provider, getArmCalls }
}

describe('getOffRampConfig RMN guard', () => {
  it('rmnRemote === ZeroAddress: skips getARM entirely, no rmn field', async () => {
    const { chain, provider } = makeChain(ZeroAddress)
    const config = await chain.getOffRampConfig(
      getAddress(hexlify(randomBytes(20))),
      SOURCE_SELECTOR,
    )
    assert.equal('rmn' in config, false)
    assert.equal(
      provider.call.mock.calls.some((c) => (c.arguments[0].data ?? '').startsWith(GET_ARM_SEL)),
      false,
    )
  })

  it('rmnRemote set and getARM() returns a real address: rmn field is populated', async () => {
    const rmn = getAddress(hexlify(randomBytes(20)))
    const rmnRemote = getAddress(hexlify(randomBytes(20)))
    const { chain } = makeChain(rmnRemote, rmn)
    const config = await chain.getOffRampConfig(
      getAddress(hexlify(randomBytes(20))),
      SOURCE_SELECTOR,
    )
    assert.equal(config.rmn, rmn)
  })

  it('rmnRemote set but getARM() itself resolves to ZeroAddress: no rmn field', async () => {
    const rmnRemote = getAddress(hexlify(randomBytes(20)))
    const { chain } = makeChain(rmnRemote, ZeroAddress)
    const config = await chain.getOffRampConfig(
      getAddress(hexlify(randomBytes(20))),
      SOURCE_SELECTOR,
    )
    assert.equal('rmn' in config, false)
  })
})
