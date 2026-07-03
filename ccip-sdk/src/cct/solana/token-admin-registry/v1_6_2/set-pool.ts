import { Buffer } from 'buffer'

import { Program } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { IDL as CCIP_ROUTER_IDL } from '../../../../solana/idl/1.6.0/CCIP_ROUTER.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { type UnsignedSolanaTx, isWallet } from '../../../../solana/types.ts'
import { simulationProvider } from '../../../../solana/utils.ts'
import type { CctTxResult } from '../../../token-manager.ts'
import { submit } from '../../submit.ts'
import { derivePda } from '../../utils.ts'
import { validatePublicKey } from '../../validate.ts'
import { type SolanaCCTVersionHint, SOLANA_CCT_VERSION } from '../../versions.ts'

export const OPERATION = 'setPool'

/** Parameters for Solana TokenAdminRegistry `setPool`. */
export type SetPoolParams = SolanaCCTVersionHint & {
  tokenAddress: string
  routerAddress: string
  poolLookupTableAddress: string
}

/** Parameters for unsigned Solana TokenAdminRegistry `setPool` generation. */
export type GenerateSetPoolParams = SetPoolParams & {
  payer: string
  authority?: string
}

function validate(params: GenerateSetPoolParams): void {
  validatePublicKey(OPERATION, 'tokenAddress', params.tokenAddress)
  validatePublicKey(OPERATION, 'routerAddress', params.routerAddress)
  validatePublicKey(OPERATION, 'poolLookupTableAddress', params.poolLookupTableAddress)
  validatePublicKey(OPERATION, 'payer', params.payer)
  if (params.authority) validatePublicKey(OPERATION, 'authority', params.authority)
}

/** Builds the unsigned Solana `setPool` instruction set. */
export async function generate(
  chain: SolanaChain,
  opts: GenerateSetPoolParams,
): Promise<UnsignedSolanaTx> {
  validate(opts)

  const router = new PublicKey(opts.routerAddress)
  const tokenMint = new PublicKey(opts.tokenAddress)
  const payer = new PublicKey(opts.payer)
  const authority = new PublicKey(opts.authority ?? opts.payer)
  const lookupTable = new PublicKey(opts.poolLookupTableAddress)

  const routerProgram = new Program(CCIP_ROUTER_IDL, router, simulationProvider(chain, payer))
  const config = derivePda('config', router)
  const tokenAdminRegistry = derivePda('token_admin_registry', router, [tokenMint.toBuffer()])

  const instruction = await routerProgram.methods
    .setPool(Buffer.from([3, 4, 7]))
    .accounts({
      config,
      tokenAdminRegistry,
      mint: tokenMint,
      poolLookuptable: lookupTable,
      authority,
    })
    .instruction()

  chain.logger.debug(
    `${OPERATION}: version = ${SOLANA_CCT_VERSION}, router = ${router.toBase58()}, token = ${tokenMint.toBase58()}, lookupTable = ${lookupTable.toBase58()}`,
  )
  return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
}

/** Builds and submits Solana `setPool` with `opts.wallet`. */
export async function execute(
  chain: SolanaChain,
  opts: SetPoolParams & { wallet: unknown },
): Promise<CctTxResult> {
  const { wallet, ...params } = opts
  if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)
  const payer = wallet.publicKey.toBase58()
  const unsigned = await generate(chain, { ...params, payer })
  return submit(chain, wallet, unsigned, OPERATION)
}
