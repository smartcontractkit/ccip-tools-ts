import { CCIPVersion } from '../types.ts'

jest.mock('./evm', () => {
  const originalModule = jest.requireActual('./evm')
  return {
    __esModule: true,
    ...originalModule,
    getV12LeafHasher: jest.fn(() => () => 'v12LeafHasher'),
    getV16LeafHasher: jest.fn(() => () => 'v16LeafHasher'),
  }
})
jest.mock('./aptos', () => {
  const originalModule = jest.requireActual('./aptos')
  return {
    __esModule: true,
    ...originalModule,
    getV16AptosLeafHasher: jest.fn(() => () => 'v16AptosLeafHasher'),
  }
})

import { getLeafHasher } from './hasher.ts'

describe('get leaf hasher', () => {
  it('should return the V1_2 EVM leaf hasher when version is CCIPVersion.V1_2', () => {
    const hash = getLeafHasher({
      sourceChainSelector: 1n,
      destChainSelector: 5009297550715157269n, // eth mainnet
      onRamp: 'onRamp',
      version: CCIPVersion.V1_2,
    })
    expect(hash({} as any)).toBe('v12LeafHasher')
  })

  it('should return the V1_6 EVM leaf hasher when version is CCIPVersion.V1_6', () => {
    const hash = getLeafHasher({
      sourceChainSelector: 1n,
      destChainSelector: 5009297550715157269n, // eth mainnet
      onRamp: 'onRamp',
      version: CCIPVersion.V1_6,
    })
    expect(hash({} as any)).toBe('v16LeafHasher')
  })

  it('should return the V1_6 APTOS leaf hasher when version is CCIPVersion.V1_6 with Aptos chain selector', () => {
    const hash = getLeafHasher({
      sourceChainSelector: 1n,
      destChainSelector: 4741433654826277614n, // aptos mainnet
      onRamp: 'onRamp',
      version: CCIPVersion.V1_6,
    })
    expect(hash({} as any)).toBe('v16AptosLeafHasher')
  })

  afterAll(() => {
    jest.clearAllMocks()
  })
})
