import { aptosSelectors, isAptosChain } from './selectors'

describe('selectors', () => {
  it('should idenfify Aptos selectors', () => {
    const selectors = Object.values(aptosSelectors).map((s) => s.selector)
    for (const selector of selectors) {
      expect(isAptosChain(selector)).toBe(true)
    }

    expect(isAptosChain(12n)).toBe(false)
  })
})
