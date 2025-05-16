import { AnchorProvider, BorshCoder, Wallet } from '@coral-xyz/anchor'
import { Connection, Keypair } from '@solana/web3.js'
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { ComputeBudgetProgram } from '@solana/web3.js'
import {
  CCIPVersion,
  normalizeExecutionReport,
  type CCIPMessage,
  type ExecutionReport,
} from '../types.ts'
import { getCcipOfframp } from './programs/getCcipOfframp'
import { getManuallyExecuteInputs } from './getManuallyExecuteInputs'
import { simulateManuallyExecute } from './simulateManuallyExecute'
import type { CCIPRequest } from '../../../dist/lib/types'
import type { SupportedSolanaCCIPVersion } from './programs/versioning.ts'
import { CCIP_OFFRAMP_IDL } from './programs/1.6.0/CCIP_OFFRAMP.ts'
import fs from 'fs'
import { calculateManualExecProof } from '../execution.ts'
import path from 'path'
import { getClusterUrlByChainSelectorName } from './getClusterByChainSelectorName.ts'

export async function buildManualExecutionTxWithSolanaDestination<
  V extends SupportedSolanaCCIPVersion,
>(
  destinationProvider: AnchorProvider,
  ccipRequest: CCIPRequest<V>,
  offrampAddress: string,
  computeUnitsOverride: number | undefined,
): Promise<VersionedTransaction> {
  const offrampProgram = getCcipOfframp({
    ccipVersion: CCIPVersion.V1_6,
    address: offrampAddress,
    provider: destinationProvider,
  })

  const TnV = await offrampProgram.methods.typeVersion().accounts({}).signers([]).view()

  if (TnV != 'ccip-offramp 0.1.0-dev') {
    throw new Error('Unsupported offramp version: ', TnV)
  }

  const { proofs, merkleRoot } = calculateManualExecProof([ccipRequest.message], ccipRequest.lane, [
    ccipRequest.message.header.messageId,
  ])
  const executionReportRaw: ExecutionReport = normalizeExecutionReport({
    sourceChainSelector: BigInt(ccipRequest.lane.sourceChainSelector),
    message: ccipRequest.message as CCIPMessage<typeof CCIPVersion.V1_6>,
    proofs,
    // Offchain token data is unsupported for manual exec
    offchainTokenData: ['0x'],
  })

  const payerAddress = destinationProvider.wallet.publicKey.toBase58()

  const { executionReport, tokenIndexes, accounts, remainingAccounts, addressLookupTableAccounts } =
    await getManuallyExecuteInputs({
      executionReportRaw,
      connection: destinationProvider.connection,
      offrampProgram,
      root: merkleRoot,
      senderAddress: payerAddress,
    })

  const coder = new BorshCoder(CCIP_OFFRAMP_IDL)
  const serializedReport = coder.types.encode('ExecutionReportSingleChain', executionReport)
  const serializedTokenIndexes = Buffer.from(tokenIndexes)

  const anchorTx = await offrampProgram.methods
    .manuallyExecute(serializedReport, serializedTokenIndexes)
    .accounts(accounts)
    .remainingAccounts(remainingAccounts)
    .transaction()

  const manualExecuteInstructions = anchorTx.instructions

  const { blockhash } = await destinationProvider.connection.getLatestBlockhash()

  const computeUnits = await simulateManuallyExecute({
    instructions: manualExecuteInstructions,
    connection: destinationProvider.connection,
    payerKey: destinationProvider.wallet.publicKey,
    blockhash,
    addressLookupTableAccounts,
    computeUnitsOverride,
  })
  const computeUnitsWithBuffer = Math.ceil(computeUnits * 1.1)
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: computeUnitsOverride || computeUnitsWithBuffer,
  })

  // Add compute budget instruction at the beginning of instructions
  const finalInstructions = [computeBudgetIx, ...manualExecuteInstructions]

  const message = new TransactionMessage({
    payerKey: destinationProvider.wallet.publicKey,
    recentBlockhash: blockhash,
    instructions: finalInstructions,
  })
  const messageV0 = message.compileToV0Message(addressLookupTableAccounts)
  return new VersionedTransaction(messageV0)
}

export function newAnchorProvider(chainName: string) {
  const homeDir = process.env.HOME || process.env.USERPROFILE
  const keypairPath = path.join(homeDir as string, '.config', 'solana', 'id.json')
  const secretKeyString = fs.readFileSync(keypairPath, 'utf8')
  const secretKey = Uint8Array.from(JSON.parse(secretKeyString))

  const keypair = Keypair.fromSecretKey(secretKey)
  const wallet = new Wallet(keypair)
  const connection = new Connection(getClusterUrlByChainSelectorName(chainName))
  const anchorProvider = new AnchorProvider(connection, wallet, {
    commitment: 'processed',
  })
  return { anchorProvider, keypair }
}
