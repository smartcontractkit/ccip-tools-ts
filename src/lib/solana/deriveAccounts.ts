import { type Connection, PublicKey } from '@solana/web3.js'
import { getReferenceAddresses } from './getReferenceAddresses.ts'

type ReferenceAddressesAccounts = {
  allowedOfframpPubKey: PublicKey
  rmnRemoteCursesPubKey: PublicKey
  rmnRemoteConfigPubKey: PublicKey
  rmnRemotePubKey: PublicKey
  feeQuoter: PublicKey
  offrampLookupTable: PublicKey
  router: PublicKey
}

export const getReferenceAddressesAccounts = async ({
  connection,
  referenceAddressesId,
  offrampProgramPubkey,
  sourceChainSelectorBuffer,
}: {
  connection: Connection
  referenceAddressesId: string
  offrampProgramPubkey: PublicKey
  sourceChainSelectorBuffer: Buffer
}): Promise<ReferenceAddressesAccounts> => {
  const referenceAddresses = await getReferenceAddresses({
    connection,
    referenceAddressesId,
    offrampProgramPubkey,
  })

  const [allowedOfframpPubKey] = PublicKey.findProgramAddressSync(
    [Buffer.from('allowed_offramp'), sourceChainSelectorBuffer, offrampProgramPubkey.toBuffer()],
    referenceAddresses.router,
  )

  const [rmnRemoteCursesPubKey] = PublicKey.findProgramAddressSync(
    [Buffer.from('curses')],
    referenceAddresses.rmnRemote,
  )

  const [rmnRemoteConfigPubKey] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    referenceAddresses.rmnRemote,
  )

  return {
    allowedOfframpPubKey,
    rmnRemoteCursesPubKey,
    rmnRemoteConfigPubKey,
    rmnRemotePubKey: referenceAddresses.rmnRemote,
    feeQuoter: referenceAddresses.feeQuoter,
    offrampLookupTable: referenceAddresses.offrampLookupTable,
    router: referenceAddresses.router,
  }
}
