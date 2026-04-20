import { Buffer } from 'buffer'

import { type IdlTypes, Program } from '@coral-xyz/anchor'
import { NATIVE_MINT, createApproveInstruction, getAccount } from '@solana/spl-token'
import {
  type AccountMeta,
  type AddressLookupTableAccount,
  type Connection,
  type TransactionInstruction,
  PublicKey,
} from '@solana/web3.js'
import BN from 'bn.js'
import { zeroPadValue } from 'ethers'

import { SolanaChain } from './index.ts'
import { CCIPError } from '../errors/CCIPError.ts'
import { CCIPErrorCode } from '../errors/codes.ts'
import {
  CCIPSolanaFeeResultInvalidError,
  CCIPSolanaLookupTableNotFoundError,
  CCIPSolanaRouterConfigNotFoundError,
  CCIPTokenAmountInvalidError,
} from '../errors/index.ts'
import { type AnyMessage, type WithLogger, ChainFamily } from '../types.ts'
import { bytesToBuffer, toLeArray } from '../utils.ts'
import { IDL as CCIP_ROUTER_IDL } from './idl/1.6.0/CCIP_ROUTER.ts'
import type { UnsignedSolanaTx } from './types.ts'
import { resolveATA, simulateTransaction, simulationProvider } from './utils.ts'

