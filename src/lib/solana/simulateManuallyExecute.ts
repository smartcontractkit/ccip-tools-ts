import {
  type AddressLookupTableAccount,
  type Connection,
  type PublicKey,
  type SimulateTransactionConfig,
  type TransactionInstruction,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'

export const simulateUnitsConsumed = async ({
  instructions,
  connection,
  payerKey,
  addressLookupTableAccounts = [],
  computeUnitsOverride,
}: {
  instructions: TransactionInstruction[]
  connection: Connection
  payerKey: PublicKey
  addressLookupTableAccounts?: AddressLookupTableAccount[]
  computeUnitsOverride?: number
}): Promise<number> => {
  try {
    // Add max compute units for simulation
    const maxComputeUnits = 1_400_000
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: computeUnitsOverride || maxComputeUnits,
    })

    // Create message with compute budget instruction
    const message = new TransactionMessage({
      payerKey,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions: [computeBudgetIx, ...instructions],
    })

    const messageV0 = message.compileToV0Message(addressLookupTableAccounts)
    const simulationTx = new VersionedTransaction(messageV0)

    const config: SimulateTransactionConfig = {
      commitment: 'confirmed',
      replaceRecentBlockhash: true,
      sigVerify: false,
    }

    const simulation = await connection.simulateTransaction(simulationTx, config)

    console.info('Simulation results:', {
      logs: simulation.value.logs,
      unitsConsumed: simulation.value.unitsConsumed,
      returnData: simulation.value.returnData,
      err: simulation.value.err,
    })

    if (simulation.value.err) {
      throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`)
    }

    return simulation.value.unitsConsumed || 0
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Transaction simulation error: ${error.message}`)
    }

    throw new Error('Transaction simulation error: Unknown error occurred')
  }
}
