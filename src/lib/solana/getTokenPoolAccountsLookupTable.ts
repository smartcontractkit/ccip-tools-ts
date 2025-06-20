import { type AddressLookupTableAccount, type Connection, PublicKey } from '@solana/web3.js'
import { CCIPVersion } from '../types.ts'
import { getAddressLookupTableAccount } from './getAddressLookupTableAccount.ts'
import { getCcipCommonReadOnly } from './programs/getCcipCommon.ts'

const getTokenPoolAdminRegistryLookupTablePubkey = async ({
  connection,
  mint,
  routerPubkey,
}: {
  connection: Connection
  mint: PublicKey
  routerPubkey: PublicKey
}) => {
  const [tokenAdminRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_admin_registry'), mint.toBuffer()],
    routerPubkey,
  )

  const tokenAdminRegistryInfo = await connection.getAccountInfo(tokenAdminRegistry)

  if (!tokenAdminRegistryInfo) {
    throw new Error(
      `Token admin registry not found for ${mint.toBase58()} and TokenAdminRegistry ${tokenAdminRegistry.toBase58()}, router: ${routerPubkey.toBase58()}`,
    )
  }

  const program = getCcipCommonReadOnly({
    ccipVersion: CCIPVersion.V1_6,
    address: routerPubkey.toBase58(),
    connection,
  })

  const tokenAdminRegistryData: {
    lookupTable: PublicKey
  } = program.coder.accounts.decode('tokenAdminRegistry', tokenAdminRegistryInfo.data)

  return tokenAdminRegistryData.lookupTable
}

export async function getTokenPoolAccountsLookupTable({
  connection,
  routerPubkey,
  mint,
}: {
  connection: Connection
  routerPubkey: PublicKey
  mint: PublicKey
}): Promise<AddressLookupTableAccount> {
  const lookupTableAccountPubkey = await getTokenPoolAdminRegistryLookupTablePubkey({
    connection,
    mint,
    routerPubkey,
  })

  const addressLookupTableAccount = await getAddressLookupTableAccount({
    connection,
    lookupTablePubKey: lookupTableAccountPubkey,
  })

  return addressLookupTableAccount
}
