import type { Connection } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import { ethers } from 'ethers'
import { getReferenceAddresses } from './getReferenceAddresses'
import { BN } from 'bn.js'

type ReferenceAddressesAccounts = {
  allowedOfframpPubKey: PublicKey
  rmnRemoteCursesPubKey: PublicKey
  rmnRemoteConfigPubKey: PublicKey
  rmnRemotePubKey: PublicKey
  feeQuoter: PublicKey
  offrampLookupTable: PublicKey
  router: PublicKey
}

type DerivedAccounts = {
  configPubKey: PublicKey
  referenceAddressesPubKey: PublicKey
  sourceChainPubKey: PublicKey
  commitReportPubKey: PublicKey
  feeBillingSignerPubKey: PublicKey
  externalExecutionConfigPubKey: PublicKey
} & ReferenceAddressesAccounts

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

export const deriveAccounts = async ({
  connection,
  offrampProgramPubkey,
  sourceChainSelector,
  root,
  receiver,
}: {
  connection: Connection
  offrampProgramPubkey: PublicKey
  sourceChainSelector: bigint
  root: string
  receiver: string
}): Promise<DerivedAccounts> => {
  const sourceChainSelectorBuffer = new BN(sourceChainSelector.toString()).toArrayLike(
    Buffer,
    'le',
    8,
  )

  const [configPubKey] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    offrampProgramPubkey,
  )

  const [referenceAddressesPubKey] = PublicKey.findProgramAddressSync(
    [Buffer.from('reference_addresses')],
    offrampProgramPubkey,
  )

  const [sourceChainPubKey] = PublicKey.findProgramAddressSync(
    [Buffer.from('source_chain_state'), sourceChainSelectorBuffer],
    offrampProgramPubkey,
  )

  const merkleRootBytes = ethers.getBytes(root)
  const [commitReportPubKey] = PublicKey.findProgramAddressSync(
    [Buffer.from('commit_report'), sourceChainSelectorBuffer, merkleRootBytes],
    offrampProgramPubkey,
  )

  const [feeBillingSignerPubKey] = PublicKey.findProgramAddressSync(
    [Buffer.from('fee_billing_signer')],
    offrampProgramPubkey,
  )

  const [externalExecutionConfigPubKey] = PublicKey.findProgramAddressSync(
    [Buffer.from('external_execution_config'), new PublicKey(receiver).toBuffer()],
    offrampProgramPubkey,
  )

  const referenceAddressesAccounts = await getReferenceAddressesAccounts({
    connection,
    referenceAddressesId: referenceAddressesPubKey.toBase58(),
    offrampProgramPubkey,
    sourceChainSelectorBuffer,
  })

  return {
    configPubKey,
    referenceAddressesPubKey,
    sourceChainPubKey,
    commitReportPubKey,
    feeBillingSignerPubKey,
    externalExecutionConfigPubKey,
    ...referenceAddressesAccounts,
  }
}
