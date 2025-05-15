import { AnchorProvider, BorshCoder, type Instruction } from '@coral-xyz/anchor'
import {
  PublicKey,
  type GetVersionedTransactionConfig,
  type PartiallyDecodedInstruction,
} from '@solana/web3.js'
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { ComputeBudgetProgram } from '@solana/web3.js'
import { CCIPVersion, normalizeExecutionReport, type ExecutionReport } from '../types.ts'
import { getCcipOfframp } from './programs/getCcipOfframp'
import { getManuallyExecuteInputs } from './getManuallyExecuteInputs'
import { simulateManuallyExecute } from './simulateManuallyExecute'
import type { CCIPRequest } from '../../../dist/lib/types'
import type { SupportedSolanaCCIPVersion } from './programs/versioning.ts'
import { CCIP_OFFRAMP_IDL } from './programs/1.6.0/CCIP_OFFRAMP.ts'

export async function buildManualExecutionTxWithSolanaDestination<
  V extends SupportedSolanaCCIPVersion,
>(
  destinationProvider: AnchorProvider,
  ccipRequest: CCIPRequest<V>,
  solanaTxSignature: string,
  computeUnitsOverride: number | undefined,
): Promise<VersionedTransaction> {
  const transaction = await destinationProvider.connection.getParsedTransaction(solanaTxSignature, {
    maxSupportedTransactionVersion: 0,
  })

  if (transaction === null) {
    throw new Error('Could not parse destination transaction')
  }

  const instructions = transaction.transaction.message.instructions
  const executeInstruction = instructions[1] as PartiallyDecodedInstruction
  const offrampAddress = executeInstruction.programId

  const offrampProgram = getCcipOfframp({
    ccipVersion: CCIPVersion.V1_6,
    address: offrampAddress.toBase58(),
    provider: destinationProvider,
  })

  const TnV = await offrampProgram.methods.typeVersion().accounts({}).signers([]).view()

  if (TnV != 'ccip-offramp 0.1.0-dev') {
    throw new Error('Unsupported offramp version: ', TnV)
  }

  const commitReportAddress: PublicKey = executeInstruction.accounts[3]
  const commitReport = await offrampProgram.account.commitReport.fetch(commitReportAddress)
  const rootString = '0x' + Buffer.from(commitReport.merkleRoot).toString('hex')

  const coder = new BorshCoder(CCIP_OFFRAMP_IDL)
  const decodedData = coder.instruction.decode(executeInstruction.data, 'base58') as Instruction
  const executionReportDecoded = coder.types.decode(
    'ExecutionReportSingleChain',
    decodedData.data.rawExecutionReport,
  )

  const executionReportRaw: ExecutionReport = normalizeExecutionReport({
    message: ccipRequest.message,
    offchainTokenData: executionReportDecoded.offchainTokenData.map(
      (data: Buffer) => '0x' + data.toString('hex'),
    ),
    proofs: executionReportDecoded.proofs,
    sourceChainSelector: ccipRequest.message.header.sourceChainSelector,
  })

  const payerAddress = destinationProvider.wallet.publicKey.toBase58()
  const { executionReport, tokenIndexes, accounts, remainingAccounts, addressLookupTableAccounts } =
    await getManuallyExecuteInputs({
      executionReportRaw,
      connection: destinationProvider.connection,
      offrampProgram,
      root: rootString,
      senderAddress: payerAddress,
    })

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
  const tx = new VersionedTransaction(messageV0)

  return tx
}

