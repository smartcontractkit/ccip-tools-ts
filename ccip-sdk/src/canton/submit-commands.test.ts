import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { submitCantonCommands } from './submit-commands.ts'
import type { TransactionSigner } from './types.ts'
import { CantonChain } from './index.ts'

function mockChain(
  getPreferredPackageIds: (...args: unknown[]) => Promise<string[]>,
  executeSubmissionAndWaitForTransaction?: (req: unknown) => Promise<unknown>,
  submitAndWaitForTransaction?: (...args: unknown[]) => Promise<unknown>,
): CantonChain {
  // Real CantonChain instance (private fields make object-literal casts
  // impossible); Object.assign overrides only what the test exercises.
  return Object.assign(Object.create(CantonChain.prototype), {
    provider: {
      getConnectedSynchronizers: async () => [{ synchronizerId: 'sync-1' }],
      getPreferredPackageIds,
      prepareSubmission: async () => ({
        preparedTransaction: 'prepared',
        preparedTransactionHash: '0x1234',
      }),
      executeSubmissionAndWaitForTransaction:
        executeSubmissionAndWaitForTransaction ??
        (async () => ({
          transaction: { updateId: 'update-1' },
        })),
      submitAndWaitForTransaction:
        submitAndWaitForTransaction ??
        (async () => ({
          transaction: { updateId: 'update-1' },
        })),
    },
  })
}

const signer: TransactionSigner = {
  signTxHash: async () => ({ party: 'party::1220ab', signatures: [] }),
}

describe('submitCantonCommands package-name resolution', () => {
  it('includes a CreateAndExerciseCommand template package in packageIdSelectionPreference', async () => {
    let seenPackageNames: string[] = []
    const chain = mockChain(async (_actAs, packageNames) => {
      seenPackageNames = packageNames as string[]
      return ['pkg-id-1']
    })

    await submitCantonCommands(
      chain,
      {
        commands: [
          {
            CreateAndExerciseCommand: {
              templateId:
                '#ccip-registry-burn-mint-token-pool:CCIP.Registry.BurnMintTokenPoolV2:BurnMintTokenPool',
              createArguments: {},
              choice: 'Initialize',
              choiceArgument: {},
            },
          },
        ],
        commandId: 'cmd-1',
        actAs: ['pool-owner::1220ab'],
      },
      signer,
    )

    assert.ok(seenPackageNames.includes('ccip-registry-burn-mint-token-pool'))
  })

  it('derives the interactive submissionId from the commandId, stably across retries', async () => {
    const seenSubmissionIds: string[] = []
    const chain = mockChain(
      async () => ['pkg-id-1'],
      async (req) => {
        seenSubmissionIds.push((req as { submissionId: string }).submissionId)
        return { transaction: { updateId: 'update-1' } }
      },
    )

    const commands = {
      commands: [],
      commandId: 'cct-op-deadbeef',
      actAs: ['pool-owner::1220ab'],
    }
    await submitCantonCommands(chain, commands, signer)
    await submitCantonCommands(chain, commands, signer)

    assert.deepEqual(seenSubmissionIds, ['ext-cct-op-deadbeef', 'ext-cct-op-deadbeef'])
  })
})

describe('submitCantonCommands transaction format', () => {
  const commands = {
    commands: [],
    commandId: 'cct-op-deadbeef',
    actAs: ['pool-owner::1220ab'],
    readAs: ['reader::1220cd'],
  }

  const expectedFormat = {
    eventFormat: {
      filtersByParty: {
        'pool-owner::1220ab': {
          cumulative: [
            { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
          ],
        },
        'reader::1220cd': {
          cumulative: [
            { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
          ],
        },
      },
      verbose: true,
    },
    transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS',
  }

  it('requests ledger effects on the direct path', async () => {
    let seenFormat: unknown
    const chain = mockChain(
      async () => ['pkg-id-1'],
      undefined,
      async (_commands: unknown, transactionFormat: unknown) => {
        seenFormat = transactionFormat
        return { transaction: { updateId: 'update-1' } }
      },
    )

    await submitCantonCommands(chain, commands)
    assert.deepEqual(seenFormat, expectedFormat)
  })

  it('requests ledger effects on the interactive path', async () => {
    let seenFormat: unknown
    const chain = mockChain(
      async () => ['pkg-id-1'],
      async (req) => {
        seenFormat = (req as { transactionFormat: unknown }).transactionFormat
        return { transaction: { updateId: 'update-1' } }
      },
    )

    await submitCantonCommands(chain, commands, signer)
    assert.deepEqual(seenFormat, expectedFormat)
  })
})
