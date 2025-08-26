import { Program } from '@coral-xyz/anchor'
import { type Connection, PublicKey } from '@solana/web3.js'
import {
  type SupportedSolanaCCIPVersion,
  CCIP_SOLANA_VERSION_MAP,
  SolanaCCIPIdl,
} from './versioning.ts'

export const getCcipCctpTokenPoolReadOnly = ({
  ccipVersion,
  address,
  connection,
}: {
  ccipVersion: SupportedSolanaCCIPVersion
  address: string
  connection: Connection
}) => {
  const program = new Program(
    CCIP_SOLANA_VERSION_MAP[ccipVersion][SolanaCCIPIdl.CcipCctpTokenPool],
    new PublicKey(address),
    { connection },
  )

  return program
}

export type CcipCctpTokenPoolProgram = Awaited<ReturnType<typeof getCcipCctpTokenPoolReadOnly>>
