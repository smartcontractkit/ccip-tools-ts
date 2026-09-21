import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { submitCantonCommands } from './submit-commands.ts'
import type { TransactionSigner } from './types.ts'
import type { CantonChain } from './index.ts'

function mockChain(getPreferredPackageIds: (...args: unknown[]) => Promise<string[]>): CantonChain {
  return {
    provider: {
      getConnectedSynchronizers: async () => [{ synchronizerId: 'sync-1' }],
      getPreferredPackageIds,
      prepareSubmission: async () => ({
        preparedTransaction: 'prepared',
        preparedTransactionHash: '0x1234',
      }),
      executeSubmissionAndWaitForTransaction: async () => ({
        transaction: { updateId: 'update-1' },
      }),
    },
  } as unknown as CantonChain
}

const signer: TransactionSigner = { sign: async () => ({ signatures: [] }) }

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
})
