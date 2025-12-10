import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { concat, keccak256 } from 'ethers'

import { testVectors } from './__mocks__/merklemultiTestVectors.ts'
import { ZERO_HASH, hashInternal } from './common.ts'
import { Proof, Tree, verifyComputeRoot } from './merklemulti.ts'

// import { CombinationGenerator } from './utils'

const a = keccak256('0x0a')
const b = keccak256('0x0b')
const c = keccak256('0x0c')
const d = keccak256('0x0d')
const e = keccak256('0x0e')
const f = keccak256('0x0f')

/**
 * CombinationGenerator generates unique combinations of 'k' elements from a set of 'n' elements.
 */
class CombinationGenerator {
  private n: number // Total number of elements to choose from
  private k: number // Size of each combination
  private currentCombination: number[] // Current combination
  private done: boolean // Flag to indicate if all combinations have been generated

  /**
   * Creates a new CombinationGenerator instance.
   * @param n - Total number of elements to choose from.
   * @param k - Size of each combination.
   */
  constructor(n: number, k: number) {
    this.n = n
    this.k = k
    this.currentCombination = Array.from({ length: k }, (_, index) => index) // Initialize with the first combination
    this.done = false // Initially, not all combinations are generated
  }

  /**
   * Generates the next unique combination.
   * @returns True if a new combination was generated, false if all combinations are exhausted.
   */
  next(): boolean {
    if (this.done) {
      return false // All combinations have been generated
    }

    let i = this.k - 1
    // Find the rightmost element that can be incremented
    while (i >= 0 && this.currentCombination[i] === this.n - this.k + i) {
      i--
    }

    if (i === -1) {
      this.done = true // All combinations have been generated
      return false
    }

    // Increment the element found above and adjust the rest
    this.currentCombination[i]++
    for (let j = i + 1; j < this.k; j++) {
      this.currentCombination[j] = this.currentCombination[i] + j - i
    }

    return true // A new combination was generated
  }

  /**
   * Returns the current combination.
   * @returns An array representing the current combination.
   */
  combination(): number[] {
    return [...this.currentCombination]
  }
}

describe('Merkle multi basic tests', () => {
  it('should error when not all proofs can be used', () => {
    const leaves = [a, b]
    const proofs = [c, d]
    const sourceFlags: boolean[] = [false, true, true]

    try {
      const proof = new Proof(proofs, sourceFlags)
      verifyComputeRoot(leaves, proof)
      assert.fail('Expected an error to be thrown')
    } catch (err: unknown) {
      assert.equal((err as Error).message, 'Proof source flags 1 != proof hashes 2')
    }
  })

  it('should correctly pad tree layers', () => {
    const tr4 = new Tree([a, b, c])
    assert.equal(tr4.layers[0].length, 4)

    const tr8 = new Tree([a, b, c, d, e])
    assert.equal(tr8.layers[0].length, 6)
    assert.equal(tr8.layers[1].length, 4)

    const expected = hashInternal(
      hashInternal(hashInternal(a, b), hashInternal(c, d)),
      hashInternal(hashInternal(e, ZERO_HASH), ZERO_HASH),
    )

    assert.equal(tr8.root(), expected)

    const p = tr8.prove([0])
    const h = verifyComputeRoot([a], p)
    assert.equal(h, tr8.root())
  })

  it('should test MerkleMulti proof second preimage', () => {
    // Create a Merkle tree with leaves 'a' and 'b'
    const tr = new Tree([a, b])
    assert.ok(tr)

    // Generate a proof for the first leaf (index 0)
    const pr = tr.prove([0])
    assert.ok(pr)

    // Verify the proof to get the root
    const proofResult = verifyComputeRoot([a], pr)

    // Ensure the computed root matches the original tree's root
    assert.equal(proofResult, tr.root())

    // Create another Merkle tree with a combined hash of 'a' and 'b'
    const combinedHash = keccak256(concat([a, b]))
    const tr2 = new Tree([combinedHash])
    assert.ok(tr2)

    // Ensure the root of the second tree is not equal to the root of the first tree
    assert.notEqual(tr2.root(), tr.root())
  })

  it('should correctly create a tree', () => {
    testVectors.forEach((test) => {
      const tr = new Tree(test.AllLeafs)
      assert.equal(tr.root(), test.ExpectedRoot)
    })
  })

  it('should verify proof for each test vector', () => {
    testVectors.forEach((test) => {
      const computedRoot = verifyComputeRoot(
        test.ProofLeaves,
        new Proof(test.ProofHashes, test.ProofFlags),
      )
      assert.equal(computedRoot, test.ExpectedRoot)
    })
  })
})

describe('Merkle multi proof for trees of various sizes', () => {
  const leafHashes = [a, b, c, d, e, f]
  const expectedRoots = [
    a,
    hashInternal(a, b),
    hashInternal(hashInternal(a, b), hashInternal(c, ZERO_HASH)),
    hashInternal(hashInternal(a, b), hashInternal(c, d)),
    hashInternal(
      hashInternal(hashInternal(a, b), hashInternal(c, d)),
      hashInternal(hashInternal(e, ZERO_HASH), ZERO_HASH),
    ),
    hashInternal(
      hashInternal(hashInternal(a, b), hashInternal(c, d)),
      hashInternal(hashInternal(e, f), ZERO_HASH),
    ),
  ]

  for (let length = 1; length <= leafHashes.length; length++) {
    it(`should compute Merkle root for tree of size ${length}`, () => {
      const tr = new Tree(leafHashes.slice(0, length))
      assert.equal(tr.root(), expectedRoots[length - 1])

      for (let k = 1; k <= length; k++) {
        const gen = new CombinationGenerator(length, k)

        while (gen.next()) {
          const leaveIndices = gen.combination()
          const proof = tr.prove(leaveIndices)
          const leavesToProve = leaveIndices.map((idx: number) => leafHashes[idx])

          const root = verifyComputeRoot(leavesToProve, proof)
          assert.equal(root, expectedRoots[length - 1])
        }
      }
    })
  }
})