function anyToSvmMessage(message: AnyMessage): IdlTypes<typeof CCIP_ROUTER_IDL>['SVM2AnyMessage'] {
  const feeTokenPubkey = message.feeToken ? new PublicKey(message.feeToken) : PublicKey.default

  const svmMessage: IdlTypes<typeof CCIP_ROUTER_IDL>['SVM2AnyMessage'] = {
    receiver: bytesToBuffer(zeroPadValue(message.receiver, 32)),
    data: bytesToBuffer(message.data || '0x'),
    tokenAmounts: (message.tokenAmounts || []).map((ta) => {
      if (!ta.token || ta.amount < 0n) {
        throw new CCIPTokenAmountInvalidError()
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

/**
 * Gets the fee for sending a CCIP message on Solana.
 * @param ctx - Context object containing the Solana connection and logger.
 * @param router - Router program address.
 * @param destChainSelector - Destination chain selector.
 * @param message - CCIP message to send.
 * @returns Fee amount in native tokens.
 */
export async function getFee(
  ctx: { connection: Connection } & WithLogger,
  router: string,
  destChainSelector: bigint,
  message: AnyMessage,
): Promise<bigint> {
  const { connection, logger = console } = ctx
  const program = new Program(CCIP_ROUTER_IDL, new PublicKey(router), simulationProvider(ctx))

  // Get router config to find feeQuoter
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId)
  const configAccount = await connection.getAccountInfo(configPda)
  if (!configAccount) throw new CCIPSolanaRouterConfigNotFoundError(configPda.toBase58())

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
    logger.warn('feeToken is not default nor link =', linkTokenMint.toBase58())
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

  // Per FeeQuoter IDL: remaining accounts must be ordered as:
  // 1. All billing_token_config accounts (one per token, ZERO address if no billing config exists)
  // 2. All per_chain_per_token_config accounts (same order)
  const billingPdas = svmMessage.tokenAmounts.map(
    (ta) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from('fee_billing_token_config'), ta.token.toBuffer()],
        feeQuoter,
      )[0],
  )

  // Always pass the derived PDA: the program validates the key matches the
  // expected PDA, regardless of whether the account is initialized on-chain.
  const billingAccounts: AccountMeta[] = billingPdas.map((pda) => ({
    pubkey: pda,
    isWritable: false,
    isSigner: false,
  }))

  const perChainAccounts: AccountMeta[] = svmMessage.tokenAmounts.map((ta) => ({
    pubkey: PublicKey.findProgramAddressSync(
      [
        Buffer.from('per_chain_per_token_config'),
        toLeArray(destChainSelector, 8),
        ta.token.toBuffer(),
      ],
      feeQuoter,
    )[0],
    isWritable: false,
    isSigner: false,
  }))

  const remainingAccounts = [...billingAccounts, ...perChainAccounts]

  logger.debug('getFee remaining accounts:', {
    billing: billingAccounts.map((a) => a.pubkey.toBase58()),
    perChain: perChainAccounts.map((a) => a.pubkey.toBase58()),
    total: remainingAccounts.length,
    tokens: svmMessage.tokenAmounts.length,
  })

  // Use .instruction() + simulateTransaction() instead of .view() for V0 support
  const ix = await program.methods
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
    .instruction()

  const payerKey = new PublicKey('11111111111111111111111111111112')
  const simResult = await simulateTransaction(ctx, {
    payerKey,
    instructions: [ix],
  })

  if (!simResult.returnData?.data[0]) {
    throw new CCIPSolanaFeeResultInvalidError('No return data from getFee simulation')
  }

  const result: IdlTypes<typeof CCIP_ROUTER_IDL>['GetFeeResult'] = program.coder.types.decode(
    'GetFeeResult',
    Buffer.from(simResult.returnData.data[0], 'base64'),
  )

  return BigInt(result.amount.toString())
}

async function deriveAccountsCcipSend({
  router,
  destChainSelector,
  message,
  sender,
  logger = console,
}: {
  router: Program<typeof CCIP_ROUTER_IDL>
  destChainSelector: bigint
  message: IdlTypes<typeof CCIP_ROUTER_IDL>['SVM2AnyMessage']
  sender: PublicKey
} & WithLogger) {
  const connection = router.provider.connection
  const derivedAccounts: AccountMeta[] = []
  const addressLookupTableAccounts: AddressLookupTableAccount[] = []
  const resolvedLookupTables: AddressLookupTableAccount[] = []
  const tokenIndices: number[] = []
  let askWith: AccountMeta[] = []
  let stage = 'Start'
  let tokenIndex = 0

  const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from('config')], router.programId)

  while (stage) {
    const params: IdlTypes<typeof CCIP_ROUTER_IDL>['DeriveAccountsCcipSendParams'] = {
      destChainSelector: new BN(destChainSelector.toString()),
      ccipSendCaller: sender,
      message: { ...message },
    }

    // Workaround for tx-too-large issues during account derivation:
    // Trim data payload to save space, but keep tokenAmounts (so the program
    // enters token pool derivation stages) and extraArgs (validated by GetFee
    // during NestedTokenDerive stages).
    params.message = { ...message, data: Buffer.from([]) }

    // Build instruction and simulate as V0 transaction (supports address lookup tables).
    // This replaces .view() which uses legacy transactions without ALT support
    const ix = await router.methods
      .deriveAccountsCcipSend(params, stage)
      .accounts({
        config: configPDA,
      })
      .remainingAccounts(askWith)
      .instruction()

    const simResult = await simulateTransaction(
      { connection, logger },
      {
        payerKey: sender,
        instructions: [ix],
        addressLookupTableAccounts: resolvedLookupTables.length ? resolvedLookupTables : undefined,
      },
    ).catch((error: unknown) => {
      logger.error('Error deriving send accounts at stage', stage, ':', error)
      throw error as Error
    })

    // Decode return data from simulation
    if (!simResult.returnData?.data[0]) {
      throw new CCIPError(
        CCIPErrorCode.SOLANA_SIMULATION_NO_RETURN_DATA,
        'No return data from deriveAccountsCcipSend simulation',
      )
    }

    const response: IdlTypes<typeof CCIP_ROUTER_IDL>['DeriveAccountsResponse'] =
      router.coder.types.decode(
        'DeriveAccountsResponse',
        Buffer.from(simResult.returnData.data[0], 'base64'),
      )

    // Check if it is the start of a token transfer
    const isStartOfToken = /^TokenTransferStaticAccounts\/\d+\/0$/.test(response.currentStage)
    if (isStartOfToken) {
      // From CCIP_ROUTER IDL, ccipSend has 18 static accounts before remaining_accounts
      const numStaticCcipSendAccounts = 18
      tokenIndices.push(tokenIndex - numStaticCcipSendAccounts)
    }

    // Update token index
    tokenIndex += response.accountsToSave.length

    logger.debug('After stage', stage, 'tokenIndices', tokenIndices, 'nextTokenIndex', tokenIndex)

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

    // Collect lookup tables and resolve them immediately for next iteration's V0 simulation
    for (const table of response.lookUpTablesToSave) {
      const lookupTableAccountInfo = await connection.getAddressLookupTable(table)

      if (!lookupTableAccountInfo.value) {
        throw new CCIPSolanaLookupTableNotFoundError(table.toBase58())
      }

      addressLookupTableAccounts.push(lookupTableAccountInfo.value)
      resolvedLookupTables.push(lookupTableAccountInfo.value)
    }

    stage = response.nextStage
  }

  logger.debug('Resulting derived accounts:', derivedAccounts)
  logger.debug('Resulting derived address lookup tables:', addressLookupTableAccounts)
  logger.debug('Resulting derived token indexes:', tokenIndices)

  return {
    accounts: derivedAccounts,
    addressLookupTableAccounts,
    tokenIndexes: Buffer.from(tokenIndices),
  }
}

