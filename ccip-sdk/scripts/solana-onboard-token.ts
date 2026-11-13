/**
 * End-to-end CCIP 2.0 token onboarding on prod testnet (Solana devnet), against the live programs.
 *
 * 1. Deploys a fresh SPL token pre-minted to the payer (or takes `--token` to resume one).
 * 2. Onboards it with `SolanaTokenManager`: `onboardToken` with the payer's wallet, or, with
 *    `--signer external`, the Squads path, where a separate vault key signs the serialized
 *    `generateUnsignedOnboardToken` transactions, one step at a time. The payer plays the hot
 *    wallet (`lookupTablePayer`) that creates the pool lookup table, which the vault then fills.
 * 3. Reads back every account onboarding wrote, and checks the registry, pool, 1.6 lane, 2.0 lane
 *    config, FTF rate limits and mint authority.
 * 4. Sends one token to the remote chain, and checks that it goes over the 2.0 lane.
 *
 * Usage, from `ccip-sdk`:
 *
 *   node scripts/solana-onboard-token.ts [--pool-type burn-mint|lock-release]
 *     [--signer wallet|external] [--keypair ~/.config/solana/id.json] [--rpc <devnet url>]
 *     [--token <mint>] [--vault-keypair <path>] [--remote-chain ethereum-testnet-sepolia]
 *     [--remote-token 0x…] [--remote-pool 0x…] [--remote-decimals 18] [--receiver 0x…]
 *     [--skip-send]
 *
 * The payer needs about 0.5 devnet SOL. The RPC defaults to `RPC_SOLANA_DEVNET`, then the public
 * devnet endpoint. `VERBOSE=1` prints the SDK's debug logs. Exits non-zero if any check fails.
 *
 * The remote token and pool default to placeholders, which the Solana programs store but never
 * call: the source side runs end to end, but the message cannot execute on the remote chain. Pass
 * a real remote token and pool to deliver it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual, parseArgs } from 'node:util'

import { BorshCoder, Wallet } from '@coral-xyz/anchor'
import { getAssociatedTokenAddressSync, getMint, getMultisig } from '@solana/spl-token'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedMessage,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'

import { rpcEndpoint } from '../../scripts/test-endpoints.ts'
import {
  type ExecutedTokenOnboardingStep,
  type GenerateOnboardTokenParams,
  type TokenOnboardingRemoteChain,
  SolanaTokenManager,
} from '../src/cct/solana/index.ts'
import { refreshAccountState } from '../src/cct/solana/operation.ts'
import {
  deriveTokenPoolConfigPda,
  resolveTokenPoolProgram,
} from '../src/cct/solana/programs/token-pool.ts'
import '../src/evm/index.ts'
import { getCCIPExplorerUrl } from '../src/explorer.ts'
import { networkInfo } from '../src/networks.ts'
import { IDL as CCIP_ROUTER_V2_IDL } from '../src/solana/idl/2.0.0/CCIP_ROUTER.ts'
import { SolanaChain } from '../src/solana/index.ts'
import { CCIPVersion } from '../src/types.ts'

const { values: args } = parseArgs({
  options: {
    'pool-type': { type: 'string', default: 'burn-mint' },
    signer: { type: 'string', default: 'wallet' },
    keypair: { type: 'string', default: join(homedir(), '.config/solana/id.json') },
    rpc: { type: 'string' },
    token: { type: 'string' },
    'vault-keypair': { type: 'string' },
    'remote-chain': { type: 'string', default: 'ethereum-testnet-sepolia' },
    'remote-token': { type: 'string', default: '0x1111111111111111111111111111111111111111' },
    'remote-pool': { type: 'string', default: '0x2222222222222222222222222222222222222222' },
    'remote-decimals': { type: 'string', default: '18' },
    receiver: { type: 'string', default: '0x9eC0e4A4c411493773E01e2ABF4D42395788846b' },
    'skip-send': { type: 'boolean', default: false },
  },
})

const poolType = args['pool-type']
if (poolType !== 'burn-mint' && poolType !== 'lock-release')
  throw new Error(`--pool-type must be burn-mint or lock-release, not ${poolType}`)
const external = args.signer === 'external'
if (!external && args.signer !== 'wallet')
  throw new Error(`--signer must be wallet or external, not ${args.signer}`)

const remoteChain = networkInfo(
  /^\d+$/.test(args['remote-chain']) ? BigInt(args['remote-chain']) : args['remote-chain'],
)
const DECIMALS = 9
const ONE = 10n ** BigInt(DECIMALS)
const rateLimit = (capacity: bigint, rate: bigint) => ({
  enabled: true,
  capacity: capacity * ONE,
  rate: rate * ONE,
})

/** The lane config onboarding sets, including every 2.0 feature but CCVs. */
const REMOTE: TokenOnboardingRemoteChain = {
  remoteChainSelector: remoteChain.chainSelector,
  remoteTokenAddress: args['remote-token'],
  remotePoolAddresses: [args['remote-pool']],
  remoteTokenDecimals: Number(args['remote-decimals']),
  inboundRateLimiterConfig: rateLimit(100_000n, 10n),
  outboundRateLimiterConfig: rateLimit(100_000n, 10n),
  allowedFinality: { finalityDepth: 5 },
  tokenTransferFeeConfig: {
    destGasOverhead: 90_000,
    destBytesOverhead: 32,
    finalityFeeUSDCents: 10,
    fastFinalityFeeUSDCents: 20,
    finalityTransferFeeBps: 5,
    fastFinalityTransferFeeBps: 10,
    isEnabled: true,
  },
  fastFinalityRateLimits: { inbound: rateLimit(10_000n, 1n), outbound: rateLimit(10_000n, 1n) },
}

