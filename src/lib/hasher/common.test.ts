import { hashInternal } from './common.js'

describe('common hash', () => {
  it('should hash internal values', () => {
    const a = '0x01'
    const b = '0x02'
    const result = hashInternal(a, b)
    expect(result).toBe('0x93b82a55d406c553471937ba1e3176dfdacfc274e84c75b0cbf212388a8bd37b')
  })
})