/**
 * Generates unsigned instructions for sending a message with CCIP on Solana
 * @param ctx - Context containing connection and logger.
 * @param sender - Wallet to pay transaction fees.
 * @param router - Router program instance.
 * @param destChainSelector - Destination chain selector.
 * @param message - CCIP message with fee.
 * @param opts - Optional parameters for approval.
 * @returns Solana unsigned txs (instructions and lookup tables)
 */
export async function generateUnsignedCcipSend(
  ctx: { connection: Connection } & WithLogger,
  sender: PublicKey,
  router: PublicKey,
  destChainSelector: bigint,
  message: AnyMessage & { fee: bigint },
  opts?: { approveMax?: boolean },
): Promise<UnsignedSolanaTx> {
  const amountsToApprove = (message.tokenAmounts ?? []).reduce(
    (acc, { token, amount }) => ({ ...acc, [token]: (acc[token] ?? 0n) + amount }),
    {} as Record<string, bigint>,
  )
  if (message.feeToken && message.feeToken !== PublicKey.default.toBase58()) {
    amountsToApprove[message.feeToken] = (amountsToApprove[message.feeToken] ?? 0n) + message.fee
  }
  const program = new Program(CCIP_ROUTER_IDL, router, simulationProvider(ctx, sender))

  const approveIxs = []
  for (const [token, amount] of Object.entries(amountsToApprove)) {
    const approveIx = await approveRouterSpender(
      ctx,
      sender,
      new PublicKey(token),
      router,
      opts?.approveMax ? undefined : amount,
    )
    if (approveIx) approveIxs.push(approveIx)
  }

  const svmMessage = anyToSvmMessage(message)
  const { addressLookupTableAccounts, accounts, tokenIndexes } = await deriveAccountsCcipSend({
    router: program,
    destChainSelector,
    sender,
    message: svmMessage,
    logger: ctx.logger,
  })

  const sendIx = await program.methods
    .ccipSend(new BN(destChainSelector), svmMessage, tokenIndexes)
    .accountsStrict({
      config: accounts[0]!.pubkey,
      destChainState: accounts[1]!.pubkey,
      nonce: accounts[2]!.pubkey,
      authority: accounts[3]!.pubkey,
      systemProgram: accounts[4]!.pubkey,
      feeTokenProgram: accounts[5]!.pubkey,
      feeTokenMint: accounts[6]!.pubkey,
      feeTokenUserAssociatedAccount: accounts[7]!.pubkey,
      feeTokenReceiver: accounts[8]!.pubkey,
      feeBillingSigner: accounts[9]!.pubkey,
      feeQuoter: accounts[10]!.pubkey,
      feeQuoterConfig: accounts[11]!.pubkey,
      feeQuoterDestChain: accounts[12]!.pubkey,
      feeQuoterBillingTokenConfig: accounts[13]!.pubkey,
      feeQuoterLinkTokenConfig: accounts[14]!.pubkey,
      rmnRemote: accounts[15]!.pubkey,
      rmnRemoteCurses: accounts[16]!.pubkey,
      rmnRemoteConfig: accounts[17]!.pubkey,
    })
    .remainingAccounts(accounts.slice(18))
    .instruction()
  return {
    family: ChainFamily.Solana,
    mainIndex: approveIxs.length,
    instructions: [...approveIxs, sendIx],
    lookupTables: addressLookupTableAccounts,
  }
}

async function approveRouterSpender(
  { connection, logger = console }: { connection: Connection } & WithLogger,
  owner: PublicKey,
  token: PublicKey,
  router: PublicKey,
  amount?: bigint,
): Promise<TransactionInstruction | undefined> {
  // Get the current account info to check existing delegation (or create if needed)
  const resolved = await resolveATA(connection, token, owner)
  const accountInfo = await getAccount(connection, resolved.ata, undefined, resolved.tokenProgram)

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
    resolved.tokenProgram,
  )
  logger.info(
    'Approving',
    amount ?? BigInt(Number.MAX_SAFE_INTEGER),
    'of',
    token.toBase58(),
    'tokens to router',
    router.toBase58(),
  )
  return approveIx
}
