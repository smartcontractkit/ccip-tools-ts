import util from 'util'

import { type AnchorProvider, type IdlTypes, Program } from '@coral-xyz/anchor'
import {
  NATIVE_MINT,
  createApproveInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import {
  type AccountMeta,
  type AddressLookupTableAccount,
  type Connection,
  type TransactionInstruction,
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import BN from 'bn.js'
import { zeroPadValue } from 'ethers'

import { SolanaChain } from './index.ts'
import type { AnyMessage } from '../types.ts'
import { toLeArray } from '../utils.ts'
import { IDL as CCIP_ROUTER_IDL } from './programs/1.6.0/CCIP_ROUTER.ts'
import { bytesToBuffer, simulateTransaction, simulationProvider } from './utils.ts'

function anyToSvmMessage(message: AnyMessage): IdlTypes<typeof CCIP_ROUTER_IDL>['SVM2AnyMessage'] {
  const feeTokenPubkey = message.feeToken ? new PublicKey(message.feeToken) : PublicKey.default

  const svmMessage: IdlTypes<typeof CCIP_ROUTER_IDL>['SVM2AnyMessage'] = {
    receiver: bytesToBuffer(zeroPadValue(message.receiver, 32)),
    data: bytesToBuffer(message.data || '0x'),
    tokenAmounts: (message.tokenAmounts || []).map((ta) => {
      if (!ta.token || ta.amount < 0n) {
        throw new Error('Invalid token amount: token address and positive amount required')
      }
      return {
        token: new PublicKey(ta.token),
        amount: new BN(ta.amount),
      }
    }),
    feeToken: feeTokenPubkey,
    extraArgs: bytesToBuffer(SolanaChain.encodeExtraArgs(message.extraArgs)),
  }

  return svmMessage
}

export async function getFee(
  connection: Connection,
  router: string,
  destChainSelector: bigint,
  message: AnyMessage,
): Promise<bigint> {
  const program = new Program(
    CCIP_ROUTER_IDL,
    new PublicKey(router),
    simulationProvider(connection),
  )

  // Get router config to find feeQuoter
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId)
  const configAccount = await connection.getAccountInfo(configPda)
  if (!configAccount) throw new Error(`Router config not found at ${configPda.toBase58()}`)

  const { feeQuoter, linkTokenMint }: { feeQuoter: PublicKey; linkTokenMint: PublicKey } =
    program.coder.accounts.decode('config', configAccount.data)

  // Derive fee-related PDAs
  const [destChainStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('dest_chain_state'), toLeArray(destChainSelector, 8)],
    program.programId,
  )

  const [feeQuoterConfigPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], feeQuoter)

  const [feeQuoterDestChainPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('dest_chain'), toLeArray(destChainSelector, 8)],
    feeQuoter,
  )

  if (
    message.feeToken &&
    message.feeToken !== PublicKey.default.toBase58() &&
    message.feeToken !== linkTokenMint.toBase58()
  ) {
    console.warn('feeToken is not default nor link =', linkTokenMint.toBase58())
  }

  // Convert feeToken to PublicKey (default to native SOL if not specified)
  const feeTokenPubkey =
    message.feeToken && message.feeToken !== PublicKey.default.toBase58()
      ? new PublicKey(message.feeToken)
      : NATIVE_MINT

  const [feeQuoterBillingTokenConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('fee_billing_token_config'), feeTokenPubkey.toBuffer()],
    feeQuoter,
  )

  // LINK token config (assuming default LINK token for now)
  const [feeQuoterLinkTokenConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('fee_billing_token_config'), linkTokenMint.toBuffer()],
    feeQuoter,
  )

  // Convert AnyMessage to SVM2AnyMessage format
  const svmMessage = anyToSvmMessage(message)

  // 2 feeQuoter PDAs per token
  const remainingAccounts = svmMessage.tokenAmounts
    .map((ta) => [
      PublicKey.findProgramAddressSync(
        [Buffer.from('fee_billing_token_config'), ta.token.toBuffer()],
        feeQuoter,
      )[0],
      PublicKey.findProgramAddressSync(
        [
          Buffer.from('per_chain_per_token_config'),
          toLeArray(destChainSelector, 8),
          ta.token.toBuffer(),
        ],
        feeQuoter,
      )[0],
    ])
    .flat()
    .map((pubkey) => ({ pubkey, isWritable: false, isSigner: false }))

  // Call getFee method
  const result: unknown = await program.methods
    .getFee(new BN(destChainSelector), svmMessage)
    .accounts({
      config: configPda,
      destChainState: destChainStatePda,
      feeQuoter: feeQuoter,
      feeQuoterConfig: feeQuoterConfigPda,
      feeQuoterDestChain: feeQuoterDestChainPda,
      feeQuoterBillingTokenConfig: feeQuoterBillingTokenConfigPda,
      feeQuoterLinkTokenConfig: feeQuoterLinkTokenConfigPda,
    })
    .remainingAccounts(remainingAccounts)
    .view()

  if (!(result as { amount?: BN })?.amount) {
    throw new Error(`Invalid fee result from router: ${util.inspect(result)}`)
  }

  return BigInt((result as { amount: BN }).amount.toString())
}

