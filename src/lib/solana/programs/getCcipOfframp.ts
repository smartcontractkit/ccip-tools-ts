import { Program } from '@coral-xyz/anchor'
import type { Connection } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import type {  SupportedSolanaCCIPVersion } from './versioning'
import { SolanaCCIPIdl} from './versioning'
import { CCIP_SOLANA_VERSION_MAP } from './versioning'

export const getCcipOfframp = ({
  ccipVersion,
  address,
  connection,
}: {
  ccipVersion: SupportedSolanaCCIPVersion
  address: string
  connection: Connection
}) => {
  const program = new Program(
    CCIP_SOLANA_VERSION_MAP[ccipVersion][SolanaCCIPIdl.OffRamp].idl,
    new PublicKey(address),
    { connection },
  )

  return program
}

export type OfframpProgram = Awaited<ReturnType<typeof getCcipOfframp>>
