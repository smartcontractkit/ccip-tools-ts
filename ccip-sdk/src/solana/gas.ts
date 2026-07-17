import { Buffer } from 'buffer'

import { Program } from '@coral-xyz/anchor'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  getMint,
} from '@solana/spl-token'
import { type AccountMeta, type TransactionInstruction, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import type { BytesLike } from 'ethers'

import type { WithLogger } from '../types.ts'
import { bytesToBuffer, getAddressBytes, getDataBytes, toLeArray } from '../utils.ts'
import { IDL as RECEIVER_IDL } from './idl/1.6.0/CCIP_RECEIVER.ts'
import { resolveATA, simulateTransaction, simulationProvider } from './utils.ts'

const SIMULATION_PAYER = new PublicKey('11111111111111111111111111111112')

type EstimateExecComputeUnitsOpts = {
  connection: Parameters<typeof simulationProvider>[0]['connection']
  router: string
  offRamp: string
  message: {
    sourceChainSelector: bigint
    messageId: string
    receiver: string
    sender?: string
    data?: BytesLike
    tokenReceiver?: string
    destTokenAmounts?: readonly ((
      { token: string } | { destTokenAddress: string; extraData?: string }
    ) & { amount: bigint })[]
    accounts?: readonly string[]
    accountIsWritableBitmap?: bigint
  }
} & WithLogger

function getReceiverRemainingAccounts(
  accounts: readonly string[] | undefined,
  accountIsWritableBitmap: bigint | undefined,
): AccountMeta[] {
  const bitmap = accountIsWritableBitmap ?? 0n
  return (accounts ?? []).map((account, index) => ({
    pubkey: new PublicKey(account),
    isSigner: false,
    isWritable: (bitmap & (1n << BigInt(index))) !== 0n,
  }))
}

async function getTokenSetupInstructions({
  connection,
  message,
  payer,
  logger,
}: {
  connection: EstimateExecComputeUnitsOpts['connection']
  message: EstimateExecComputeUnitsOpts['message']
  payer: PublicKey
} & WithLogger): Promise<TransactionInstruction[]> {
  if (!message.tokenReceiver || !message.destTokenAmounts?.length) return []

  const tokenReceiver = new PublicKey(message.tokenReceiver)
  if (tokenReceiver.equals(PublicKey.default)) return []

  const instructions: TransactionInstruction[] = []
  for (const tokenAmount of message.destTokenAmounts) {
    const mint = new PublicKey(
      'token' in tokenAmount ? tokenAmount.token : tokenAmount.destTokenAddress,
    )
    const { ata, tokenProgram } = await resolveATA(connection, mint, tokenReceiver)
    const mintInfo = await getMint(connection, mint, undefined, tokenProgram)
    if (!mintInfo.mintAuthority) {
      logger?.debug('Skipping Solana token setup; mint has no authority:', mint.toBase58())
      continue
    }

    const ataInfo = await connection.getAccountInfo(ata)
    if (!ataInfo) {
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          payer,
          ata,
          tokenReceiver,
          mint,
          tokenProgram,
        ),
      )
    }

    instructions.push(
      createMintToCheckedInstruction(
        mint,
        ata,
        mintInfo.mintAuthority,
        tokenAmount.amount,
        mintInfo.decimals,
        [],
        tokenProgram,
      ),
    )
  }

  return instructions
}

/**
 * Estimate compute units consumed by a Solana receiver `ccip_receive` callback.
 *
 * This intentionally simulates the receiver callback directly, not full OffRamp execution. The first
 * three accounts follow the standard Solana CCIP receiver convention: OffRamp external execution
 * authority PDA, OffRamp program id, and Router allowed-offramp PDA.
 */
export async function estimateExecComputeUnits({
  connection,
  router,
  offRamp,
  message,
  logger = console,
}: EstimateExecComputeUnitsOpts): Promise<number> {
  const receiver = new PublicKey(message.receiver)
  if (receiver.equals(PublicKey.default)) return 0

  const offRampProgram = new PublicKey(offRamp)
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from('external_execution_config'), receiver.toBuffer()],
    offRampProgram,
  )
  const [allowedOfframp] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('allowed_offramp'),
      Buffer.from(toLeArray(message.sourceChainSelector, 8)),
      offRampProgram.toBuffer(),
    ],
    new PublicKey(router),
  )
  const program = new Program(RECEIVER_IDL, receiver, simulationProvider({ connection, logger }))
  const receiverMessage = {
    messageId: Array.from(getDataBytes(message.messageId)),
    sourceChainSelector: new BN(message.sourceChainSelector.toString()),
    sender: bytesToBuffer(message.sender ? getAddressBytes(message.sender) : []),
    data: bytesToBuffer(message.data ? getDataBytes(message.data) : []),
    tokenAmounts: (message.destTokenAmounts ?? []).map((tokenAmount) => ({
      token: new PublicKey(
        'token' in tokenAmount ? tokenAmount.token : tokenAmount.destTokenAddress,
      ),
      amount: new BN(tokenAmount.amount.toString()),
    })),
  }

  const receiveIx = await program.methods
    .ccipReceive(receiverMessage)
    .accounts({
      authority,
      offrampProgram: offRampProgram,
      allowedOfframp,
    })
    .remainingAccounts(
      getReceiverRemainingAccounts(message.accounts, message.accountIsWritableBitmap),
    )
    .instruction()

  const setupIxs = await getTokenSetupInstructions({
    connection,
    message,
    payer: SIMULATION_PAYER,
    logger,
  }).catch((err: unknown) => {
    logger.debug('Failed to build Solana token setup instructions; simulating receiver only:', err)
    return []
  })

  const simResult = await simulateTransaction(
    { connection, logger },
    { payerKey: SIMULATION_PAYER, instructions: [...setupIxs, receiveIx] },
  )

  let re
  for (const log of (simResult.logs ?? []).toReversed()) {
    re ??= new RegExp(`^Program ${message.receiver} consumed (\\d+)\\b`)
    const match = log.match(re)
    if (match && Number(match[1]) > 0) {
      return Number(match[1])
    }
  }

  return simResult.unitsConsumed ?? 0
}
