import { Program } from '@coral-xyz/anchor'
import type { Connection } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import {
  CCIP_SOLANA_VERSION_MAP,
  SolanaCCIPIdl,
  type SupportedSolanaCCIPVersion,
} from './versioning.ts'

export const getCcipCommonReadOnly = ({
  ccipVersion,
  address,
  connection,
}: {
  ccipVersion: SupportedSolanaCCIPVersion
  address: string
  connection: Connection
}) => {
  const program = new Program(
    CCIP_SOLANA_VERSION_MAP[ccipVersion][SolanaCCIPIdl.Common],
    new PublicKey(address),
    { connection },
  )

  return program
}

export type CommonProgram = Awaited<ReturnType<typeof getCcipCommonReadOnly>>