// Failed TX:
//
// // Signature: 5MtgBzDjUymdh72vQLf93cVN9vyqAyxqKRsVhPsqr7J5bfmUmyKJCWqcMSZYdersZSsf7SArtHRCiiHX42NFBfZS
// Slot: 381057057
// Block Time: 1747323611
// Transaction Details: {
//   "blockTime": 1747323611,
//   "meta": {
//     "computeUnitsConsumed": 380000,
//     "err": {
//       "InstructionError": [
//         1,
//         "ComputationalBudgetExceeded"
//       ]
//     },
//     "fee": 5001,
//     "innerInstructions": [
//       {
//         "index": 1,
//         "instructions": [
//           {
//             "accounts": [
//               "Brjx18FkpP6SR46SsEGKp5m1cqx7UJDtmecgDKJaYdHf",
//               "AaQ5EPsggd8nHL5p3KycJYQZf7xSLhUTgFez4An725J5"
//             ],
//             "data": "8urydoVmxeukm57ATNs74EmN8VHeUWh19",
//             "programId": "RmnAZiCJdaYtwR1f634Ba7yNJXuK3pS6kHuX4FgNgX8",
//             "stackHeight": 2
//           },
//           {
//             "accounts": [
//               "5GfRgifCoQMkpbHvRXY7tjjCPBdaNVdixst2wki4k4uY",
//               "offVkroQ4wYMv6QFPBvJazAx2p8BnLh7sJRdyQ5GYfx",
//               "9eWtJJhas4BMyVBBuCTPP4LcHR3XSvPr4qeEZJwnBgw8",
//               "DJqV7aFn32Un1M7j2dwVDc77jXZiUXoufJyHhEqoEY6x",
//               "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
//               "7AC59PVvR64EoMnLX45FHnJAYzPsxdViyYBsaGEQPFvh",
//               "8HviwGbWVSPmMhTfnVBHLuEfYnNfZktBwch5pFVhDzAH",
//               "CE3bgWuiADCSpjvAMrEmiNy5We8CLZkkQB2dLBxs3qnT",
//               "Fx3C4gpwJCxdEJJ8PeDhekaSs35hpiBrAtPkchexNa79",
//               "RmnAZiCJdaYtwR1f634Ba7yNJXuK3pS6kHuX4FgNgX8",
//               "Brjx18FkpP6SR46SsEGKp5m1cqx7UJDtmecgDKJaYdHf",
//               "AaQ5EPsggd8nHL5p3KycJYQZf7xSLhUTgFez4An725J5",
//               "5nzWcFwSNo3XmpSHVn2JsAhCWZciGSQ3WigFsFSaLzvu"
//             ],
//             "data": "cj5NkJBivteYbLTwKkUoGbwhBd3W88GtbHzdBhj9jLyyFju9wEyk8ViFzM6fyEkrcQZAQwV1wJMkXVJCCmCw79kmmKfZCQWkJKsGyS7oVBmSN8BViQbKr5Xy5ipCRZ3erX4MEXFzyEzd6iDd8wj3D95J3SzcusBjrbQzo8QJZzLxrmqTuWrBMg9ykQF4fkD3TNjPEWsu9JmHYJsB6ADN46vVZp7fRhrdpiGNdxKoSrDaYXANEarkGGeM7KKjwBVLT8WHC2gDBraGQ5RLb",
//             "programId": "J9bvT8crfKDY6QmJz8iKHoVZbEwCrsxywSM77uUqXhpb",
//             "stackHeight": 2
//           },
//           {
//             "accounts": [
//               "Brjx18FkpP6SR46SsEGKp5m1cqx7UJDtmecgDKJaYdHf",
//               "AaQ5EPsggd8nHL5p3KycJYQZf7xSLhUTgFez4An725J5"
//             ],
//             "data": "8urydoVmxeukm57ATNs74EmN8VHeUWh19",
//             "programId": "RmnAZiCJdaYtwR1f634Ba7yNJXuK3pS6kHuX4FgNgX8",
//             "stackHeight": 3
//           },
//           {
//             "parsed": {
//               "info": {
//                 "account": "5nzWcFwSNo3XmpSHVn2JsAhCWZciGSQ3WigFsFSaLzvu",
//                 "amount": "1000000",
//                 "mint": "7AC59PVvR64EoMnLX45FHnJAYzPsxdViyYBsaGEQPFvh",
//                 "mintAuthority": "8HviwGbWVSPmMhTfnVBHLuEfYnNfZktBwch5pFVhDzAH"
//               },
//               "type": "mintTo"
//             },
//             "program": "spl-token",
//             "programId": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
//             "stackHeight": 3
//           },
//           {
//             "accounts": [
//               "6vgNgYzxqzKw689GzoUBNhtorYz2zZ9BLiRrRmW1aJDv",
//               "offVkroQ4wYMv6QFPBvJazAx2p8BnLh7sJRdyQ5GYfx",
//               "9eWtJJhas4BMyVBBuCTPP4LcHR3XSvPr4qeEZJwnBgw8",
//               "RrRhhcb2CGTz46pKWxaPFPYqHTMVqWgQcPWskG6oJHJ",
//               "5nzWcFwSNo3XmpSHVn2JsAhCWZciGSQ3WigFsFSaLzvu",
//               "HYU4f6hpH7rsu5icY7YBoW1h8xUAqButiUcJsnsE5wup",
//               "7AC59PVvR64EoMnLX45FHnJAYzPsxdViyYBsaGEQPFvh",
//               "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
//               "98wydioeM7RtgM7fSuSDwQzZUVbqrF2Qadi9ANSmxvmm"
//             ],
//             "data": "3NucdiyFZ1isi9J21x2Ut29ot3H7jx5MogEZYZGBkBVBbVRgfAVHkKLcxfWGsCzNHCYDkzesm69qtAkcPSi9fgvBzWWaqgV5ByekR7J8QKRUX7FUwUdHadqCDi7JBm91YywKGawrdVDz6RMiat2Pp4vwEbpozMRRJokFoo2bsbZosDdC9PYaFAPdrVkWPDScQLZzGqe32Da6Vnu3EL1q7tz5HYtLKh4K",
//             "programId": "Redic2v6fBaUoHovjaKPEAQXFgwJVbEuyAiWyytdR5S",
//             "stackHeight": 2
//           }
//         ]
//       }
//     ],
//     "logMessages": [
//       "Program ComputeBudget111111111111111111111111111111 invoke [1]",
//       "Program ComputeBudget111111111111111111111111111111 success",
//       "Program offVkroQ4wYMv6QFPBvJazAx2p8BnLh7sJRdyQ5GYfx invoke [1]",
//       "Program log: Instruction: Execute",
//       "Program RmnAZiCJdaYtwR1f634Ba7yNJXuK3pS6kHuX4FgNgX8 invoke [2]",
//       "Program log: Instruction: VerifyNotCursed",
//       "Program RmnAZiCJdaYtwR1f634Ba7yNJXuK3pS6kHuX4FgNgX8 consumed 5356 of 344910 compute units",
//       "Program RmnAZiCJdaYtwR1f634Ba7yNJXuK3pS6kHuX4FgNgX8 success",
//       "Program data: kF6OqjFuQ70BAAp/lqub6BZqbJvNLPU+Jzfj3DRHFXSG9iQTc0toDsuTYAAAAAAAAA==",
//       "Program data: ubCMcO9OH/nZGtnJT7pB3tsCAAAAAAAA458ggd/ctOyHZUcCz0AxjWiQsVNsevV426IGBiMTO6GR08kT0IvAcTTa1EbDIx+is8liG7pxnyc1UckjkINMHAE=",
//       "Program J9bvT8crfKDY6QmJz8iKHoVZbEwCrsxywSM77uUqXhpb invoke [2]",
//       "Program log: Instruction: ReleaseOrMintTokens",
//       "Program RmnAZiCJdaYtwR1f634Ba7yNJXuK3pS6kHuX4FgNgX8 invoke [3]",
//       "Program log: Instruction: VerifyNotCursed",
//       "Program RmnAZiCJdaYtwR1f634Ba7yNJXuK3pS6kHuX4FgNgX8 consumed 5356 of 181979 compute units",
//       "Program RmnAZiCJdaYtwR1f634Ba7yNJXuK3pS6kHuX4FgNgX8 success",
//       "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb invoke [3]",
//       "Program log: Instruction: MintTo",
//       "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb consumed 1050 of 173507 compute units",
//       "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb success",
//       "Program data: roMVOVh1cnlsV9ij+GMffXvggBmSZwwznEzUD7FMZUT8mZmn4xal/njmuR6+bB6Rr8P+3tN7L4aYYI7700CzysFM+iOMNXhQQEIPAAAAAABbgN4MgaoGPtZxwhULjok/E+/UwiiXb7P0RngjOxMjYg==",
//       "Program J9bvT8crfKDY6QmJz8iKHoVZbEwCrsxywSM77uUqXhpb consumed 75588 of 245217 compute units",
//       "Program return: J9bvT8crfKDY6QmJz8iKHoVZbEwCrsxywSM77uUqXhpb QEIPAAAAAAA=",
//       "Program J9bvT8crfKDY6QmJz8iKHoVZbEwCrsxywSM77uUqXhpb success",
//       "Program Redic2v6fBaUoHovjaKPEAQXFgwJVbEuyAiWyytdR5S invoke [2]",
//       "Program log: Instruction: CcipReceive",
//       "Program Redic2v6fBaUoHovjaKPEAQXFgwJVbEuyAiWyytdR5S consumed 158067 of 158067 compute units",
//       "Program Redic2v6fBaUoHovjaKPEAQXFgwJVbEuyAiWyytdR5S failed: Computational budget exceeded",
//       "Program offVkroQ4wYMv6QFPBvJazAx2p8BnLh7sJRdyQ5GYfx consumed 379850 of 379850 compute units",
//       "Program offVkroQ4wYMv6QFPBvJazAx2p8BnLh7sJRdyQ5GYfx failed: Computational budget exceeded"
//     ],
//     "postBalances": [
//       9715946375,
//       1510320,
//       2074080,
//       2074080,
//       2081040,
//       1141440,
//       946560,
//       1141440,
//       0,
//       1621680,
//       946560,
//       0,
//       1,
//       1461600,
//       3452160,
//       2074080,
//       1141440,
//       3507840,
//       2067120,
//       1141440,
//       0,
//       0,
//       0,
//       13752960,
//       1844400,
//       1559040,
//       1,
//       0,
//       1141440,
//       981360,
//       1405920,
//       1364160
//     ],
//     "postTokenBalances": [
//       {
//         "accountIndex": 2,
//         "mint": "7AC59PVvR64EoMnLX45FHnJAYzPsxdViyYBsaGEQPFvh",
//         "owner": "98wydioeM7RtgM7fSuSDwQzZUVbqrF2Qadi9ANSmxvmm",
//         "programId": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
//         "uiTokenAmount": {
//           "amount": "0",
//           "decimals": 9,
//           "uiAmount": null,
//           "uiAmountString": "0"
//         }
//       },
//       {
//         "accountIndex": 3,
//         "mint": "7AC59PVvR64EoMnLX45FHnJAYzPsxdViyYBsaGEQPFvh",
//         "owner": "HCAP9u5wYJgfV5uyzbaTiZmBLzkDzaXVvdc8qFjuSpV7",
//         "programId": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
//         "uiTokenAmount": {
//           "amount": "10010000000",
//           "decimals": 9,
//           "uiAmount": 10.01,
//           "uiAmountString": "10.01"
//         }
//       },
//       {
//         "accountIndex": 15,
//         "mint": "7AC59PVvR64EoMnLX45FHnJAYzPsxdViyYBsaGEQPFvh",
//         "owner": "8HviwGbWVSPmMhTfnVBHLuEfYnNfZktBwch5pFVhDzAH",
//         "programId": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
//         "uiTokenAmount": {
//           "amount": "0",
//           "decimals": 9,
//           "uiAmount": null,
//           "uiAmountString": "0"
//         }
//       }
//     ],
//     "preBalances": [
//       9715951376,
//       1510320,
//       2074080,
//       2074080,
//       2081040,
//       1141440,
//       946560,
//       1141440,
//       0,
//       1621680,
//       946560,
//       0,
//       1,
//       1461600,
//       3452160,
//       2074080,
//       1141440,
//       3507840,
//       2067120,
//       1141440,
//       0,
//       0,
//       0,
//       13752960,
//       1844400,
//       1559040,
//       1,
//       0,
//       1141440,
//       981360,
//       1405920,
//       1364160
//     ],
//     "preTokenBalances": [
//       {
//         "accountIndex": 2,
//         "mint": "7AC59PVvR64EoMnLX45FHnJAYzPsxdViyYBsaGEQPFvh",
//         "owner": "98wydioeM7RtgM7fSuSDwQzZUVbqrF2Qadi9ANSmxvmm",
//         "programId": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
//         "uiTokenAmount": {
//           "amount": "0",
//           "decimals": 9,
//           "uiAmount": null,
//           "uiAmountString": "0"
//         }
//       },
//       {
//         "accountIndex": 3,
//         "mint": "7AC59PVvR64EoMnLX45FHnJAYzPsxdViyYBsaGEQPFvh",
//         "owner": "HCAP9u5wYJgfV5uyzbaTiZmBLzkDzaXVvdc8qFjuSpV7",
//         "programId": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
//         "uiTokenAmount": {
//           "amount": "10010000000",
//           "decimals": 9,
//           "uiAmount": 10.01,
//           "uiAmountString": "10.01"
//         }
//       },
//       {
//         "accountIndex": 15,
//         "mint": "7AC59PVvR64EoMnLX45FHnJAYzPsxdViyYBsaGEQPFvh",
//         "owner": "8HviwGbWVSPmMhTfnVBHLuEfYnNfZktBwch5pFVhDzAH",
//         "programId": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
//         "uiTokenAmount": {
//           "amount": "0",
//           "decimals": 9,
//           "uiAmount": null,
//           "uiAmountString": "0"
//         }
//       }
//     ],
//     "rewards": [],
//     "status": {
//       "Err": {
//         "InstructionError": [
//           1,
//           "ComputationalBudgetExceeded"
//         ]
//       }
//     }
//   },
//   "slot": 381057057,
//   "transaction": {
//     "message": {
//       "accountKeys": [
//         {
//           "pubkey": "7kdrBZJJSHdXqTs9cwcYP8NjXiS9X2z3SwCHk94WqjMT",
//           "signer": true,
//           "source": "transaction",
//           "writable": true
//         },
//         {
//           "pubkey": "FQxTi1fukqHYZSHFGZcGPwyNoHPs7JdAcrkJtcGFYQ1t",
//           "signer": false,
//           "source": "transaction",
//           "writable": true
//         },
//         {
//           "pubkey": "5nzWcFwSNo3XmpSHVn2JsAhCWZciGSQ3WigFsFSaLzvu",
//           "signer": false,
//           "source": "transaction",
//           "writable": true
//         },
//         {
//           "pubkey": "HYU4f6hpH7rsu5icY7YBoW1h8xUAqButiUcJsnsE5wup",
//           "signer": false,
//           "source": "transaction",
//           "writable": true
//         },
//         {
//           "pubkey": "Fx3C4gpwJCxdEJJ8PeDhekaSs35hpiBrAtPkchexNa79",
//           "signer": false,
//           "source": "transaction",
//           "writable": true
//         },
//         {
//           "pubkey": "offVkroQ4wYMv6QFPBvJazAx2p8BnLh7sJRdyQ5GYfx",
//           "signer": false,
//           "source": "transaction",
//           "writable": false
//         },
//         {
//           "pubkey": "9eWtJJhas4BMyVBBuCTPP4LcHR3XSvPr4qeEZJwnBgw8",
//           "signer": false,
//           "source": "transaction",
//           "writable": false
//         },
//         {
//           "pubkey": "Redic2v6fBaUoHovjaKPEAQXFgwJVbEuyAiWyytdR5S",
//           "signer": false,
//           "source": "transaction",
//           "writable": false
//         },
//         {
//           "pubkey": "6vgNgYzxqzKw689GzoUBNhtorYz2zZ9BLiRrRmW1aJDv",
//           "signer": false,
//           "source": "transaction",
//           "writable": false
//         },
//         {
//           "pubkey": "RrRhhcb2CGTz46pKWxaPFPYqHTMVqWgQcPWskG6oJHJ",
//           "signer": false,
//           "source": "transaction",
//           "writable": false
//         },
//         {
//           "pubkey": "98wydioeM7RtgM7fSuSDwQzZUVbqrF2Qadi9ANSmxvmm",
//           "signer": false,
//           "source": "transaction",
//           "writable": false
//         },
//         {
//           "pubkey": "5GfRgifCoQMkpbHvRXY7tjjCPBdaNVdixst2wki4k4uY",
//           "signer": false,
//           "source": "transaction",
//           "writable": false
//         },
//         {
//           "pubkey": "ComputeBudget111111111111111111111111111111",
//           "signer": false,
//           "source": "transaction",
//           "writable": false
//         },
//         {
//           "pubkey": "7AC59PVvR64EoMnLX45FHnJAYzPsxdViyYBsaGEQPFvh",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": true
//         },
//         {
//           "pubkey": "DJqV7aFn32Un1M7j2dwVDc77jXZiUXoufJyHhEqoEY6x",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": true
//         },
//         {
//           "pubkey": "CE3bgWuiADCSpjvAMrEmiNy5We8CLZkkQB2dLBxs3qnT",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": true
//         },
//         {
//           "pubkey": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": false
//         },
//         {
//           "pubkey": "Ee7hWa9DeGZ6SDXgF2fN61crUFV2WFz1aE66gm1ovkRB",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": false
//         },
//         {
//           "pubkey": "DyCggHEiuAgeHh8CFv5w9X2Kj6mcpNtoUn1x1rLbecfL",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": false
//         },
//         {
//           "pubkey": "J9bvT8crfKDY6QmJz8iKHoVZbEwCrsxywSM77uUqXhpb",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": false
//         },
//         {
//           "pubkey": "8HviwGbWVSPmMhTfnVBHLuEfYnNfZktBwch5pFVhDzAH",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": false
//         },
//         {
//           "pubkey": "2Sx4Tr9bbZhbqxsdvVPPWnonmgzxJ2N7XWohtNgNPciA",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": false
//         },
//         {
//           "pubkey": "BKy8ADoKQQ18xKjuxCzQPQoHYygZ8bmBbbLLrs15hzTL",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": false
//         },
//         {
//           "pubkey": "AFUaqKMB92kQB5y7op5pyB3hYG275rZcS7Y8inWJyc2K",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": false
//         },
//         {
//           "pubkey": "3a94c3Z5bDSw2c2GryztaTv7MZYG7rBCXs2eaQUp22ei",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": false
//         },
//         {
//           "pubkey": "3uLA89AnqSX5sHimPnxna1jP217nxGk7UtebLLaukcQr",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": false
//         },
//         {
//           "pubkey": "11111111111111111111111111111111",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": false
//         },
//         {
//           "pubkey": "Sysvar1nstructions1111111111111111111111111",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": false
//         },
//         {
//           "pubkey": "RmnAZiCJdaYtwR1f634Ba7yNJXuK3pS6kHuX4FgNgX8",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": false
//         },
//         {
//           "pubkey": "Brjx18FkpP6SR46SsEGKp5m1cqx7UJDtmecgDKJaYdHf",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": false
//         },
//         {
//           "pubkey": "AaQ5EPsggd8nHL5p3KycJYQZf7xSLhUTgFez4An725J5",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": false
//         },
//         {
//           "pubkey": "DwnSu6gNMwAE5cCL5MfavGBPiXcXc25LHGXAkMU44Xzc",
//           "signer": false,
//           "source": "lookupTable",
//           "writable": false
//         }
//       ],
//       "addressTableLookups": [
//         {
//           "accountKey": "Ee7hWa9DeGZ6SDXgF2fN61crUFV2WFz1aE66gm1ovkRB",
//           "readonlyIndexes": [
//             6,
//             0,
//             1,
//             2,
//             5,
//             8,
//             9
//           ],
//           "writableIndexes": [
//             7,
//             3,
//             4
//           ]
//         },
//         {
//           "accountKey": "533VqMcF8N4CrELBHGQanZSHDMDG86MEACdhqDuTqr4o",
//           "readonlyIndexes": [
//             7,
//             8,
//             23,
//             0,
//             2,
//             19,
//             21,
//             20,
//             27
//           ],
//           "writableIndexes": []
//         }
//       ],
//       "instructions": [
//         {
//           "accounts": [],
//           "data": "3DdGGhkhJbjm",
//           "programId": "ComputeBudget111111111111111111111111111111",
//           "stackHeight": null
//         },
//         {
//           "accounts": [
//             "AFUaqKMB92kQB5y7op5pyB3hYG275rZcS7Y8inWJyc2K",
//             "3a94c3Z5bDSw2c2GryztaTv7MZYG7rBCXs2eaQUp22ei",
//             "3uLA89AnqSX5sHimPnxna1jP217nxGk7UtebLLaukcQr",
//             "FQxTi1fukqHYZSHFGZcGPwyNoHPs7JdAcrkJtcGFYQ1t",
//             "offVkroQ4wYMv6QFPBvJazAx2p8BnLh7sJRdyQ5GYfx",
//             "9eWtJJhas4BMyVBBuCTPP4LcHR3XSvPr4qeEZJwnBgw8",
//             "7kdrBZJJSHdXqTs9cwcYP8NjXiS9X2z3SwCHk94WqjMT",
//             "11111111111111111111111111111111",
//             "Sysvar1nstructions1111111111111111111111111",
//             "RmnAZiCJdaYtwR1f634Ba7yNJXuK3pS6kHuX4FgNgX8",
//             "Brjx18FkpP6SR46SsEGKp5m1cqx7UJDtmecgDKJaYdHf",
//             "AaQ5EPsggd8nHL5p3KycJYQZf7xSLhUTgFez4An725J5",
//             "Redic2v6fBaUoHovjaKPEAQXFgwJVbEuyAiWyytdR5S",
//             "6vgNgYzxqzKw689GzoUBNhtorYz2zZ9BLiRrRmW1aJDv",
//             "RrRhhcb2CGTz46pKWxaPFPYqHTMVqWgQcPWskG6oJHJ",
//             "5nzWcFwSNo3XmpSHVn2JsAhCWZciGSQ3WigFsFSaLzvu",
//             "HYU4f6hpH7rsu5icY7YBoW1h8xUAqButiUcJsnsE5wup",
//             "7AC59PVvR64EoMnLX45FHnJAYzPsxdViyYBsaGEQPFvh",
//             "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
//             "98wydioeM7RtgM7fSuSDwQzZUVbqrF2Qadi9ANSmxvmm",
//             "5GfRgifCoQMkpbHvRXY7tjjCPBdaNVdixst2wki4k4uY",
//             "5nzWcFwSNo3XmpSHVn2JsAhCWZciGSQ3WigFsFSaLzvu",
//             "DwnSu6gNMwAE5cCL5MfavGBPiXcXc25LHGXAkMU44Xzc",
//             "Fx3C4gpwJCxdEJJ8PeDhekaSs35hpiBrAtPkchexNa79",
//             "Ee7hWa9DeGZ6SDXgF2fN61crUFV2WFz1aE66gm1ovkRB",
//             "DyCggHEiuAgeHh8CFv5w9X2Kj6mcpNtoUn1x1rLbecfL",
//             "J9bvT8crfKDY6QmJz8iKHoVZbEwCrsxywSM77uUqXhpb",
//             "DJqV7aFn32Un1M7j2dwVDc77jXZiUXoufJyHhEqoEY6x",
//             "CE3bgWuiADCSpjvAMrEmiNy5We8CLZkkQB2dLBxs3qnT",
//             "8HviwGbWVSPmMhTfnVBHLuEfYnNfZktBwch5pFVhDzAH",
//             "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
//             "7AC59PVvR64EoMnLX45FHnJAYzPsxdViyYBsaGEQPFvh",
//             "2Sx4Tr9bbZhbqxsdvVPPWnonmgzxJ2N7XWohtNgNPciA",
//             "BKy8ADoKQQ18xKjuxCzQPQoHYygZ8bmBbbLLrs15hzTL"
//           ],
//           "data": "YkTxWvNQkFqpUVyiLpCubUbm6XVTscL8nmXoWRnNFJy3TvWL3S5kFujT8oqMsjwSwaUAQb7bq7NVnSLLsN5s6jcKQ3RAS8ozx3yeQE5F7ZEpvE8oHbkwuo15X4oTB64bkigqQXSVYWpWYh3Q8ymXvAzxmMQ1wXDK5zhoGz9Vk1DLvYe6s3EMaPvA1tyzPBTpxwJBbBrBF9d64xL1T56nEXKyKTCVoEECSBRBrJDxQCV7ppEb33Fm4Jzur1CwyRAcpkLQEMS2worNAvqGbj39KYDjmZFmRNqfjMaJ5ZUp6jHibdV9CDaQyB9RjwC4uwWR9VucdPC9hSx66YGeyUrbx43PDKZzWF5EftrTKbRZaQ19PSBo886FxBjSYWH3RbVwym8WEND6oCUTuuTk2HpfHuwjNDsC2y6i7d5SgotoAHamH4TzwaivBr6Qv9tSvPDagy2ifFkF5WveAvtvgJLNHCPgfPjFsj92F4JN2nCEg28Y2uoeDMSanwvTPCAaCCHtrrvcZd9FaUAmJ1NYDFpUi5LZbsqfrg358riMt9HAwJjT5pahRitP",
//           "programId": "offVkroQ4wYMv6QFPBvJazAx2p8BnLh7sJRdyQ5GYfx",
//           "stackHeight": null
//         },
//         {
//           "accounts": [],
//           "data": "GZZzxf",
//           "programId": "ComputeBudget111111111111111111111111111111",
//           "stackHeight": null
//         }
//       ],
//       "recentBlockhash": "4ZALVCD9scdvVDvqxt5shSkwhGNkiHvPDcKRWYqYVUYC"
//     },
//     "signatures": [
//       "5MtgBzDjUymdh72vQLf93cVN9vyqAyxqKRsVhPsqr7J5bfmUmyKJCWqcMSZYdersZSsf7SArtHRCiiHX42NFBfZS"
//     ]
//   },
//   "version": 0
// }
