import util from 'util'

import { AptosChain } from './index.ts'

util.inspect.defaultOptions.depth = 6

describe('AptosChain', () => {
  /* describe('constructor', () => {
    it('should create an AptosChain instance with valid Aptos network', () => {
      const network = networkInfo('aptos:1')
      const chain = new AptosChain(network)

      expect(chain.network).toBe(network)
      expect(chain.network.family).toBe(ChainFamily.Aptos)
    })

    it('should throw error with non-Aptos network', () => {
      const network = {
        chainSelector: 1n,
        name: 'ethereum-mainnet',
        isTestnet: false,
        family: ChainFamily.EVM as any,
        chainId: 1,
      }

      expect(() => new AptosChain(network as any)).toThrow('Invalid network family')
    })
  })

  describe('fromUrl', () => {
    it('should create AptosChain from mainnet URL', async () => {
      const chain = await AptosChain.fromUrl('https://fullnode.mainnet.aptoslabs.com')

      expect(chain).toBeInstanceOf(AptosChain)
      expect(chain.network.name).toBe('aptos-mainnet')
      expect(chain.network.chainId).toBe('aptos:1')
    })

    it('should create AptosChain from testnet URL', async () => {
      const chain = await AptosChain.fromUrl('https://fullnode.testnet.aptoslabs.com')

      expect(chain).toBeInstanceOf(AptosChain)
      expect(chain.network.name).toBe('aptos-testnet')
      expect(chain.network.chainId).toBe('aptos:2')
    })

    it('should create AptosChain from localnet URL', async () => {
      const chain = await AptosChain.fromUrl('http://localhost:8080')

      expect(chain).toBeInstanceOf(AptosChain)
      expect(chain.network.name).toBe('aptos-localnet')
      expect(chain.network.chainId).toBe('aptos:4')
    })
  })

  describe('txFromUrl', () => {
    it('should return chain and transaction promises', () => {
      const [chainPromise, txPromise] = AptosChain.txFromUrl(
        'https://fullnode.mainnet.aptoslabs.com',
        '0x1234567890abcdef',
      )

      expect(chainPromise).toBeInstanceOf(Promise)
      expect(txPromise).toBeInstanceOf(Promise)
    })
  })

  describe('getAddress', () => {
    it('should handle hex string addresses', () => {
      const address = '0x1234567890abcdef'
      const result = AptosChain.getAddress(address)

      expect(result).toBe('0x000000000000000000000000000000000000000000000000001234567890abcdef')
    })

    it('should handle short addresses', () => {
      const address = '0x1'
      const result = AptosChain.getAddress(address)

      expect(result).toBe('0x0000000000000000000000000000000000000000000000000000000000000001')
    })

    it('should handle byte arrays', () => {
      const bytes = new Uint8Array([0x12, 0x34, 0x56, 0x78])
      const result = AptosChain.getAddress(bytes)

      expect(result).toBe('0x0000000000000000000000000000000000000000000000000000000012345678')
    })

    it('should handle addresses without 0x prefix', () => {
      const address = 'abcdef123456'
      const result = AptosChain.getAddress(address)

      expect(result).toBe('0x000000000000000000000000000000000000000000000000000000abcdef123456')
    })
  })

  describe('decodeExtraArgs', () => {
    it('should decode EVMExtraArgsV1 for Aptos', () => {
      // 4 bytes tag (0x181dcf10) + 32 bytes gasLimit
      const extraArgs = '0x181dcf10' + '00'.repeat(28) + '000030d4' // gasLimit = 200000
      const result = AptosChain.decodeExtraArgs(extraArgs)

      expect(result).toEqual({
        _tag: 'EVMExtraArgsV1',
        gasLimit: 200000n,
      })
    })

    it('should decode EVMExtraArgsV2 for Aptos', () => {
      // 4 bytes tag + 32 bytes gasLimit + 1 byte allowOOOE
      const extraArgs = '0x181dcf10' + '00'.repeat(28) + '000030d4' + '01'
      const result = AptosChain.decodeExtraArgs(extraArgs)

      expect(result).toEqual({
        _tag: 'EVMExtraArgsV2',
        gasLimit: 200000n,
        allowOutOfOrderExecution: true,
      })
    })

    it('should return undefined for invalid extra args', () => {
      const extraArgs = '0x12345678' // wrong tag
      const result = AptosChain.decodeExtraArgs(extraArgs)

      expect(result).toBeUndefined()
    })

    it('should return undefined for wrong length', () => {
      const extraArgs = '0x181dcf10' + '1234' // too short
      const result = AptosChain.decodeExtraArgs(extraArgs)

      expect(result).toBeUndefined()
    })
  })

  describe('getDestLeafHasher', () => {
    it('should return hasher for V1_6', () => {
      const lane = {
        sourceChainSelector: 1n,
        destChainSelector: 4741433654826277614n, // aptos mainnet
        onRamp: '0x1234567890abcdef',
        version: '1.6.0' as const,
      }

      const hasher = AptosChain.getDestLeafHasher(lane)
      expect(typeof hasher).toBe('function')
    })

    it('should throw for unsupported version', () => {
      const lane = {
        sourceChainSelector: 1n,
        destChainSelector: 4741433654826277614n,
        onRamp: '0x1234567890abcdef',
        version: '1.2.0' as const,
      }

      expect(() => AptosChain.getDestLeafHasher(lane)).toThrow('Unsupported CCIP version')
    })
  })

  describe('async methods with not implemented error', () => {
    let chain: AptosChain

    beforeEach(() => {
      const network = networkInfo('aptos:1')
      chain = new AptosChain(network)
    })

    it('should throw not implemented for getBlockTimestamp', async () => {
      await expect(chain.getBlockTimestamp(100)).rejects.toThrow(
        'getBlockTimestamp not implemented for Aptos',
      )
    })

    it('should throw not implemented for getTransaction', async () => {
      await expect(chain.getTransaction('0x123')).rejects.toThrow(
        'getTransaction not implemented for Aptos',
      )
    })

    it('should throw not implemented for typeAndVersion', async () => {
      await expect(chain.typeAndVersion('0x123')).rejects.toThrow(
        'typeAndVersion not implemented for Aptos',
      )
    })

    it('should throw not implemented for getLaneForOnRamp', async () => {
      await expect(chain.getLaneForOnRamp('0x123')).rejects.toThrow(
        'getLaneForOnRamp not implemented for Aptos',
      )
    })

    it('should throw not implemented for getWallet', async () => {
      await expect(chain.getWallet()).rejects.toThrow('getWallet not implemented for Aptos')
    })

    it('should throw not implemented for getFee', async () => {
      const message = {
        receiver: '0x123',
        data: '0x',
        extraArgs: { _tag: 'EVMExtraArgsV1' as const, gasLimit: 200000n },
      }
      await expect(chain.getFee('0x123', 1n, message)).rejects.toThrow(
        'getFee not implemented for Aptos',
      )
    })

    it('should throw not implemented for sendMessage', async () => {
      const message = {
        receiver: '0x123',
        data: '0x',
        extraArgs: { _tag: 'EVMExtraArgsV1' as const, gasLimit: 200000n },
        fee: 1000n,
      }
      await expect(chain.sendMessage('0x123', 1n, message)).rejects.toThrow(
        'sendMessage not implemented for Aptos',
      )
    })
  })

  describe('static decode methods', () => {
    const mockLog = {
      topics: ['0x123'],
      index: 0,
      address: '0x456',
      data: '0x789',
      blockNumber: 100,
      transactionHash: '0xabc',
    }

    it('should return undefined for decodeMessage', () => {
      const result = AptosChain.decodeMessage(mockLog)
      expect(result).toBeUndefined()
    })

    it('should return undefined for decodeCommits', () => {
      const result = AptosChain.decodeCommits(mockLog)
      expect(result).toBeUndefined()
    })

    it('should return undefined for decodeReceipt', () => {
      const result = AptosChain.decodeReceipt(mockLog)
      expect(result).toBeUndefined()
    })
  })

  describe('inspect', () => {
    it('should return correct string representation', () => {
      const network = networkInfo('aptos:1')
      const chain = new AptosChain(network)

      const result = chain[util.inspect.custom]()
      expect(result).toBe('AptosChain { network: aptos-mainnet }')
    })
  }) */

  it('my test', async () => {
    const chain = await AptosChain.fromUrl('mainnet')

    // const tokenPool = '0x1eb155d08acc900954b6ccee01659b390399ae81ad4c582b73d41374c475caf6'
    // const token = await chain.getTokenForTokenPool(tokenPool)
    // const info = await chain.getTokenInfo(token)
    // const remoteToken = await chain.getRemoteTokenForTokenPool(tokenPool, 11344663589394136015n)
    // console.log('__token info', token, info, remoteToken)

    for await (const log of chain.getLogs({
      address: '0x20f808de3375db34d17cc946ec6b43fc26962f6afa125182dc903359756caf6b::offramp',
      topics: ['ExecutionStateChanged'],
      startBlock: 3522335390,
    })) {
      const receipt = AptosChain.decodeReceipt(log)
      if (!receipt) continue
      console.log('__log', log, receipt)
    }
  }, 90e3)
})
