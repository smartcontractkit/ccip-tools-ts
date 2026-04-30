/**
 * CCIP CLI Safe-Propose Command
 *
 * Proposes a CCIP send as a Safe multisig transaction.
 * The transaction is submitted to the Safe Transaction Service queue without
 * immediate on-chain execution, so other Safe owners can review and sign in the Safe UI.
 *
 * If the CCIP send requires ERC-20 approvals (token transfers or LINK fee), those are
 * proposed as separate transactions ahead of the ccipSend, with sequential nonces so
 * they can be executed in order.
 *
 * @example
 * ```bash
 * # Propose a data-only CCIP send from a Safe
 * ccip-cli safe-propose -s ethereum-testnet-sepolia -d arbitrum-sepolia \
 *   -r 0xRouter... --safe 0xSafeAddress... --to 0xReceiver... \
 *   --data "hello" --wallet 0xProposerPrivKey
 *
 * # Propose a token transfer (will queue approve + ccipSend)
 * ccip-cli safe-propose -s ethereum-testnet-sepolia -d arbitrum-sepolia \
 *   -r 0xRouter... --safe 0xSafe... -t 0xToken=1.5 --wallet foundry:mykey
 * ```
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync } from 'node:fs'

import {
  type ChainStatic,
  type EVMChain,
  type MessageInput,
  CCIPArgumentInvalidError,
  CCIPTokenNotFoundError,
  ChainFamily,
  bigIntReplacer,
  decodeAddress,
  getDataBytes,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import {
  type BytesLike,
  AbiCoder,
  BaseWallet,
  formatUnits,
  getAddress,
  isAddress,
  toUtf8Bytes,
} from 'ethers'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { type Ctx, Format } from './types.ts'
import { getCtx, logParsedError, parseExtraArgs, parseTokenAmounts } from './utils.ts'
import { RPCS_RE, fetchChainsFromRpcs, loadChainWallet } from '../providers/index.ts'

/**
 * Minimal interface for the Safe Protocol Kit instance methods used in this command.
 * We define our own interface rather than importing the full SDK types to avoid
 * TypeScript NodeNext CJS interop issues with the `@safe-global/protocol-kit` package.
 */
type SafeTxSignature = { data: string }
type SafeTx = {
  data: unknown
  getSignature(signerAddress: string): SafeTxSignature | undefined
}
type SafeProtocolKitInstance = {
  getNonce(): Promise<number>
  createTransaction(opts: {
    transactions: ReadonlyArray<{ to: string; data: string; value: string }>
    options?: { nonce: number }
  }): Promise<SafeTx>
  getTransactionHash(safeTransaction: SafeTx): Promise<string>
  signTransaction(safeTransaction: SafeTx): Promise<SafeTx>
}

type SafeProtocolKitConstructor = {
  init(config: {
    provider: string
    signer?: string
    safeAddress: string
  }): Promise<SafeProtocolKitInstance>
}

type SafeApiKitInstance = {
  proposeTransaction(params: {
    safeAddress: string
    safeTransactionData: unknown
    safeTxHash: string
    senderAddress: string
    senderSignature: string
  }): Promise<void>
}

type SafeApiKitConstructor = new (config: {
  chainId: bigint
  txServiceUrl?: string
  apiKey?: string
}) => SafeApiKitInstance

export const command = 'safe-propose'
export const describe = 'Propose a CCIP send as a Safe multisig transaction'

/**
 * Extracts the first available RPC URL from CLI args, RPC_* env vars, or rpcsFile.
 * Needed to initialise the Safe Protocol Kit, which requires a single concrete URL.
 */
