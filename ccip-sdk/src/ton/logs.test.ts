import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { Address } from '@ton/core'
import type { TonClient, Transaction } from '@ton/ton'

import type { ChainTransaction } from '../types.ts'
import { streamTransactionsForAddress } from './logs.ts'

describe('TON logs unit tests', () => {
  const TEST_ADDRESS = '0:' + '1'.repeat(64)

  // Helper to create mock Transaction
  function createMockTransaction(overrides: Partial<Transaction> = {}): Transaction {
    return {
      address: Address.parse(TEST_ADDRESS),
      lt: 1000n,
      hash: () => Buffer.from('testhash'),
      now: Math.floor(Date.now() / 1000),
      outMessagesCount: 0,
      oldStatus: 'active',
      endStatus: 'active',
      inMessage: undefined,
      outMessages: new Map(),
      totalFees: {
        coins: 0n,
        extraCurrencies: new Map(),
      },
      stateUpdate: {
        oldHash: Buffer.alloc(32),
        newHash: Buffer.alloc(32),
      },
      description: {
        type: 'generic',
        aborted: false,
        creditFirst: false,
        storagePhase: undefined,
        creditPhase: undefined,
        computePhase: {
          type: 'vm',
          success: true,
          messageStateUsed: false,
          accountActivated: false,
          gasFees: 0n,
          gasUsed: 0n,
          gasLimit: 0n,
          gasCredit: undefined,
          mode: 0,
          exitCode: 0,
          exitArg: undefined,
          vmSteps: 0,
          vmInitStateHash: Buffer.alloc(32),
          vmFinalStateHash: Buffer.alloc(32),
        },
        actionPhase: undefined,
        bouncePhase: undefined,
        destroyed: false,
      },
      ...overrides,
    } as Transaction
  }

  // Helper to create mock ChainTransaction
  function createMockChainTransaction(hash: string, blockNumber: number): ChainTransaction {
    return {
      hash,
      logs: [],
      blockNumber,
      timestamp: Math.floor(Date.now() / 1000),
      from: TEST_ADDRESS,
    }
  }

  describe('streamTransactionsForAddress', () => {
    describe('validation', () => {
      it('should throw CCIPLogsAddressRequiredError when address is not provided', async () => {
        const mockProvider = {} as TonClient
        const mockGetTransaction = mock.fn(async () => createMockChainTransaction('hash', 1))

        await assert.rejects(
          async () => {
            for await (const _tx of streamTransactionsForAddress({} as never, {
              provider: mockProvider,
              getTransaction: mockGetTransaction,
            })) {
              // Should not reach here
            }
          },
          {
            name: 'CCIPLogsAddressRequiredError',
          },
        )
      })

      it('should throw CCIPLogsRequiresStartError when no sinceLt cursor is provided', async () => {
        const mockProvider = {} as TonClient
        const mockGetTransaction = mock.fn(async () => createMockChainTransaction('hash', 1))

        await assert.rejects(
          async () => {
            for await (const _tx of streamTransactionsForAddress(
              // sinceLt is required by type; the runtime guard covers untyped callers
              { address: TEST_ADDRESS } as never,
              { provider: mockProvider, getTransaction: mockGetTransaction },
            )) {
              // Should not reach here
            }
          },
          {
            name: 'CCIPLogsRequiresStartError',
          },
        )
      })

      it('should throw CCIPLogsRequiresStartError when watch is true but no sinceLt', async () => {
        const mockProvider = {} as TonClient
        const mockGetTransaction = mock.fn(async () => createMockChainTransaction('hash', 1))

        await assert.rejects(
          async () => {
            for await (const _tx of streamTransactionsForAddress(
              { address: TEST_ADDRESS, watch: true } as never,
              { provider: mockProvider, getTransaction: mockGetTransaction },
            )) {
              // Should not reach here
            }
          },
          {
            name: 'CCIPLogsRequiresStartError',
          },
        )
      })

      it('should throw CCIPLogsWatchRequiresFinalityError when watch is true with fixed endBlock', async () => {
        const mockProvider = {} as TonClient
        const mockGetTransaction = mock.fn(async () => createMockChainTransaction('hash', 1))

        await assert.rejects(
          async () => {
            for await (const _tx of streamTransactionsForAddress(
              {
                address: TEST_ADDRESS,
                sinceLt: 99n,
                endBlock: 500,
                watch: true,
              },
              { provider: mockProvider, getTransaction: mockGetTransaction },
            )) {
              // Should not reach here
            }
          },
          {
            name: 'CCIPLogsWatchRequiresFinalityError',
          },
        )
      })

      it('should throw CCIPLogsWatchRequiresFinalityError when watch is true with endBefore', async () => {
        const mockProvider = {} as TonClient
        const mockGetTransaction = mock.fn(async () => createMockChainTransaction('hash', 1))

        await assert.rejects(
          async () => {
            for await (const _tx of streamTransactionsForAddress(
              {
                address: TEST_ADDRESS,
                sinceLt: 99n,
                endBefore: 'somehash',
                watch: true,
              },
              { provider: mockProvider, getTransaction: mockGetTransaction },
            )) {
              // Should not reach here
            }
          },
          {
            name: 'CCIPLogsWatchRequiresFinalityError',
          },
        )
      })
    })

    describe('forward fetching (with sinceLt)', () => {
      it('should fetch transactions forward when a sinceLt cursor is provided', async () => {
        const tx1 = createMockTransaction({ lt: 1000n, now: 100 })
        const tx2 = createMockTransaction({ lt: 1001n, now: 101 })
        const tx3 = createMockTransaction({ lt: 1002n, now: 102 })

        const getTransactionsMock = mock.fn(async () => [tx1, tx2, tx3])
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 99n,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.equal(results.length, 3)
        assert.equal(mockGetTransaction.mock.calls.length, 3)
        assert.ok(getTransactionsMock.mock.calls.length >= 1)
      })

      it('should apply sinceLt to the first TON transaction page', async () => {
        const belowStart = createMockTransaction({ lt: 99n, now: 99 })
        const atStart = createMockTransaction({ lt: 100n, now: 100 })
        const aboveStart = createMockTransaction({ lt: 101n, now: 101 })

        const getTransactionsMock = mock.fn(async () => [aboveStart, atStart, belowStart])
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 99n,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        const firstCall = getTransactionsMock.mock.calls[0] as unknown as {
          arguments: [Address, { to_lt?: string }]
        }
        assert.equal(firstCall.arguments[1].to_lt, '99', 'to_lt is the exclusive cursor')
        assert.deepEqual(
          results.map((tx) => tx.blockNumber),
          [100, 101],
        )
      })

      it('should truncate transactions newer than endBlock', async () => {
        const tx1 = createMockTransaction({ lt: 1000n, now: 100 })
        const tx2 = createMockTransaction({ lt: 1001n, now: 101 })
        const tx3 = createMockTransaction({ lt: 1002n, now: 102 })

        const getTransactionsMock = mock.fn(async () => [tx3, tx2, tx1])
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 99n,
            endBlock: 1001,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        // Should only include tx1 and tx2, not tx3
        assert.equal(results.length, 2)
      })

      it('should handle pagination correctly with page size limit', async () => {
        const batch1 = Array.from({ length: 10 }, (_, i) =>
          createMockTransaction({ lt: BigInt(1000 + i), now: 100 + i }),
        )
        const batch2 = Array.from({ length: 5 }, (_, i) =>
          createMockTransaction({ lt: BigInt(990 + i), now: 90 + i }),
        )

        let callCount = 0
        const getTransactionsMock = mock.fn(async () => {
          callCount++
          if (callCount === 1) return batch1
          return batch2
        })
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 99n,
            page: 10,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.ok(results.length > 0)
        assert.ok(getTransactionsMock.mock.calls.length >= 1)
      })

      it('should respect negative endBlock (treat as latest)', async () => {
        const tx1 = createMockTransaction({ lt: 1000n, now: 100 })

        const getTransactionsMock = mock.fn(async () => [tx1])
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 99n,
            endBlock: -1,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.equal(results.length, 1)
      })
    })

    describe('explicit origin start (sinceLt=0)', () => {
      it('should fetch transactions forward from the oldest available transaction', async () => {
        const tx1 = createMockTransaction({ lt: 1002n, now: 102 })
        const tx2 = createMockTransaction({ lt: 1001n, now: 101 })
        const tx3 = createMockTransaction({ lt: 1000n, now: 100 })

        const getTransactionsMock = mock.fn(async () => [tx1, tx2, tx3])
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 0n,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.equal(results.length, 3)
        assert.deepEqual(
          results.map((tx) => tx.blockNumber),
          [1000, 1001, 1002],
        )
        assert.equal(mockGetTransaction.mock.calls.length, 3)
      })

      it('should filter transactions by endBlock', async () => {
        const tx1 = createMockTransaction({ lt: 1002n, now: 102 })
        const tx2 = createMockTransaction({ lt: 1001n, now: 101 })
        const tx3 = createMockTransaction({ lt: 1000n, now: 100 })

        const getTransactionsMock = mock.fn(async () => [tx1, tx2, tx3])
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 0n,
            endBlock: 1001,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        // Should only include tx2 and tx3, not tx1
        assert.equal(results.length, 2)
      })

      it('should treat negative endBlock as latest', async () => {
        const tx1 = createMockTransaction({ lt: 1000n, now: 100 })

        const getTransactionsMock = mock.fn(async () => [tx1])
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 0n,
            endBlock: -5,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.equal(results.length, 1)
      })

      it('should handle pagination', async () => {
        const batch1 = Array.from({ length: 10 }, (_, i) =>
          createMockTransaction({ lt: BigInt(1100 - i), now: 1100 - i }),
        )
        const batch2 = Array.from({ length: 5 }, (_, i) =>
          createMockTransaction({ lt: BigInt(1000 - i), now: 1000 - i }),
        )

        let callCount = 0
        const getTransactionsMock = mock.fn(async () => {
          callCount++
          if (callCount === 1) return batch1
          return batch2
        })
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 0n,
            page: 10,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.ok(results.length > 0)
        assert.ok(getTransactionsMock.mock.calls.length >= 2)
      })
    })

    describe('watch mode', () => {
      it('should poll for new transactions in watch mode', async () => {
        const tx1 = createMockTransaction({ lt: 1000n, now: 100 })
        const tx2 = createMockTransaction({ lt: 1001n, now: 101 })

        let callCount = 0
        const getTransactionsMock = mock.fn(async () => {
          callCount++
          if (callCount === 1) return [tx1]
          if (callCount === 2) return [tx2]
          return []
        })
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        // Create a promise that resolves after a short delay to stop watching
        const stopWatch = AbortSignal.timeout(50)

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 99n,
            watch: stopWatch,
            pollInterval: 10,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.ok(results.length >= 1)
      })

      it('should handle watch as boolean true', async () => {
        const tx1 = createMockTransaction({ lt: 1000n, now: 100 })

        let callCount = 0
        const getTransactionsMock = mock.fn(async () => {
          callCount++
          if (callCount === 1) return [tx1]
          return []
        })
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        // Create a promise that resolves quickly to stop the loop
        const stopWatch = AbortSignal.timeout(50)

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 99n,
            watch: stopWatch,
            pollInterval: 10,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.ok(results.length >= 1)
      })

      it('should use custom pollInterval in watch mode', async () => {
        const tx1 = createMockTransaction({ lt: 1000n, now: 100 })

        const getTransactionsMock = mock.fn(async () => [tx1])
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        const stopWatch = AbortSignal.timeout(30)

        const results: ChainTransaction[] = []
        const startTime = performance.now()
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 99n,
            watch: stopWatch,
            pollInterval: 20,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }
        const duration = performance.now() - startTime

        // Should have waited at least one poll interval
        assert.ok(duration >= 20)
      })
    })

    describe('edge cases', () => {
      it('should handle empty transaction list', async () => {
        const getTransactionsMock = mock.fn(async () => [])
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 99n,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.equal(results.length, 0)
        assert.equal(mockGetTransaction.mock.calls.length, 0)
      })

      it('should handle single transaction', async () => {
        const tx1 = createMockTransaction({ lt: 1000n, now: 100 })

        const getTransactionsMock = mock.fn(async () => [tx1])
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 99n,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.equal(results.length, 1)
      })

      it('should correctly parse TON address format', async () => {
        const tx1 = createMockTransaction({ lt: 1000n, now: 100 })

        const getTransactionsMock = mock.fn(async (addr) => {
          // Verify address was parsed correctly
          assert.ok(addr instanceof Address)
          // Don't assert exact string match as Address.toString() may format differently
          return [tx1]
        })
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 99n,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.equal(results.length, 1)
      })

      it('should set endBlock to latest when not provided', async () => {
        const tx1 = createMockTransaction({ lt: 1000n, now: 100 })

        const getTransactionsMock = mock.fn(async () => [tx1])
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 99n,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.equal(results.length, 1)
      })

      it('should handle maximum page size limit', async () => {
        const txs = Array.from({ length: 50 }, (_, i) =>
          createMockTransaction({ lt: BigInt(1000 + i), now: 100 + i }),
        )

        const getTransactionsMock = mock.fn(async (addr, opts) => {
          // For forward mode, limit should be capped at 99
          assert.ok(opts?.limit === undefined || opts.limit <= 99)
          return txs
        })
        const mockProvider = {
          getTransactions: getTransactionsMock,
        } as unknown as TonClient

        const mockGetTransaction = mock.fn(async (tx: Transaction) =>
          createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
        )

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            sinceLt: 99n,
            page: 150, // Should be capped at 99
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.ok(results.length > 0)
      })

      describe('complex scenarios', () => {
        it('should handle multiple batches with mixed timestamps', async () => {
          const batch1 = Array.from({ length: 99 }, (_, i) =>
            createMockTransaction({ lt: BigInt(2000 + i), now: 200 + i }),
          )
          const batch2 = Array.from({ length: 50 }, (_, i) =>
            createMockTransaction({ lt: BigInt(1900 + i), now: 190 + i }),
          )

          let callCount = 0
          const getTransactionsMock = mock.fn(async () => {
            callCount++
            if (callCount === 1) return batch1
            return batch2
          })
          const mockProvider = {
            getTransactions: getTransactionsMock,
          } as unknown as TonClient

          const mockGetTransaction = mock.fn(async (tx: Transaction) =>
            createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
          )

          const results: ChainTransaction[] = []
          for await (const tx of streamTransactionsForAddress(
            {
              address: TEST_ADDRESS,
              sinceLt: 1899n,
            },
            { provider: mockProvider, getTransaction: mockGetTransaction },
          )) {
            results.push(tx)
          }

          assert.ok(results.length > 0)
          assert.ok(getTransactionsMock.mock.calls.length >= 2)
        })

        it('should handle transactions with same logical time', async () => {
          const tx1 = createMockTransaction({ lt: 1000n, now: 100 })
          const tx2 = createMockTransaction({ lt: 1000n, now: 100 })

          const getTransactionsMock = mock.fn(async () => [tx1, tx2])
          const mockProvider = {
            getTransactions: getTransactionsMock,
          } as unknown as TonClient

          const mockGetTransaction = mock.fn(async (tx: Transaction) =>
            createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
          )

          const results: ChainTransaction[] = []
          for await (const tx of streamTransactionsForAddress(
            {
              address: TEST_ADDRESS,
              sinceLt: 99n,
            },
            { provider: mockProvider, getTransaction: mockGetTransaction },
          )) {
            results.push(tx)
          }

          assert.equal(results.length, 2)
        })

        it('should handle very large logical time values', async () => {
          const tx1 = createMockTransaction({ lt: 9007199254740991n, now: 100 }) // Max safe integer

          const getTransactionsMock = mock.fn(async () => [tx1])
          const mockProvider = {
            getTransactions: getTransactionsMock,
          } as unknown as TonClient

          const mockGetTransaction = mock.fn(async (tx: Transaction) =>
            createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
          )

          const results: ChainTransaction[] = []
          for await (const tx of streamTransactionsForAddress(
            {
              address: TEST_ADDRESS,
              sinceLt: 99n,
            },
            { provider: mockProvider, getTransaction: mockGetTransaction },
          )) {
            results.push(tx)
          }

          assert.equal(results.length, 1)
        })

        it('should handle getTransaction throwing errors', async () => {
          const tx1 = createMockTransaction({ lt: 1000n, now: 100 })

          const getTransactionsMock = mock.fn(async () => [tx1])
          const mockProvider = {
            getTransactions: getTransactionsMock,
          } as unknown as TonClient

          const mockGetTransaction = mock.fn(async () => {
            throw new Error('Transaction fetch failed')
          })

          await assert.rejects(
            async () => {
              for await (const _tx of streamTransactionsForAddress(
                {
                  address: TEST_ADDRESS,
                  sinceLt: 99n,
                },
                { provider: mockProvider, getTransaction: mockGetTransaction },
              )) {
                // Should not reach here
              }
            },
            {
              message: 'Transaction fetch failed',
            },
          )
        })

        it('should handle provider.getTransactions throwing errors', async () => {
          const getTransactionsMock = mock.fn(async () => {
            throw new Error('Provider error')
          })
          const mockProvider = {
            getTransactions: getTransactionsMock,
          } as unknown as TonClient

          const mockGetTransaction = mock.fn(async (tx: Transaction) =>
            createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
          )

          await assert.rejects(
            async () => {
              for await (const _tx of streamTransactionsForAddress(
                {
                  address: TEST_ADDRESS,
                  sinceLt: 99n,
                },
                { provider: mockProvider, getTransaction: mockGetTransaction },
              )) {
                // Should not reach here
              }
            },
            {
              message: 'Provider error',
            },
          )
        })

        it('should properly handle endBlock=0', async () => {
          // lt 0 only streams under a before-genesis cursor (-1n); a 0n cursor is
          // exclusive and would skip it (production txs always have lt >= 1 anyway).
          const tx1 = createMockTransaction({ lt: 0n, now: 0 })

          const getTransactionsMock = mock.fn(async () => [tx1])
          const mockProvider = {
            getTransactions: getTransactionsMock,
          } as unknown as TonClient

          const mockGetTransaction = mock.fn(async (tx: Transaction) =>
            createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
          )

          const results: ChainTransaction[] = []
          for await (const tx of streamTransactionsForAddress(
            {
              address: TEST_ADDRESS,
              sinceLt: -1n,
              endBlock: 0,
            },
            { provider: mockProvider, getTransaction: mockGetTransaction },
          )) {
            results.push(tx)
          }

          assert.equal(results.length, 1)
        })

        it('should handle an explicit sinceLt=0 cursor', async () => {
          const tx1 = createMockTransaction({ lt: 1000n, now: 0 })
          const tx2 = createMockTransaction({ lt: 1001n, now: 100 })

          const getTransactionsMock = mock.fn(async () => [tx2, tx1])
          const mockProvider = {
            getTransactions: getTransactionsMock,
          } as unknown as TonClient

          const mockGetTransaction = mock.fn(async (tx: Transaction) =>
            createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
          )

          const results: ChainTransaction[] = []
          for await (const tx of streamTransactionsForAddress(
            {
              address: TEST_ADDRESS,
              sinceLt: 0n,
            },
            { provider: mockProvider, getTransaction: mockGetTransaction },
          )) {
            results.push(tx)
          }

          assert.equal(results.length, 2)
        })

        it('should handle watch cancellation via promise', async () => {
          const tx1 = createMockTransaction({ lt: 1000n, now: 100 })

          const getTransactionsMock = mock.fn(async () => [tx1])
          const mockProvider = {
            getTransactions: getTransactionsMock,
          } as unknown as TonClient

          const mockGetTransaction = mock.fn(async (tx: Transaction) =>
            createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
          )

          const cancelAc = new AbortController()

          const results: ChainTransaction[] = []

          // Start iteration
          const iterator = streamTransactionsForAddress(
            {
              address: TEST_ADDRESS,
              sinceLt: 99n,
              watch: cancelAc.signal,
              pollInterval: 100,
            },
            { provider: mockProvider, getTransaction: mockGetTransaction },
          )

          // Get first transaction
          const first = await iterator.next()
          results.push(first.value)

          // Cancel after short delay
          setTimeout(() => cancelAc.abort(), 10)

          // Try to get more (should stop)
          for await (const tx of iterator) {
            results.push(tx)
          }

          assert.ok(results.length >= 1)
        })

        it('should properly sequence multiple pagination requests', async () => {
          const batches = [
            Array.from({ length: 99 }, (_, i) =>
              createMockTransaction({ lt: BigInt(3000 - i), now: 3000 - i }),
            ),
            Array.from({ length: 99 }, (_, i) =>
              createMockTransaction({ lt: BigInt(2901 - i), now: 2901 - i }),
            ),
            Array.from({ length: 50 }, (_, i) =>
              createMockTransaction({ lt: BigInt(2802 - i), now: 2802 - i }),
            ),
          ]

          let callCount = 0
          const getTransactionsMock = mock.fn(async () => {
            const batch = batches[callCount] || []
            callCount++
            return batch
          })
          const mockProvider = {
            getTransactions: getTransactionsMock,
          } as unknown as TonClient

          const mockGetTransaction = mock.fn(async (tx: Transaction) =>
            createMockChainTransaction(tx.hash().toString('base64'), Number(tx.lt)),
          )

          const results: ChainTransaction[] = []
          for await (const tx of streamTransactionsForAddress(
            {
              address: TEST_ADDRESS,
              sinceLt: 2699n,
              page: 99,
            },
            { provider: mockProvider, getTransaction: mockGetTransaction },
          )) {
            results.push(tx)
          }

          assert.ok(results.length > 0)
          assert.ok(getTransactionsMock.mock.calls.length >= 3)
        })
      })

      describe('meta-driven bounded backfill (v3 index lt list + v2 hydration)', () => {
        // 250 chained txs, lt 1001..1250 ascending, prevTransactionLt chained.
        const N = 250
        const txs = Array.from({ length: N }, (_, i) =>
          createMockTransaction({
            lt: BigInt(1001 + i),
            prevTransactionLt: BigInt(1000 + i),
            now: 1_700_000_000 + i,
            hash: () => {
              const b = Buffer.alloc(32)
              b.writeUInt32LE(i)
              return b
            },
          }),
        )
        const metaOf = (lt: bigint) => ({
          account: TEST_ADDRESS,
          hash: txs[Number(lt) - 1001]!.hash().toString('base64'),
          lt: String(lt),
          now: 1_700_000_000,
          mc_block_seqno: 5000 + Number(lt),
        })
        const metaFactory =
          (lts: bigint[] = txs.map((t) => t.lt), failAt = -1) =>
          (_afterLt: bigint) =>
            (async function* () {
              for (let i = 0; i < lts.length; i++) {
                if (i === failAt) throw new Error('index unavailable')
                yield metaOf(lts[i]!)
              }
            })()

        // v2 getTransactions honoring TonClient's real semantics: a (lt, hash) anchor
        // is EXCLUSIVE unless `inclusive: true`; to_lt is exclusive; descending order.
        function mockV2Provider(dropLts: Set<bigint> = new Set()) {
          const calls: {
            lt?: string
            hash?: string
            to_lt?: string
            limit?: number
            inclusive?: boolean
          }[] = []
          const provider = {
            getTransactions: mock.fn(
              async (
                _addr: unknown,
                opts: {
                  lt?: string
                  hash?: string
                  to_lt?: string
                  limit?: number
                  inclusive?: boolean
                },
              ) => {
                calls.push(opts)
                const toLt = opts.to_lt != null ? BigInt(opts.to_lt) : 0n
                const anchorLt = opts.lt != null ? BigInt(opts.lt) : txs[txs.length - 1]!.lt
                const topBound =
                  opts.lt != null && opts.inclusive !== true ? anchorLt - 1n : anchorLt
                return txs
                  .filter((t) => t.lt <= topBound && t.lt > toLt && !dropLts.has(t.lt))
                  .sort((a, b) => (b.lt > a.lt ? 1 : -1))
                  .slice(0, opts.limit ?? 99)
              },
            ),
          } as unknown as TonClient
          return { provider, calls }
        }

        function collectAll(opts: object, ctx: object) {
          return Array.fromAsync(
            streamTransactionsForAddress(
              { address: TEST_ADDRESS, sinceLt: 1000n, ...opts },
              ctx as never,
            ),
          )
        }

        it('streams forward in ≤100-tx v2 pages stamped with index seqnos', async () => {
          const { provider, calls } = mockV2Provider()
          const seenSeqnos: (number | undefined)[] = []
          const getTransaction = mock.fn(async (tx: Transaction, seqno?: number) => {
            seenSeqnos.push(seqno)
            return createMockChainTransaction(tx.hash().toString('hex'), seqno ?? -1)
          })
          const results = await collectAll({}, { provider, getTransaction, v3Meta: metaFactory() })
          assert.equal(results.length, N)
          // ascending lt order preserved end to end
          assert.ok(
            results.every((r, i) => i === 0 || r.blockNumber >= results[i - 1]!.blockNumber),
            'ascending',
          )
          // 100+100+50 = 3 hydration pages, each anchored at the chunk's newest lt
          assert.equal(calls.length, 3)
          assert.deepEqual(
            calls.map((c) => c.lt),
            ['1100', '1200', '1250'],
          )
          assert.deepEqual(
            calls.map((c) => c.to_lt),
            ['1000', '1100', '1200'],
          )
          // every tx stamped with the index's mc seqno (5000 + lt), no per-tx resolution
          assert.equal(seenSeqnos[0], 6001)
          assert.equal(seenSeqnos[N - 1], 6250)
          assert.ok(seenSeqnos.every((s) => s !== undefined))
        })

        it('caps the window at endBlock (notAfter)', async () => {
          const { provider } = mockV2Provider()
          const getTransaction = mock.fn(async (tx: Transaction, seqno?: number) =>
            createMockChainTransaction('h', seqno ?? -1),
          )
          const results = await collectAll(
            { endBlock: 1150n },
            { provider, getTransaction, v3Meta: metaFactory() },
          )
          assert.equal(results.length, 150)
          assert.equal(results[results.length - 1]!.blockNumber, 6150)
        })

        it('throws CCIPLogsStreamInconsistentError when the v2 page disagrees with the index', async () => {
          const { provider } = mockV2Provider(new Set([1050n])) // v2 page missing one tx
          await assert.rejects(
            collectAll(
              {},
              {
                provider,
                getTransaction: mock.fn(async (tx: Transaction, seqno?: number) =>
                  createMockChainTransaction('h', seqno ?? -1),
                ),
                v3Meta: metaFactory(),
              },
            ),
            { name: 'CCIPLogsStreamInconsistentError' },
          )
        })

        it('throws CCIPLogsStreamInconsistentError when the account chain link breaks', async () => {
          // lt 1051 points past its true predecessor — a mid-window indexing gap
          const broken = txs.map((t) =>
            t.lt === 1051n
              ? createMockTransaction({ ...t, lt: t.lt, prevTransactionLt: 1049n })
              : t,
          )
          const { provider, calls } = mockV2Provider()
          provider.getTransactions = mock.fn(
            async (_a: unknown, opts: { lt?: string; to_lt?: string; limit?: number }) => {
              const toLt = opts.to_lt != null ? BigInt(opts.to_lt) : 0n
              const anchorLt = opts.lt != null ? BigInt(opts.lt) : broken[broken.length - 1]!.lt
              calls.push(opts)
              return broken
                .filter((t) => t.lt <= anchorLt && t.lt > toLt)
                .sort((a, b) => (b.lt > a.lt ? 1 : -1))
                .slice(0, opts.limit ?? 99)
            },
          )
          await assert.rejects(
            collectAll(
              {},
              {
                provider,
                getTransaction: mock.fn(async (tx: Transaction, seqno?: number) =>
                  createMockChainTransaction('h', seqno ?? -1),
                ),
                v3Meta: metaFactory(),
              },
            ),
            { name: 'CCIPLogsStreamInconsistentError' },
          )
        })

        it('falls back to the legacy collect-all walk when the index fails before any yield', async () => {
          const { provider, calls } = mockV2Provider()
          const seenSeqnos: (number | undefined)[] = []
          const getTransaction = mock.fn(async (tx: Transaction, seqno?: number) => {
            seenSeqnos.push(seqno)
            return createMockChainTransaction('h', 1)
          })
          const results = await collectAll(
            {},
            { provider, getTransaction, v3Meta: metaFactory(undefined, 0) },
          )
          assert.equal(results.length, N)
          // legacy proof: the first page call paginates backward from the tip — no anchor
          assert.equal(calls[0]!.lt, undefined)
          assert.equal(calls[0]!.to_lt, '1000')
          // legacy path carries no index seqnos — the caller resolves them per tx
          assert.ok(seenSeqnos.every((s) => s === undefined))
        })

        it('uses the legacy walk when no v3Meta is provided', async () => {
          const { provider, calls } = mockV2Provider()
          const results = await collectAll(
            {},
            {
              provider,
              getTransaction: mock.fn(async (_tx: Transaction) =>
                createMockChainTransaction('h', 1),
              ),
            },
          )
          assert.equal(results.length, N)
          assert.equal(calls[0]!.lt, undefined)
        })
      })
    })
  })
})
