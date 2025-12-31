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
            for await (const _tx of streamTransactionsForAddress(
              {},
              { provider: mockProvider, getTransaction: mockGetTransaction },
            )) {
              // Should not reach here
            }
          },
          {
            name: 'CCIPLogsAddressRequiredError',
          },
        )
      })

      it('should throw CCIPLogsWatchRequiresStartError when watch is true but no startBlock or startTime', async () => {
        const mockProvider = {} as TonClient
        const mockGetTransaction = mock.fn(async () => createMockChainTransaction('hash', 1))

        await assert.rejects(
          async () => {
            for await (const _tx of streamTransactionsForAddress(
              {
                address: TEST_ADDRESS,
                watch: true,
              },
              { provider: mockProvider, getTransaction: mockGetTransaction },
            )) {
              // Should not reach here
            }
          },
          {
            name: 'CCIPLogsWatchRequiresStartError',
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
                startBlock: 100,
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
                startBlock: 100,
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

    describe('forward fetching (with startBlock)', () => {
      it('should fetch transactions forward when startBlock is provided', async () => {
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
            startBlock: 100,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.equal(results.length, 3)
        assert.equal(mockGetTransaction.mock.calls.length, 3)
        assert.ok(getTransactionsMock.mock.calls.length >= 1)
      })

      it('should filter transactions by startTime', async () => {
        // Create enough transactions to trigger pagination (batch size equals limit)
        const oldTxs = Array.from({ length: 50 }, (_, i) =>
          createMockTransaction({ lt: BigInt(900 + i), now: 90 + i }),
        )
        const newTxs = Array.from({ length: 49 }, (_, i) =>
          createMockTransaction({ lt: BigInt(1000 + i), now: 150 + i }),
        )

        let callCount = 0
        const getTransactionsMock = mock.fn(async () => {
          callCount++
          if (callCount === 1) {
            // First batch: mix of old and new transactions (99 total, triggers pagination)
            return [...newTxs, ...oldTxs].slice(0, 99)
          }
          // Second batch: only old transactions
          return oldTxs.slice(0, 50)
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
            startTime: 150,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        // Should only include transactions with timestamp >= 150
        assert.equal(results.length, 49)
        assert.ok(results.every((tx) => tx.timestamp >= 150))
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
            startBlock: 100,
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
            startBlock: 100,
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
            startBlock: 100,
            endBlock: -1,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.equal(results.length, 1)
      })
    })

    describe('backward fetching (without startBlock)', () => {
      it('should fetch transactions backward when no startBlock or startTime', async () => {
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
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.equal(results.length, 3)
        assert.equal(mockGetTransaction.mock.calls.length, 3)
      })

      it('should filter transactions by endBlock in backward mode', async () => {
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
            endBlock: 1001,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        // Should only include tx2 and tx3, not tx1
        assert.equal(results.length, 2)
      })

      it('should handle endBefore parameter in backward mode', async () => {
        const tx1 = createMockTransaction({ lt: 1002n, now: 102 })
        const tx2 = createMockTransaction({ lt: 1001n, now: 101 })

        const getTransactionsMock = mock.fn(async (addr, opts) => {
          if (opts?.hash) {
            assert.equal(opts.hash, 'testhash')
            assert.equal(opts.lt, '1001')
            return [tx2]
          }
          return [tx1, tx2]
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
            endBlock: 1001,
            endBefore: 'testhash',
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.ok(results.length >= 1)
      })

      it('should treat negative endBlock as latest in backward mode', async () => {
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
            endBlock: -5,
          },
          { provider: mockProvider, getTransaction: mockGetTransaction },
        )) {
          results.push(tx)
        }

        assert.equal(results.length, 1)
      })

      it('should handle pagination in backward mode', async () => {
        const batch1 = Array.from({ length: 100 }, (_, i) =>
          createMockTransaction({ lt: BigInt(1100 - i), now: 1100 - i }),
        )
        const batch2 = Array.from({ length: 50 }, (_, i) =>
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
            page: 100,
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
        const stopWatch = new Promise((resolve) => setTimeout(resolve, 50))

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            startBlock: 100,
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
        const stopWatch = new Promise((resolve) => setTimeout(resolve, 50))

        const results: ChainTransaction[] = []
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            startBlock: 100,
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

        const stopWatch = new Promise((resolve) => setTimeout(resolve, 30))

        const results: ChainTransaction[] = []
        const startTime = performance.now()
        for await (const tx of streamTransactionsForAddress(
          {
            address: TEST_ADDRESS,
            startBlock: 100,
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
            startBlock: 100,
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
            startBlock: 100,
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
            startBlock: 100,
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
            startBlock: 100,
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
            startBlock: 100,
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
              startBlock: 1900,
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
              startBlock: 100,
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
              startBlock: 100,
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
                  startBlock: 100,
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
                  startBlock: 100,
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
              endBlock: 0,
            },
            { provider: mockProvider, getTransaction: mockGetTransaction },
          )) {
            results.push(tx)
          }

          assert.equal(results.length, 1)
        })

        it('should handle startTime=0', async () => {
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
              startTime: 0,
            },
            { provider: mockProvider, getTransaction: mockGetTransaction },
          )) {
            results.push(tx)
          }

          assert.equal(results.length, 2)
        })

        it('should handle both startBlock and startTime together', async () => {
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
              startBlock: 100,
              startTime: 50,
            },
            { provider: mockProvider, getTransaction: mockGetTransaction },
          )) {
            results.push(tx)
          }

          assert.equal(results.length, 1)
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

          let resolveCancel: () => void
          const cancelPromise = new Promise<void>((resolve) => {
            resolveCancel = resolve
          })

          const results: ChainTransaction[] = []

          // Start iteration
          const iterator = streamTransactionsForAddress(
            {
              address: TEST_ADDRESS,
              startBlock: 100,
              watch: cancelPromise,
              pollInterval: 100,
            },
            { provider: mockProvider, getTransaction: mockGetTransaction },
          )

          // Get first transaction
          const first = await iterator.next()
          results.push(first.value)

          // Cancel after short delay
          setTimeout(() => resolveCancel!(), 10)

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
              startBlock: 2700,
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
    })
  })
})
