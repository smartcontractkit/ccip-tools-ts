import type { Connection, PublicKey } from '@solana/web3.js'

export async function getAddressLookupTableAccount({
  connection,
  lookupTablePubKey,
}: {
  connection: Connection
  lookupTablePubKey: PublicKey
}) {
  const lookupTableAccountInfo = await connection.getAddressLookupTable(lookupTablePubKey)

  if (!lookupTableAccountInfo.value) {
    throw new Error(`Lookup table account not found: ${lookupTablePubKey.toBase58()}`)
  }

  return lookupTableAccountInfo.value
}
