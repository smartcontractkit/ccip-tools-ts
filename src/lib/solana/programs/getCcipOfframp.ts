import { type AnchorProvider, Program } from '@coral-xyz/anchor'
import { type Connection, PublicKey } from '@solana/web3.js'
import {
  type SupportedSolanaCCIPVersion,
  CCIP_SOLANA_VERSION_MAP,
  SolanaCCIPIdl,
} from './versioning.ts'

export const getCcipOfframp = ({
  ccipVersion,
  address,
  provider,
}: {
  ccipVersion: SupportedSolanaCCIPVersion
  address: string
  provider: AnchorProvider
}) => {
  const program = new Program(
    CCIP_SOLANA_VERSION_MAP[ccipVersion][SolanaCCIPIdl.OffRamp],
    new PublicKey(address),
    provider,
  )

  return program
}

export type OfframpProgram = Awaited<ReturnType<typeof getCcipOfframp>>

export const getCcipOfframpReadOnly = ({
  ccipVersion,
  address,
  connection,
}: {
  ccipVersion: SupportedSolanaCCIPVersion
  address: string
  connection: Connection
}) => {
  const program = new Program(
    CCIP_SOLANA_VERSION_MAP[ccipVersion][SolanaCCIPIdl.OffRamp],
    new PublicKey(address),
    { connection },
  )

  return program
}

export type OfframpProgramReadOnly = Awaited<ReturnType<typeof getCcipOfframpReadOnly>>