const logger = { ...console, debug: process.env.VERBOSE ? console.debug : () => {} }
const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`
const readKeypair = (path: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')) as number[]))

// The SDK's sleep unrefs its timer, so a confirmation poll alone does not keep the process
// alive: without another handle, Node exits mid-await ("unsettled top-level await")
const keepAlive = setInterval(() => {}, 60_000)

const failures: string[] = []
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) failures.push(name)
}

const payer = readKeypair(args.keypair.replace(/^~/, homedir()))
const chain = await SolanaChain.fromUrl(args.rpc ?? rpcEndpoint('RPC_SOLANA_DEVNET'), {
  apiClient: null,
  logger,
})
if (chain.network.name !== 'solana-devnet')
  throw new Error(`expected Solana devnet, got ${chain.network.name}`)
const { connection } = chain
const cct = SolanaTokenManager.fromChain(chain)
const wallet = new Wallet(payer)
const poolProgram = resolveTokenPoolProgram(poolType)

console.log(`Payer:  ${payer.publicKey.toBase58()}`)
console.log(`Pool:   ${poolType}, program ${poolProgram.toBase58()}`)
console.log(`Remote: ${remoteChain.name} (${remoteChain.chainSelector})`)

// ── The token, and the authority that onboards it ──

let tokenAddress = args.token
if (!tokenAddress) {
  const deployed = await cct.deployToken({
    decimals: DECIMALS,
    withMetaplex: false,
    preMint: 1_000_000n * ONE,
    preMintRecipient: payer.publicKey.toBase58(),
    wallet,
  })
  tokenAddress = deployed.tokenAddress
  console.log(`\nDeployed token ${tokenAddress}\n  ${explorerTx(deployed.hash)}`)
}
const mint = new PublicKey(tokenAddress)

/** The Squads stand-in: a vault key that only signs serialized messages. */
let vault: Keypair | undefined
if (external) {
  const path = args['vault-keypair']
  try {
    vault = path ? readKeypair(path) : undefined
  } catch {
    // generate it below, and save it to `path`
  }
  if (!vault) {
    vault = Keypair.generate()
    const saveTo =
      path ?? join(tmpdir(), `ccip-onboarding-vault-${vault.publicKey.toBase58()}.json`)
    writeFileSync(saveTo, JSON.stringify(Array.from(vault.secretKey)))
    console.log(
      `\nVault ${vault.publicKey.toBase58()}, saved to ${saveTo} (pass it as --vault-keypair to resume)`,
    )
  }
  if ((await connection.getBalance(vault.publicKey)) < 0.2 * LAMPORTS_PER_SOL) {
    const fund = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: vault.publicKey,
        lamports: 0.3 * LAMPORTS_PER_SOL,
      }),
    )
    await sendAndConfirmTransaction(connection, fund, [payer])
    console.log('  funded the vault with 0.3 SOL')
  }
  // The precondition: the onboarding authority holds the mint authority
  refreshAccountState(chain)
  const { mintAuthority } = await getMint(connection, mint)
  if (mintAuthority?.equals(payer.publicKey)) {
    await cct.setTokenAuthority({
      tokenAddress,
      newAuthority: vault.publicKey.toBase58(),
      authorityTypes: ['mint'],
      wallet,
    })
    console.log('  moved the mint authority to the vault')
  }
}
const authority = vault ?? payer

// ── Onboarding ──

const onboarding: GenerateOnboardTokenParams = {
  tokenAddress,
  poolType,
  remoteChains: [REMOTE],
  payer: authority.publicKey.toBase58(),
  // the payer stands in for a hot wallet, creating the pool lookup table outside the vault
  ...(external && { lookupTablePayer: payer.publicKey.toBase58() }),
}

const plan = await cct.getTokenOnboardingPlan(onboarding)
console.log(`\nPlan: ${plan.steps.map(({ name }) => name).join(' → ') || 'nothing left to do'}`)

/** Signs a serialized message with the vault, as Squads would after approval, and lands it. */
async function signAndSend(serialized: string, signer: Keypair): Promise<string> {
  const message = VersionedMessage.deserialize(Buffer.from(serialized, 'base64'))
  const tx = new VersionedTransaction(message)
  tx.sign([signer])
  const signature = await connection.sendTransaction(tx)
  const { lastValidBlockHeight } = await connection.getLatestBlockhash()
  const { value } = await connection.confirmTransaction(
    { signature, blockhash: message.recentBlockhash, lastValidBlockHeight },
    'confirmed',
  )
  if (value.err) throw new Error(`tx ${signature} failed: ${JSON.stringify(value.err)}`)
  return signature
}

let executed: ExecutedTokenOnboardingStep[] = []
if (!external) {
  const { payer: _, ...params } = onboarding
  ;({ steps: executed } = await cct.onboardToken({ ...params, wallet }))
} else {
  for (;;) {
    const next = await cct.generateUnsignedOnboardToken(onboarding)
    if (!next.step) break
    const hashes: string[] = []
    // createLookupTable is the hot wallet's alone; the vault signs every other step
    const signer = next.payer === payer.publicKey.toBase58() ? payer : authority
    for (const tx of next.transactions) {
      const serialized = await cct.serializeUnsignedTx(tx, signer.publicKey.toBase58(), 'base64')
      hashes.push(await signAndSend(serialized, signer))
    }
    executed.push({ ...next.step, hashes })
    if (next.lookupTableAddress) onboarding.poolLookupTableAddress = next.lookupTableAddress
  }
}
console.log('\nExecuted:')
for (const { name, remoteChainSelectors, hashes } of executed) {
  console.log(`  ${name}${remoteChainSelectors ? ` [${remoteChainSelectors.join(', ')}]` : ''}`)
  for (const hash of hashes) console.log(`    ${explorerTx(hash)}`)
}

// ── Checks ──

refreshAccountState(chain)
const authority58 = authority.publicKey.toBase58()
console.log('\nChecks:')
check('no onboarding step left', (await cct.getTokenOnboardingPlan(onboarding)).steps.length === 0)

const { config: pool } = await cct.getTokenPoolState({
  tokenAddress,
  poolProgramAddress: poolProgram.toBase58(),
})
check('pool owner is the authority', pool.owner === authority58, pool.owner)

const registry = await cct.getTokenAdminRegistry({ tokenAddress, address: pool.router })
check('token administrator is the authority', registry.administrator === authority58)
check('no pending administrator', !registry.pendingAdministrator)
check('pool lookup table is set', !!registry.lookupTable, registry.lookupTable)
check(
  'pool is on the 2.0 interface',
  registry.interfaceVersion === 2,
  `v${registry.interfaceVersion}`,
)
check(
  'account resolution is Standard',
  registry.accountResolution === 'Standard',
  registry.accountResolution,
)

const remote = (
  await cct.getTokenPoolRemotes({
    tokenAddress,
    poolProgramAddress: poolProgram.toBase58(),
    remoteChainSelector: remoteChain.chainSelector,
  })
)[remoteChain.name]
check('remote chain is connected', !!remote)
if (remote) {
  check(
    'remote token and pool',
    remote.remoteToken.toLowerCase() === REMOTE.remoteTokenAddress.toLowerCase() &&
      remote.remotePools.map((p) => p.toLowerCase()).join() ===
        REMOTE.remotePoolAddresses.map((p) => p.toLowerCase()).join(),
  )
  check(
    'lane rate limits',
    remote.outboundRateLimiterState?.capacity === REMOTE.outboundRateLimiterConfig.capacity &&
      remote.inboundRateLimiterState?.capacity === REMOTE.inboundRateLimiterConfig.capacity,
  )
  const fast = 'fastOutboundRateLimiterState' in remote ? remote : undefined
  check(
    'FTF rate limits',
    fast?.fastOutboundRateLimiterState?.capacity ===
      REMOTE.fastFinalityRateLimits!.outbound.capacity &&
      fast?.fastInboundRateLimiterState?.capacity ===
        REMOTE.fastFinalityRateLimits!.inbound.capacity,
    `outbound ${fast?.fastOutboundRateLimiterState?.capacity}`,
  )
}

const poolAddress = deriveTokenPoolConfigPda(poolProgram, mint).toBase58()
const lane = await chain.getTokenPoolConfig(poolAddress, {
  destChainSelector: remoteChain.chainSelector,
})
check(
  '2.0 lane allowed finality',
  lane.finalityDepth === REMOTE.allowedFinality!.finalityDepth,
  `finalityDepth ${lane.finalityDepth}`,
)
check(
  '2.0 lane transfer fees',
  isDeepStrictEqual(lane.tokenTransferFeeConfig, REMOTE.tokenTransferFeeConfig),
)

const { mintAuthority } = await getMint(connection, mint)
if (poolType === 'lock-release') {
  check('mint authority is the authority', mintAuthority?.toBase58() === authority58)
} else {
  const { mintMultisigAddress } = await cct.getTokenOnboardingPlan(onboarding)
  check(
    'mint authority is the onboarding multisig',
    !!mintAuthority && mintAuthority.toBase58() === mintMultisigAddress,
    mintAuthority?.toBase58() ?? 'revoked',
  )
  if (mintAuthority) {
    const multisig = await getMultisig(connection, mintAuthority)
    const signers = [multisig.signer1, multisig.signer2].slice(0, multisig.n)
    check(
      'multisig is 1-of-2: the pool signer and the authority',
      multisig.m === 1 &&
        signers.map((k) => k.toBase58()).join() === [pool.poolSigner, authority58].join(),
    )
  }
}

// ── A transfer over the 2.0 lane ──

/** Whether the lane's 2.0 sender allowlist, if enabled, lets `sender` send. */
async function laneAllowsSender(router: PublicKey, sender: PublicKey): Promise<boolean> {
  const selectorLe = Buffer.alloc(8)
  selectorLe.writeBigUInt64LE(remoteChain.chainSelector)
  const [laneState] = PublicKey.findProgramAddressSync(
    [Buffer.from('dest_chain_state_v2'), selectorLe],
    router,
  )
  const { value: account } = await connection.getAccountInfoAndContext(laneState)
  if (!account) throw new Error(`the router has no 2.0 lane to ${remoteChain.name}`)
  const { config } = new BorshCoder(CCIP_ROUTER_V2_IDL).accounts.decode<{
    config: { allowListEnabled: boolean; allowedSenders: PublicKey[] }
  }>('destChainCcipV2', account.data)
  return !config.allowListEnabled || config.allowedSenders.some((s) => s.equals(sender))
}

if (args['skip-send']) {
  console.log('\nSkipping the transfer (--skip-send)')
} else if (!(await laneAllowsSender(new PublicKey(pool.router), payer.publicKey))) {
  console.log(
    `\nSkipping the transfer: the ${remoteChain.name} 2.0 lane has its sender allowlist enabled, ` +
      `without ${payer.publicKey.toBase58()}. Ask for the payer to be allowlisted, or pass --skip-send.`,
  )
  failures.push('transfer over the 2.0 lane (sender not allowlisted)')
} else {
  const amount = ONE
  const ata = getAssociatedTokenAddressSync(mint, payer.publicKey)
  const balance = async () => BigInt((await connection.getTokenAccountBalance(ata)).value.amount)
  const before = await balance()
  console.log(`\nSending 1 token to ${args.receiver} on ${remoteChain.name}…`)
  const request = await chain.sendMessage({
    router: pool.router,
    destChainSelector: remoteChain.chainSelector,
    message: {
      receiver: args.receiver,
      tokenAmounts: [{ token: tokenAddress, amount }],
      extraArgs: { finality: 'finalized' },
    },
    wallet,
    sendV2OnAllowlistedLanes: true,
  })
  console.log(`  ${explorerTx(request.tx.hash)}`)
  console.log(`  ${getCCIPExplorerUrl('msg', request.message.messageId)}`)
  check(
    'transfer went over the 2.0 lane',
    request.lane.version === CCIPVersion.V2_0,
    request.lane.version,
  )
  check('tokens left the sender', before - (await balance()) === amount)
}

console.log(`\nToken ${tokenAddress}, pool ${poolAddress}`)
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed: ${failures.join('; ')}`)
  process.exitCode = 1
} else {
  console.log('\nAll checks passed.')
}
clearInterval(keepAlive)
