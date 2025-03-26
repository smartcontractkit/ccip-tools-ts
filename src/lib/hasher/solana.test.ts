import { PublicKey } from '@solana/web3.js'
import type { CCIPMessage, CCIPVersion } from '../types.ts'
import { getV16SolanaLeafHasher, hashSolanaMessage, hashSolanaMetadata } from './solana.ts'

describe('solana hasher', () => {
  const msgId = '0xcdad95e113e35cf691295c1f42455d41062ba9a1b96a6280c1a5a678ef801721'
  const solanaKey = new PublicKey('HXoMKDD4hb6VvrgrTZ6kpvJELQrVs4ABgZKTwa1yJNgb')

  // Create a sample message that can be reused across tests
  const createSampleMessage = (): CCIPMessage<typeof CCIPVersion.V1_6> => ({
    header: {
      messageId: msgId,
      sequenceNumber: 386n,
      nonce: 1n,
      sourceChainSelector: 124615329519749607n,
      destChainSelector: 16015286601757825753n,
    },
    sender: solanaKey.toBase58(),
    data: '0x',
    receiver: solanaKey.toBase58(),
    gasLimit: 5000n,
    extraArgs: '0x181dcf1000000000000000000000000000000000138800000000000000', // EVM extra args v2 + borsh encoded args
    feeToken: solanaKey.toBase58(),
    feeTokenAmount: 114310554250104n,
    feeValueJuels: 16499514422603741n,
    tokenAmounts: [
      {
        sourcePoolAddress: solanaKey.toBase58(),
        destTokenAddress: '0xb8d6a6a41d5dd732aec3c438e91523b7613b963b',
        destGasAmount: 10n,
        extraData: '0x0000000000000000000000000000000000000000000000000000000000000012',
        amount: 100000000000000000n,
        destExecData: '0x0a000000', // little-endian encoded uint32(10)
      },
    ],
  })

  it('should hash Solana msg', () => {
    const metadataHash = '0x9b885ffea8ce84fb687f634618c035dac43adc1ad8c9a7c7927ddc7c81581520'
    const msg = createSampleMessage()

    const hash = hashSolanaMessage(msg, metadataHash)
    expect(hash).toEqual('cb5ba35920890620e4d94a66c5fbdd226de9029805d6a044eb3ae984080a3564')
  })

  it('should hash Solana metadata', () => {
    const source = 123456789n
    const dest = 987654321n
    const onrampKey = new PublicKey('HXoMKDD4hb6VvrgrTZ6kpvJELQrVs4ABgZKTwa1yJNgb')
    const onramp = onrampKey.toBase58()
    const msg = createSampleMessage()

    const hash = hashSolanaMetadata(msg, source, dest, onramp)
    expect(hash).toEqual('99e5bf068bd15148d144201a266e8b644307e77034b6eae3ee4b5b75a4427199')
  })

  it('should correctly hash with getV16SolanaLeafHasher', () => {
    // Define chain selectors and onRamp for the test
    const sourceChainSelector = 124615329519749607n
    const destChainSelector = 16015286601757825753n
    const onrampKey = new PublicKey('HXoMKDD4hb6VvrgrTZ6kpvJELQrVs4ABgZKTwa1yJNgb')
    const onramp = onrampKey.toBase58()
    const msg = createSampleMessage()

    // Get the hasher function
    const hasher = getV16SolanaLeafHasher(sourceChainSelector, destChainSelector, onramp)

    // Calculate the expected hash manually
    const metadataHash = hashSolanaMetadata(msg, sourceChainSelector, destChainSelector, onramp)
    const expectedHash = hashSolanaMessage(msg, metadataHash)

    // Get the hash using the hasher
    const actualHash = hasher(msg)

    // Verify the hasher produces the correct result
    expect(actualHash).toEqual(expectedHash)

    // We don't hardcode the expected hash value here because it depends on the implementation
    // which we just verified is consistent between the direct and indirect methods
  })

  // Add a test with a Solana address as destTokenAddress
  it('should handle Solana address as destTokenAddress', () => {
    const sourceChainSelector = 124615329519749607n
    const destChainSelector = 16015286601757825753n
    const onrampKey = new PublicKey('HXoMKDD4hb6VvrgrTZ6kpvJELQrVs4ABgZKTwa1yJNgb')
    const onramp = onrampKey.toBase58()

    // Get the hasher function
    const hasher = getV16SolanaLeafHasher(sourceChainSelector, destChainSelector, onramp)

    // Create a message with a Solana address as destTokenAddress
    const msg = createSampleMessage()
    msg.tokenAmounts[0].destTokenAddress = solanaKey.toBase58() // Use a Solana address

    // This should not throw any errors
    const hash = hasher(msg)
    expect(typeof hash).toBe('string')
    expect(hash.length).toBe(64) // 32 bytes as hex
  })
})
