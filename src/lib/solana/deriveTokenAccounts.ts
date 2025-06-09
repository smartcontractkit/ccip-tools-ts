import { ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token'
import type { AccountMeta, AddressLookupTableAccount, Connection } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import { CCIPVersion } from '../types.ts'
import { getCcipCommonReadOnly } from './programs/getCcipCommon.ts'
import type { OfframpProgram } from './programs/getCcipOfframp.ts'
import { getTokenPoolAccountsLookupTable } from './getTokenPoolAccountsLookupTable.ts'
import type { MessageWithAccounts } from './utils.ts'
import { BN } from 'bn.js'

type BuildTokenAccountsParams = {
  connection: Connection
  offrampProgram: OfframpProgram
  message: MessageWithAccounts
  routerProgramPubkey: PublicKey
  feeQuoterPubkey: PublicKey
  remainingAccounts: AccountMeta[]
}

export function deriveUserTokenAccount({
  tokenReceiver,
  tokenProgram,
  mint,
}: {
  tokenReceiver: PublicKey
  tokenProgram: PublicKey
  mint: PublicKey
}): PublicKey {
  const [userTokenAccount] = PublicKey.findProgramAddressSync(
    [tokenReceiver.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )

  return userTokenAccount
}

export function derivePerChainTokenConfig({
  chainSelector,
  mint,
  feeQuoterPubkey,
}: {
  chainSelector: bigint
  mint: PublicKey
  feeQuoterPubkey: PublicKey
}): PublicKey {
  const [perChainTokenConfig] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('per_chain_per_token_config'),
      new BN(chainSelector.toString()).toArrayLike(Buffer, 'le', 8),
      mint.toBuffer(),
    ],
    feeQuoterPubkey,
  )
  return perChainTokenConfig
}

export function derivePoolChainConfig({
  chainSelector,
  mint,
  poolProgram,
}: {
  chainSelector: bigint
  mint: PublicKey
  poolProgram: PublicKey
}): PublicKey {
  const [poolChainConfig] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('ccip_tokenpool_chainconfig'),
      new BN(chainSelector.toString()).toArrayLike(Buffer, 'le', 8),
      mint.toBuffer(),
    ],
    poolProgram,
  )
  return poolChainConfig
}

export function deriveCcipOfframpPoolsSigner({
  poolPubkey,
  offrampPubkey,
}: {
  poolPubkey: PublicKey
  offrampPubkey: PublicKey
}): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('external_token_pools_signer'), poolPubkey.toBuffer()],
    offrampPubkey,
  )
}

export function deriveCcipRouterPoolsSigner(
  poolProgram: PublicKey,
  routerProgramId: PublicKey,
): PublicKey {
  const [ccipRouterPoolsSigner] = PublicKey.findProgramAddressSync(
    [Buffer.from('external_token_pool'), poolProgram.toBuffer()],
    routerProgramId,
  )
  return ccipRouterPoolsSigner
}

async function getWritableIndexes(
  connection: Connection,
  mint: PublicKey,
  routerPubkey: PublicKey,
): Promise<boolean[]> {
  // 1. Create program instance
  const program = getCcipCommonReadOnly({
    ccipVersion: CCIPVersion.V1_6,
    address: routerPubkey.toBase58(),
    connection,
  })

  // 2. Find the TokenAdminRegistry PDA
  const [tokenAdminRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_admin_registry'), mint.toBuffer()],
    routerPubkey,
  )

  const tokenAdminRegistry = await program.account.tokenAdminRegistry.fetch(tokenAdminRegistryPda)

  // Convert the two u128 values to a single 256-bit number
  const writableBits = new BN(tokenAdminRegistry.writableIndexes[0])
    .shln(128)
    .add(new BN(tokenAdminRegistry.writableIndexes[1]))
  const binaryString = writableBits.toString(2).padStart(256, '0')

  return Array.from(binaryString).map((bit) => bit === '1')
}

export async function deriveTokenAccounts(params: BuildTokenAccountsParams): Promise<{
  tokenAccounts: AccountMeta[]
  addressLookupTableAccounts: AddressLookupTableAccount[]
  tokenIndexes: number[]
}> {
  const { connection, offrampProgram, routerProgramPubkey, message, remainingAccounts } = params

  const tokenIndexes: number[] = []
  const tokenAccounts: AccountMeta[] = []
  const addressLookupTableAccounts: AddressLookupTableAccount[] = []

  // Process each token transfer
  for (let i = 0; i < message.tokenAmounts.length; i++) {
    tokenIndexes.push(i + remainingAccounts.length)
    const tokenAmount = message.tokenAmounts[i]

    const tokenPoolAccountsLookupTable = await getTokenPoolAccountsLookupTable({
      connection,
      routerPubkey: routerProgramPubkey,
      mint: new PublicKey(message.tokenAmounts[0].destTokenAddress),
    })

    addressLookupTableAccounts.push(tokenPoolAccountsLookupTable)

    const tokenProgram = tokenPoolAccountsLookupTable.state.addresses[6]
    const poolProgram = tokenPoolAccountsLookupTable.state.addresses[2]

    // Derive necessary accounts
    const userTokenAccount = deriveUserTokenAccount({
      tokenReceiver: new PublicKey(message.tokenReceiver),
      tokenProgram,
      mint: new PublicKey(tokenAmount.destTokenAddress),
    })

    const perChainTokenConfig = derivePerChainTokenConfig({
      chainSelector: message.header.sourceChainSelector,
      mint: new PublicKey(tokenAmount.destTokenAddress),
      feeQuoterPubkey: params.feeQuoterPubkey,
    })

    const poolChainConfig = derivePoolChainConfig({
      chainSelector: message.header.sourceChainSelector,
      mint: new PublicKey(tokenAmount.destTokenAddress),
      poolProgram,
    })

    const [ccipOfframpPoolsSigner] = deriveCcipOfframpPoolsSigner({
      poolPubkey: poolProgram,
      offrampPubkey: offrampProgram.programId,
    })

    const writableIndexes = await getWritableIndexes(
      connection,
      new PublicKey(tokenAmount.destTokenAddress),
      routerProgramPubkey,
    )

    // Add accounts in the correct order
    tokenAccounts.push(
      { pubkey: ccipOfframpPoolsSigner, isWritable: false, isSigner: false },
      { pubkey: userTokenAccount, isWritable: true, isSigner: false },
      { pubkey: perChainTokenConfig, isWritable: false, isSigner: false },
      { pubkey: poolChainConfig, isWritable: true, isSigner: false },
    )

    tokenPoolAccountsLookupTable.state.addresses.forEach((pubkey, index) => {
      tokenAccounts.push({
        pubkey,
        isWritable: writableIndexes[index] ?? false,
        isSigner: false,
      })
    })
  }

  return { tokenAccounts, addressLookupTableAccounts, tokenIndexes }
}
