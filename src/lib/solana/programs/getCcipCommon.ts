import { Program } from '@coral-xyz/anchor'
import type { Connection } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import type { SupportedSolanaCCIPVersion } from './versioning'
import { CCIP_SOLANA_VERSION_MAP } from './versioning'

export const getCcipCommon = ({
  ccipVersion,
  address,
  connection,
}: {
  ccipVersion: SupportedSolanaCCIPVersion
  address: string
  connection: Connection
}) => {
  const program = new Program(
    CCIP_SOLANA_VERSION_MAP[ccipVersion].COMMON.idl,
    new PublicKey(address),
    { connection },
  )

  return program
}

export type CommonProgram = Awaited<ReturnType<typeof getCcipCommon>>