function extractFirstRpcUrl(argv: { rpcs?: string[]; rpcsFile?: string }): string {
  if (argv.rpcs?.length) {
    const url = argv.rpcs
      .flatMap((s) => s.split(','))
      .map((s) => s.trim())
      .find((s) => RPCS_RE.test(s))
    if (url) return url
  }
  for (const [key, val] of Object.entries(process.env)) {
    if (key.startsWith('RPC_') && val) {
      const m = val.match(RPCS_RE)
      if (m) return m[0]
    }
  }
  if (argv.rpcsFile && existsSync(argv.rpcsFile)) {
    try {
      for (const line of readFileSync(argv.rpcsFile, 'utf8').split(/\r?\n/)) {
        const m = line.match(RPCS_RE)
        if (m) return m[0]
      }
    } catch (_) {
      // pass
    }
  }
  throw new CCIPArgumentInvalidError(
    'rpcs',
    'No RPC URL found. Provide --rpc <url> for the source chain so the Safe SDK can connect.',
  )
}

/**
 * Yargs builder for the safe-propose command.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('source', {
      alias: 's',
      type: 'string',
      demandOption: true,
      describe: 'Source chain: chainId, selector, or name',
    })
    .option('dest', {
      alias: 'd',
      type: 'string',
      demandOption: true,
      describe: 'Destination chain: chainId, selector, or name',
    })
    .option('router', {
      alias: 'r',
      type: 'string',
      demandOption: true,
      describe: 'Router contract address on source',
    })
    .option('safe', {
      type: 'string',
      demandOption: true,
      describe: 'Safe multisig address — this will be the CCIP message sender',
    })
    .options({
      receiver: {
        alias: 'to',
        type: 'string',
        describe:
          'Receiver address on destination; defaults to the Safe address if same chain family',
      },
      data: {
        type: 'string',
        describe:
          "Data payload: 0x-bytearrays used as-is; '0x:' prefix will be string abi.encoded; otherwise raw-UTF-8 encoded",
      },
      'gas-limit': {
        alias: ['L', 'compute-units'],
        type: 'number',
        describe: 'Gas limit for receiver callback; defaults to ramp config',
      },
      'allow-out-of-order-exec': {
        alias: 'ooo',
        type: 'boolean',
        describe: 'Allow out-of-order execution (v1.5+ lanes)',
      },
      'fee-token': {
        type: 'string',
        describe: 'Fee token address or symbol (default: native)',
      },
      'transfer-tokens': {
        alias: 't',
        type: 'array',
        string: true,
        describe: 'Token amounts to transfer: token=amount',
      },
      wallet: {
        alias: 'w',
        type: 'string',
        describe:
          'Proposer wallet: private key, foundry:<name>, or hardhat:<name>. Ledger is not supported for Safe proposals.',
      },
      'token-receiver': {
        type: 'string',
        describe: 'Token receiver address on destination if different from --receiver',
      },
      extra: {
        alias: 'x',
        type: 'array',
        string: true,
        describe:
          'Extra args: key=value (value parsed as JSON with bigint support, fallback to string; repeated keys become arrays)',
        example: '-x gasLimit=200000',
      },
      'approve-max': {
        type: 'boolean',
        describe: 'Approve max uint256 instead of exact amount for any required ERC-20 approvals',
      },
      'safe-api-key': {
        type: 'string',
        describe:
          'API key for the Safe Transaction Service (required for app.safe.global; can also be set via SAFE_API_KEY env var)',
      },
      'safe-service-url': {
        type: 'string',
        describe:
          'Override Safe Transaction Service URL (default: official Safe service for the source chain)',
      },
    })
    .check(
      ({ 'transfer-tokens': transferTokens }) =>
        !transferTokens || transferTokens.every((t) => /^[^=]+=\d+(\.\d+)?$/.test(t)),
    )
    .check(({ extra }) => !extra || extra.every((e) => /^[^=]+=/.test(e)))
    .example([
      [
        'ccip-cli safe-propose -s ethereum-testnet-sepolia -d arbitrum-sepolia -r 0xRouter... --safe 0xSafe... --to 0xReceiver... --data "hello" --wallet 0xPK',
        'Propose a data-only CCIP send from a Safe',
      ],
      [
        'ccip-cli safe-propose -s ethereum-testnet-sepolia -d arbitrum-sepolia -r 0xRouter... --safe 0xSafe... -t 0xToken=1.5 --wallet foundry:mykey --safe-api-key $SAFE_API_KEY',
        'Propose a token transfer (queues approve + ccipSend)',
      ],
    ])

/**
 * Handler for the safe-propose command.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return proposeMessage(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

async function proposeMessage(
  ctx: Ctx,
  argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts,
) {
  const { output, logger } = ctx

  // 1. Validate and checksum the Safe address
  let safeAddress: string
  try {
    safeAddress = getAddress(argv.safe)
  } catch {
    throw new CCIPArgumentInvalidError('safe', `Invalid address: ${argv.safe}`)
  }

  const sourceNetwork = networkInfo(argv.source)
  const destNetwork = networkInfo(argv.dest)
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const source = await getChain(sourceNetwork.name)

  if (source.network.family !== ChainFamily.EVM) {
    throw new CCIPArgumentInvalidError('source', 'safe-propose only supports EVM source chains')
  }

  decodeAddress(argv.router, sourceNetwork.family)

  // 2. Resolve data payload
  let data: BytesLike | undefined
  if (argv.data) {
    try {
      data = getDataBytes(argv.data)
    } catch (_) {
      if (argv.data.startsWith('0x:')) {
        data = AbiCoder.defaultAbiCoder().encode(['string'], [argv.data.substring(3)])
      } else {
        data = toUtf8Bytes(argv.data)
      }
    }
  }

  // 3. Parse token amounts
  const tokenAmounts: { token: string; amount: bigint }[] = argv.transferTokens?.length
    ? await parseTokenAmounts(source, argv.transferTokens)
    : []

  // Default receiver: the Safe address itself (same as send.ts defaulting to sender)
  const receiver = argv.receiver ?? safeAddress

  // 4. Resolve fee token
  let feeToken: string | undefined, feeTokenInfo
  if (argv.feeToken) {
    try {
      feeToken = (source.constructor as ChainStatic).getAddress(argv.feeToken)
      feeTokenInfo = await source.getTokenInfo(feeToken)
    } catch (_) {
      const feeTokens = await source.getFeeTokens(argv.router)
      logger.debug('supported feeTokens:', feeTokens)
      for (const [token, info] of Object.entries(feeTokens)) {
        if (info.symbol === 'UNKNOWN' || info.symbol !== argv.feeToken) continue
        feeToken = token
        feeTokenInfo = info
        break
      }
      if (!feeTokenInfo) throw new CCIPTokenNotFoundError(argv.feeToken)
    }
  } else {
    const nativeToken = await source.getNativeTokenForRouter(argv.router)
    feeTokenInfo = await source.getTokenInfo(nativeToken)
  }

  // 5. Build extra args
  const extraArgs = {
    ...(argv.allowOutOfOrderExec != null && {
      allowOutOfOrderExecution: !!argv.allowOutOfOrderExec,
    }),
    ...(argv.gasLimit == null ? {} : { gasLimit: BigInt(argv.gasLimit) }),
    ...(!!argv.tokenReceiver && { tokenReceiver: argv.tokenReceiver }),
    ...parseExtraArgs(argv.extra),
  }

  const message: MessageInput = {
    receiver,
    data,
    extraArgs,
    feeToken,
    tokenAmounts,
  }

  // 6. Calculate fee
  const fee = await source.getFee({
    router: argv.router,
    destChainSelector: destNetwork.chainSelector,
    message,
  })

  const displaySymbol =
    !argv.feeToken && feeTokenInfo.symbol.startsWith('W')
      ? feeTokenInfo.symbol.substring(1)
      : feeTokenInfo.symbol

  logger.info('Fee:', fee, '=', formatUnits(fee, feeTokenInfo.decimals), displaySymbol)

  // 7. Warn if Safe fee balance is insufficient (informational — Safe owners must fund before execution)
  try {
    const balance = await source.getBalance({ holder: safeAddress, token: feeToken })
    if (balance < fee) {
      logger.warn(
        `Safe balance may be insufficient for fee: has ${formatUnits(balance, feeTokenInfo.decimals)} ${displaySymbol},` +
          ` needs ${formatUnits(fee, feeTokenInfo.decimals)} ${displaySymbol}.` +
          ` Ensure the Safe is funded before owners execute the queued transaction.`,
      )
    }
  } catch (e) {
    logger.debug('Balance check skipped:', e)
  }

  // 8. Generate unsigned transactions: 0..n-1 are ERC-20 approvals, last is ccipSend.
  //    The Safe address is used as sender so allowance checks are performed against it.
  const txSet = await (source as EVMChain).generateUnsignedSendMessage({
    sender: safeAddress,
    router: argv.router,
    destChainSelector: destNetwork.chainSelector,
    message: { ...message, fee },
    approveMax: argv.approveMax,
  })

  const allTxs = txSet.transactions
  const approveTxCount = allTxs.length - 1

  // Build token address → symbol map for labelling approve transactions
  const tokenSymbolMap = new Map<string, string>()
  if (approveTxCount > 0) {
    if (feeToken) tokenSymbolMap.set(feeToken.toLowerCase(), feeTokenInfo.symbol)
    await Promise.all(
      tokenAmounts.map(async ({ token }) => {
        try {
          const info = await source.getTokenInfo(token)
          tokenSymbolMap.set(token.toLowerCase(), info.symbol)
        } catch {
          // fall back to address prefix if token info unavailable
        }
      }),
    )
  }

  if (approveTxCount > 0) {
    logger.info(`${approveTxCount} ERC-20 approval(s) needed — will be queued before the ccipSend.`)
  }

  // 9. Load proposer wallet and extract private key.
  //    The proposer signs the Safe transaction hash to submit it to the queue.
  //    Only private-key-based wallets are supported; hardware wallets cannot expose raw keys.
  const [proposerAddress, proposerSigner] = await loadChainWallet(source, argv, logger)

  if (!(proposerSigner instanceof BaseWallet)) {
    throw new CCIPArgumentInvalidError(
      'wallet',
      'Only private-key based wallets are supported for Safe proposals' +
        ' (raw private key, foundry:<name>, hardhat:<name>). Ledger is not supported.',
    )
  }
  const proposerPrivateKey = proposerSigner.signingKey.privateKey

  // 10. Get a concrete RPC URL for the Safe Protocol Kit
  const rpcUrl = extractFirstRpcUrl(argv)

  // 11. Lazy-load the Safe SDK.
  // Dynamic imports with `as any` casts are necessary to work around a TypeScript NodeNext
  // CJS interop issue: @safe-global packages have no "type":"module", causing TS to
  // resolve the module namespace as the default export type, making it circular.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const safeModule = (await import('@safe-global/protocol-kit')) as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const apiKitModule = (await import('@safe-global/api-kit')) as any
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const SafeSDK = safeModule.default as SafeProtocolKitConstructor
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const SafeApiKitSDK = apiKitModule.default as SafeApiKitConstructor
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const getEip3770Prefix = safeModule.getEip3770NetworkPrefixFromChainId as (
    chainId: bigint,
  ) => string

  // 12. Initialise the Safe Protocol Kit
  const protocolKit = await SafeSDK.init({
    provider: rpcUrl,
    signer: proposerPrivateKey,
    safeAddress,
  })

  // 13. Resolve API key (flag > env var)
  const apiKey = argv.safeApiKey ?? process.env['SAFE_API_KEY']

  // 14. Initialise the Safe API Kit
  const chainId = BigInt(sourceNetwork.chainId) // chainId is always a number for EVM networks
  const apiKit = new SafeApiKitSDK({
    chainId,
    ...(argv.safeServiceUrl ? { txServiceUrl: argv.safeServiceUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  })

  // 15. Fetch the current Safe nonce so sequential proposals get consecutive nonces.
  //    Without explicit nonces, all proposed txs would share the same pending nonce
  //    and only one could ever execute.
  const baseNonce = await protocolKit.getNonce()

  logger.info(
    `Proposing ${allTxs.length} transaction(s) to Safe ${safeAddress}` +
      ` starting at nonce ${baseNonce}...`,
  )

  // 16. Propose each transaction
  const proposed: Array<{ hash: string; label: string }> = []

  for (const [i, tx] of allTxs.entries()) {
    const isLast = i === allTxs.length - 1
    const toAddress = typeof tx.to === 'string' ? tx.to : ''
    const approveSymbol = tokenSymbolMap.get(toAddress.toLowerCase()) ?? `token[${i}]`
    const label = isLast ? 'ccipSend' : `approve(${approveSymbol})`
    const safeTransaction = await protocolKit.createTransaction({
      transactions: [
        {
          to: isAddress(toAddress)
            ? getAddress(toAddress) // ensure EIP-55 checksum — Safe API requires it
            : toAddress,
          data: tx.data?.toString() ?? '0x',
          value: (tx.value ?? 0n).toString(),
        },
      ],
      options: { nonce: baseNonce + i },
    })

    const signedTx = await protocolKit.signTransaction(safeTransaction)
    const safeTxHash = await protocolKit.getTransactionHash(signedTx)
    const signature = signedTx.getSignature(proposerAddress)
    if (!signature) {
      throw new Error(
        `Failed to get signature for ${proposerAddress}. Ensure this address is an owner of the Safe ${safeAddress}.`,
      )
    }

    try {
      await apiKit.proposeTransaction({
        safeAddress,
        safeTransactionData: signedTx.data,
        safeTxHash,
        senderAddress: proposerAddress,
        senderSignature: signature.data,
      })
    } catch (err) {
      // Re-throw with the raw Safe API response body if available, so field-level
      // validation errors (e.g. address checksum failures) are visible instead of
      // the generic "Unprocessable Content" status text.
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'Unprocessable Content') {
        const toField = (signedTx.data as Record<string, unknown>)['to']
        throw new Error(
          `Safe Transaction Service rejected the proposal (422 Unprocessable Content).\n` +
            `safeTxHash=${safeTxHash}\n` +
            `to=${String(toField)}\n` +
            `senderAddress=${proposerAddress}\n` +
            `nonce=${baseNonce + i}\n` +
            `Verify that the proposer address is an owner/proposer of the Safe and that the Safe address is correct on this network.`,
          { cause: err },
        )
      }
      throw err
    }

    proposed.push({ hash: safeTxHash, label })
    logger.info(`  ✓ Proposed ${label} (nonce ${baseNonce + i}): ${safeTxHash}`)
  }

  // 17. Build Safe UI queue URL using the EIP-3770 short name from the protocol-kit
  let safeUiUrl: string
  try {
    const shortName = getEip3770Prefix(chainId)
    safeUiUrl = `https://app.safe.global/transactions/queue?safe=${shortName}:${safeAddress}`
  } catch {
    safeUiUrl = `https://app.safe.global` // fallback for chains not yet in Safe's registry
  }

  if (argv.format === Format.json) {
    output.write(
      JSON.stringify(
        {
          safeAddress,
          proposer: proposerAddress,
          transactionsProposed: allTxs.length,
          approvalsProposed: approveTxCount,
          fee: fee.toString(),
          feeFormatted: `${formatUnits(fee, feeTokenInfo.decimals)} ${displaySymbol}`,
          proposedHashes: proposed.map((p) => p.hash),
          safeUiUrl,
        },
        bigIntReplacer,
        2,
      ),
    )
  } else {
    output.write(`\nView & sign in Safe UI:\n  ${safeUiUrl}`)
    output.write(`\nProposed safeTxHashes:`)
    for (const { hash, label } of proposed) {
      output.write(`  ${label}: ${hash}`)
    }
    if (approveTxCount > 0) {
      output.write(`\nNote: execute the approval(s) in the Safe UI before executing the ccipSend.`)
    }
    output.write(
      `\nOnce ccipSend is executed, track CCIP delivery with:\n  ccip-cli show <onChainTxHash>`,
    )
  }
}