async function deriveAccountsCcipSend({
  router,
  destChainSelector,
  message,
  sender,
}: {
  router: Program<typeof CCIP_ROUTER_IDL>
  destChainSelector: bigint
  message: IdlTypes<typeof CCIP_ROUTER_IDL>['SVM2AnyMessage']
  sender: PublicKey
}) {
  const connection = router.provider.connection
  const derivedAccounts: AccountMeta[] = []
  const addressLookupTableAccounts: AddressLookupTableAccount[] = []
  const tokenIndices: number[] = []
  let askWith: AccountMeta[] = []
  let stage = 'Start'
  let tokenIndex = 0

  const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from('config')], router.programId)

  // read-only copy of router which avoids signing every simulation
  const roProgram = new Program(
    router.idl,
    router.programId,
    simulationProvider(connection, sender),
  )
  do {
    // Create the transaction instruction for the deriveAccountsCcipSend method
    const response = (await roProgram.methods
      .deriveAccountsCcipSend(
        {
          destChainSelector: new BN(destChainSelector.toString()),
          ccipSendCaller: sender,
          message,
        },
        stage,
      )
      .accounts({
        config: configPDA,
      })
      .remainingAccounts(askWith)
      .view()) as IdlTypes<typeof CCIP_ROUTER_IDL>['DeriveAccountsResponse']

    // Check if it is the start of a token transfer
    const isStartOfToken = /^TokenTransferStaticAccounts\/\d+\/0$/.test(response.currentStage)
    if (isStartOfToken) {
      // From CCIP_ROUTER IDL, ccipSend has 18 static accounts before remaining_accounts
      const numStaticCcipSendAccounts = 18
      tokenIndices.push(tokenIndex - numStaticCcipSendAccounts)
    }

    // Update token index
    tokenIndex += response.accountsToSave.length

    // Collect the derived accounts
    for (const meta of response.accountsToSave) {
      derivedAccounts.push({
        pubkey: meta.pubkey,
        isWritable: meta.isWritable,
        isSigner: meta.isSigner,
      })
    }

    // Prepare askWith for next iteration
    askWith = response.askAgainWith.map(
      (meta: IdlTypes<typeof CCIP_ROUTER_IDL>['CcipAccountMeta']) => ({
        pubkey: meta.pubkey,
        isWritable: meta.isWritable,
        isSigner: meta.isSigner,
      }),
    )

    const lookupTableAccounts = await Promise.all(
      response.lookUpTablesToSave.map(async (table) => {
        const lookupTableAccountInfo = await connection.getAddressLookupTable(table)

        if (!lookupTableAccountInfo.value) {
          throw new Error(`Lookup table account not found: ${table.toBase58()}`)
        }

        return lookupTableAccountInfo.value
      }),
    )

    // Collect lookup tables
    addressLookupTableAccounts.push(...lookupTableAccounts)

    stage = response.nextStage
  } while (stage?.length)

  return {
    accounts: derivedAccounts,
    addressLookupTableAccounts,
    tokenIndexes: Buffer.from(tokenIndices),
  }
}

async function simulateAndSendTxs(
  connection: Connection,
  feePayer: AnchorProvider['wallet'],
  instructions: TransactionInstruction[],
  addressLookupTableAccounts?: AddressLookupTableAccount[],
) {
  let computeUnitLimit
  const simulated =
    (
      await simulateTransaction({
        connection,
        payerKey: feePayer.publicKey,
        instructions,
        addressLookupTableAccounts,
      })
    ).unitsConsumed || 0
  if (simulated > 200000) computeUnitLimit = Math.ceil(simulated * 1.1)

  const txMsg = new TransactionMessage({
    payerKey: feePayer.publicKey,
    recentBlockhash: (await connection.getLatestBlockhash('confirmed')).blockhash,
    instructions: [
      ...(computeUnitLimit
        ? [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit })]
        : []),
      ...instructions,
    ],
  })
  const messageV0 = txMsg.compileToV0Message(addressLookupTableAccounts)
  const tx = new VersionedTransaction(messageV0)

  const signed = await feePayer.signTransaction(tx)
  let hash
  for (let attempt = 0; ; attempt++) {
    try {
      hash = await connection.sendTransaction(signed)
      await connection.confirmTransaction(hash, 'confirmed')
      return hash
    } catch (error) {
      if (attempt >= 3) throw error
      console.error(`sendTransaction failed attempt=${attempt + 1}/3:`, error)
    }
  }
}

