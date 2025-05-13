import { Program } from '@coral-xyz/anchor'
import type { Connection } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import type { SupportedSolanaCCIPVersion } from './versioning'
import { CCIP_SOLANA_VERSION_MAP } from './versioning'

export const getCcipRouter = ({
  ccipVersion,
  address,
  connection,
}: {
  ccipVersion: SupportedSolanaCCIPVersion
  address: string
  connection: Connection
}) => {
  const program = new Program(
    CCIP_SOLANA_VERSION_MAP[ccipVersion].ROUTER.idl,
    new PublicKey(address),
    { connection },
  )

  return program
}

export type RouterProgram = Awaited<ReturnType<typeof getCcipRouter>>
