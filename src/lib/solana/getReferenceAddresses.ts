import { type Connection, PublicKey } from '@solana/web3.js'
import { CCIPVersion } from '../types.ts'
import { getCcipOfframpReadOnly } from './programs/getCcipOfframp.ts'

type ReferenceAddresses = {
  version: number
  router: PublicKey
  feeQuoter: PublicKey
  offrampLookupTable: PublicKey
  rmnRemote: PublicKey
}

export const getReferenceAddresses = async ({
  connection,
  referenceAddressesId,
  offrampProgramPubkey,
}: {
  connection: Connection
  referenceAddressesId: string
  offrampProgramPubkey: PublicKey
}) => {
  const referenceAddressesAccount = await connection.getAccountInfo(
    new PublicKey(referenceAddressesId),
  )

  if (!referenceAddressesAccount) {
    throw new Error(`Reference addresses account not found at ${referenceAddressesId}`)
  }

  const program = getCcipOfframpReadOnly({
    ccipVersion: CCIPVersion.V1_6,
    address: offrampProgramPubkey.toBase58(),
    connection,
  })

  const account: ReferenceAddresses = program.coder.accounts.decode(
    'ReferenceAddresses',
    referenceAddressesAccount.data,
  )

  return {
    version: account.version,
    router: account.router,
    feeQuoter: account.feeQuoter,
    offrampLookupTable: account.offrampLookupTable,
    rmnRemote: account.rmnRemote,
  }
}