export async function ccipSend(
  router: Program<typeof CCIP_ROUTER_IDL>,
  destChainSelector: bigint,
  message: AnyMessage & { fee: bigint },
  opts?: { approveMax?: boolean },
) {
  const connection = router.provider.connection
  let wallet
  if (!(wallet = (router.provider as AnchorProvider).wallet)) {
    throw new Error('ccipSend called without signer wallet')
  }

  const amountsToApprove = (message.tokenAmounts ?? []).reduce(
    (acc, { token, amount }) => ({ ...acc, [token]: (acc[token] ?? 0n) + amount }),
    {} as Record<string, bigint>,
  )
  if (message.feeToken && message.feeToken !== PublicKey.default.toBase58()) {
    amountsToApprove[message.feeToken] = (amountsToApprove[message.feeToken] ?? 0n) + message.fee
  }

  const approveIxs = []
  for (const [token, amount] of Object.entries(amountsToApprove)) {
    const approveIx = await approveRouterSpender(
      connection,
      wallet.publicKey,
      new PublicKey(token),
      router.programId,
      opts?.approveMax ? undefined : amount,
    )
    if (approveIx) approveIxs.push(approveIx)
  }

  const svmMessage = anyToSvmMessage(message)
  const { addressLookupTableAccounts, accounts, tokenIndexes } = await deriveAccountsCcipSend({
    router,
    destChainSelector,
    sender: wallet.publicKey,
    message: svmMessage,
  })

  const sendIx = await router.methods
    .ccipSend(new BN(destChainSelector), svmMessage, tokenIndexes)
    .accountsStrict({
      config: accounts[0].pubkey,
      destChainState: accounts[1].pubkey,
      nonce: accounts[2].pubkey,
      authority: accounts[3].pubkey,
      systemProgram: accounts[4].pubkey,
      feeTokenProgram: accounts[5].pubkey,
      feeTokenMint: accounts[6].pubkey,
      feeTokenUserAssociatedAccount: accounts[7].pubkey,
      feeTokenReceiver: accounts[8].pubkey,
      feeBillingSigner: accounts[9].pubkey,
      feeQuoter: accounts[10].pubkey,
      feeQuoterConfig: accounts[11].pubkey,
      feeQuoterDestChain: accounts[12].pubkey,
      feeQuoterBillingTokenConfig: accounts[13].pubkey,
      feeQuoterLinkTokenConfig: accounts[14].pubkey,
      rmnRemote: accounts[15].pubkey,
      rmnRemoteCurses: accounts[16].pubkey,
      rmnRemoteConfig: accounts[17].pubkey,
    })
    .remainingAccounts(accounts.slice(18))
    .instruction()

  let hash
  try {
    // first try to serialize and send a single tx containing approve and send ixs
    hash = await simulateAndSendTxs(
      connection,
      wallet,
      [...approveIxs, sendIx],
      addressLookupTableAccounts,
    )
  } catch (err) {
    if (
      !approveIxs.length ||
      !(err instanceof Error) ||
      !['encoding overruns Uint8Array', 'too large'].some((e) => err.message.includes(e))
    )
      throw err
    // if serialization fails, send approve txs separately
    for (const approveIx of approveIxs) await simulateAndSendTxs(connection, wallet, [approveIx])
    hash = await simulateAndSendTxs(connection, wallet, [sendIx], addressLookupTableAccounts)
  }

  return { hash }
}

async function approveRouterSpender(
  connection: Connection,
  owner: PublicKey,
  token: PublicKey,
  router: PublicKey,
  amount?: bigint,
): Promise<TransactionInstruction | undefined> {
  // Get the current account info to check existing delegation (or create if needed)
  const mintInfo = await connection.getAccountInfo(token)
  if (!mintInfo) throw new Error(`Mint ${token.toBase58()} not found`)
  const associatedTokenAccount = getAssociatedTokenAddressSync(
    token,
    owner,
    undefined,
    mintInfo.owner,
  )
  const accountInfo = await getAccount(
    connection,
    associatedTokenAccount,
    undefined,
    mintInfo.owner,
  )

  // spender is a Router PDA
  const [spender] = PublicKey.findProgramAddressSync([Buffer.from('fee_billing_signer')], router)

  // Check if we need to approve
  const needsApproval =
    !accountInfo.delegate ||
    !accountInfo.delegate.equals(spender) ||
    (amount != null && accountInfo.delegatedAmount < amount)

  if (!needsApproval) return
  // Approve the spender to use tokens from the user's account
  const approveIx = createApproveInstruction(
    accountInfo.address,
    spender,
    owner,
    amount ?? BigInt(Number.MAX_SAFE_INTEGER),
    undefined,
    mintInfo.owner,
  )
  console.info(
    'Approving',
    amount ?? BigInt(Number.MAX_SAFE_INTEGER),
    'of',
    token.toBase58(),
    'tokens to router',
    router.toBase58(),
  )
  return approveIx
}
