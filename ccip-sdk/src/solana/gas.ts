import { Buffer } from 'buffer'

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  getMint,
} from '@solana/spl-token'
import {
  type AccountMeta,
  type Connection,
  type TransactionInstruction,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js'
import BN from 'bn.js'
import type { BytesLike } from 'ethers'

import { CCIPSolanaReceiverRegistryInvalidError } from '../errors/index.ts'
import type { WithLogger } from '../types.ts'
import { bytesToBuffer, getAddressBytes, getDataBytes, toLeArray } from '../utils.ts'
import { newProgram, sizedCoder } from './coder.ts'
import { SVMTokenReceiverUsage } from './extra-args.ts'
import { IDL as RECEIVER_IDL } from './idl/1.6.0/CCIP_RECEIVER.ts'
import { IDL as RECEIVER_V2_IDL } from './idl/2.0.0/CCIP_RECEIVER.ts'
import { IDL as CCIP_ROUTER_V2_IDL } from './idl/2.0.0/CCIP_ROUTER.ts'
import { resolveATA, simulateTransaction, simulationProvider } from './utils.ts'

const routerV2Coder = sizedCoder(CCIP_ROUTER_V2_IDL)

// Anchor enum values of the v2 receiver IDL's `SVMTokenReceiverUsage`, by its numeric value
const TOKEN_RECEIVER_USAGE_VARIANTS = {
  [SVMTokenReceiverUsage.DeriveAtaAndCreate]: { deriveAtaAndCreate: {} },
  [SVMTokenReceiverUsage.DeriveAtaDontCreate]: { deriveAtaDontCreate: {} },
  [SVMTokenReceiverUsage.UseAsIs]: { useAsIs: {} },
} as const

/**
 * A Solana receiver's CCIP interface version: 1 is called through `ccip_receive`, 2 through
 * `ccip_receive_v2`.
 */
export type SolanaReceiverVersion = 1 | 2

/**
 * Reads a receiver's CCIP interface version from the router's `ReceiverRegistry`, the way a 2.0
 * OffRamp picks which entrypoint to call: an absent (or System-owned) registry means v1, otherwise
 * its `receiverVersion` decides. 1.6 OffRamps always call `ccip_receive`, so only ask this for a
 * 2.0 OffRamp.
 * @param connection - Solana connection
 * @param router - Router program the registry PDA is derived under
 * @param receiver - Receiver program
 * @returns the receiver's interface version
 * @throws {@link CCIPSolanaReceiverRegistryInvalidError} if the registry account exists but isn't
 *   a `ReceiverRegistry` of a known schema version (the OffRamp rejects such a message)
 */
export async function getReceiverVersion(
  connection: Pick<Connection, 'getAccountInfo'>,
  router: string,
  receiver: string,
): Promise<SolanaReceiverVersion> {
  const [registry] = PublicKey.findProgramAddressSync(
    [Buffer.from('receiver_registry'), new PublicKey(receiver).toBuffer()],
    new PublicKey(router),
  )
  const info = await connection.getAccountInfo(registry)
  if (!info || info.owner.equals(SystemProgram.programId)) return 1
  const context = { registry: registry.toBase58(), receiver }
  let decoded: { version: number; receiverVersion: number }
  try {
    decoded = routerV2Coder.accounts.decode('receiverRegistry', info.data)
  } catch (cause) {
    throw new CCIPSolanaReceiverRegistryInvalidError(
      { ...context, reason: cause instanceof Error ? cause.message : String(cause) },
      { cause: cause instanceof Error ? cause : undefined },
    )
  }
  if (decoded.version !== 1)
    throw new CCIPSolanaReceiverRegistryInvalidError({
      ...context,
      reason: `unknown schema version ${decoded.version}`,
    })
  return decoded.receiverVersion === 2 ? 2 : 1
}

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
      | { token: string }
      | { destTokenAddress: string; extraData?: string }
    ) & { amount: bigint })[]
    accounts?: readonly string[]
    accountIsWritableBitmap?: bigint
  }
  /** Receiver interface to call (see {@link getReceiverVersion}); default 1 (`ccip_receive`) */
  receiverVersion?: SolanaReceiverVersion
  /** v2 only: how the OffRamp delivers the tokens to `tokenReceiver`; default `DeriveAtaAndCreate` */
  tokenReceiverUsage?: SVMTokenReceiverUsage
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
 * Estimate compute units consumed by a Solana receiver's `ccip_receive` (v1) or `ccip_receive_v2`
 * (v2) callback, per `receiverVersion`.
 *
 * This intentionally simulates the receiver callback directly, not full OffRamp execution. The first
 * three accounts follow the standard Solana CCIP receiver convention, the same for both interface
 * versions: OffRamp external execution authority PDA, OffRamp program id, and Router
 * allowed-offramp PDA.
 */
export async function estimateExecComputeUnits({
  connection,
  router,
  offRamp,
  message,
  receiverVersion = 1,
  tokenReceiverUsage = SVMTokenReceiverUsage.DeriveAtaAndCreate,
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
  const tokenAmounts = (message.destTokenAmounts ?? []).map((tokenAmount) => ({
    token: new PublicKey('token' in tokenAmount ? tokenAmount.token : tokenAmount.destTokenAddress),
    amount: new BN(tokenAmount.amount.toString()),
  }))
  const receiverMessage = {
    messageId: Array.from(getDataBytes(message.messageId)),
    sourceChainSelector: new BN(message.sourceChainSelector.toString()),
    sender: bytesToBuffer(message.sender ? getAddressBytes(message.sender) : []),
    data: bytesToBuffer(message.data ? getDataBytes(message.data) : []),
  }
  const accounts = { authority, offrampProgram: offRampProgram, allowedOfframp }
  const remainingAccounts = getReceiverRemainingAccounts(
    message.accounts,
    message.accountIsWritableBitmap,
  )
  const provider = simulationProvider({ connection, logger })

  let receiveIx
  if (receiverVersion === 2) {
    // a 2.0 message carries at most one token transfer, with where the OffRamp delivered it
    const tokenAmount = tokenAmounts[0]
    receiveIx = await newProgram(RECEIVER_V2_IDL, receiver, provider)
      .methods.ccipReceiveV2({
        ...receiverMessage,
        tokenTransfer: tokenAmount
          ? {
              tokenAmount,
              tokenReceiver: new PublicKey(message.tokenReceiver ?? PublicKey.default),
              tokenReceiverUsage: TOKEN_RECEIVER_USAGE_VARIANTS[tokenReceiverUsage],
            }
          : null,
      })
      .accounts(accounts)
      .remainingAccounts(remainingAccounts)
      .instruction()
  } else {
    receiveIx = await newProgram(RECEIVER_IDL, receiver, provider)
      .methods.ccipReceive({ ...receiverMessage, tokenAmounts })
      .accounts(accounts)
      .remainingAccounts(remainingAccounts)
      .instruction()
  }

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
