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

  // Convert feeToken to PublicKey (default to native SOL if not specified)
  const feeTokenPubkey = message.feeToken ? new PublicKey(message.feeToken) : NATIVE_MINT

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

  // copy of router which avoids signing every simulation
  const readOnlyRouter = new Program(
    router.idl,
    router.programId,
    simulationProvider(connection, sender),
  )
  do {
    // Create the transaction instruction for the deriveAccountsCcipSend method
    const response = (await readOnlyRouter.methods
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

export async function ccipSend(
  router: Program<typeof CCIP_ROUTER_IDL>,
  destChainSelector: bigint,
  message: AnyMessage,
  computeUnitLimit?: number,
) {
  const connection = router.provider.connection
  let wallet
  if (!(wallet = (router.provider as AnchorProvider).wallet)) {
    throw new Error('ccipSend called without signer wallet')
  }
  const svmMessage = anyToSvmMessage(message)

  for (const { token, amount } of svmMessage.tokenAmounts) {
    await approveRouterSpender(
      router.provider as AnchorProvider,
      token,
      router.programId,
      BigInt(amount.toString()),
    )
  }

  const { addressLookupTableAccounts, accounts, tokenIndexes } = await deriveAccountsCcipSend({
    router,
    destChainSelector,
    sender: wallet.publicKey,
    message: svmMessage,
  })

  const ix = await router.methods
    .ccipSend(new BN(destChainSelector), svmMessage, tokenIndexes)
    .accounts({
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

  const { blockhash: recentBlockhash } =
    await router.provider.connection.getLatestBlockhash('confirmed')

  if (!computeUnitLimit) {
    const simulated =
      (
        await simulateTransaction({
          connection,
          payerKey: wallet.publicKey,
          instructions: [ix],
          addressLookupTableAccounts,
        })
      ).unitsConsumed || 0
    console.debug('ccipSend simulation:', simulated, 'CUs')
    if (simulated > 200000) computeUnitLimit = Math.ceil(simulated * 1.1)
  }

  const txMsg = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash,
    instructions: [
      ...(computeUnitLimit
        ? [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit })]
        : []),
      ix,
    ],
  })
  const messageV0 = txMsg.compileToV0Message(addressLookupTableAccounts)
  const tx = new VersionedTransaction(messageV0)

  const signed = await wallet.signTransaction(tx)
  let hash
  for (let attempt = 0; ; attempt++) {
    try {
      hash = await connection.sendTransaction(signed)
      await connection.confirmTransaction(hash, 'confirmed')
      break
    } catch (error) {
      if (attempt >= 3) throw error
      console.error(`sendTransaction failed attempt=${attempt + 1}/3:`, error)
    }
  }
  return { hash }
}

async function approveRouterSpender(
  provider: AnchorProvider,
  token: PublicKey,
  router: PublicKey,
  amount?: bigint,
) {
  const wallet = provider.wallet
  const connection = provider.connection

  // spender is a Router PDA
  const [spender] = PublicKey.findProgramAddressSync([Buffer.from('fee_billing_signer')], router)

  // Get the user's associated token account for this mint
  const userTokenAccount = getAssociatedTokenAddressSync(token, wallet.publicKey)

  // Get the current account info to check existing delegation
  const accountInfo = await getAccount(connection, userTokenAccount)

  // Check if we need to approve
  const needsApproval =
    !accountInfo.delegate ||
    !accountInfo.delegate.equals(spender) ||
    (amount !== undefined && accountInfo.delegatedAmount < amount)

  if (needsApproval) {
    // Approve the spender to use tokens from the user's account
    amount ??= BigInt(Number.MAX_SAFE_INTEGER)

    const approveIx = createApproveInstruction(userTokenAccount, spender, wallet.publicKey, amount)

    const approveTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        instructions: [approveIx],
      }).compileToV0Message(),
    )
    const signed = await wallet.signTransaction(approveTx)
    const hash = await connection.sendTransaction(signed)

    console.log(
      'Approving',
      amount,
      'of',
      token.toBase58(),
      'tokens for router',
      router.toBase58(),
      '=>',
      hash,
    )
    await connection.confirmTransaction(hash, 'confirmed')

    return { hash }
  }
}
