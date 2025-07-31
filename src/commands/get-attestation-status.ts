import { keccak256, isHexString } from 'ethers'
import { bigIntReplacer, fetchCCIPMessagesInTx } from '../lib/index.ts'
import type { Providers } from '../providers.ts'
import { Format } from './types.ts'
import { prettyRequest, selectRequest, withDateTimestamp } from './utils.ts'

export async function getUSDCAttestationStatusV1(
  providers: Providers,
  txHash: string,
  argv: {
    format: Format
    wallet?: string
  },
) {
  const receipt = await providers.getTxReceipt(txHash)
  if (!receipt) throw new Error('Transaction not found')

  const source = receipt.provider
  const request = await selectRequest(await fetchCCIPMessagesInTx(receipt), 'to execute')

  switch (argv.format) {
    case Format.log:
      console.log(`message ${request.log.index} =`, withDateTimestamp(request))
      break
    case Format.pretty:
      await prettyRequest(source, request)
      break
    case Format.json:
      console.info(JSON.stringify(request, bigIntReplacer, 2))
      break
  }
  const eventTopic = keccak256(Buffer.from('MessageSent(bytes)'))
  const log = receipt.logs.find((l) => l.topics[0] === eventTopic)
  if (!log) {
    console.error('MessageSent event not found in transaction logs.')
    return
  }

  // Decode the message bytes
  const messageBytes = log.data // log.data is already hex string
  if (!isHexString(messageBytes)) throw new Error('Log data is not hex string')

  const messageHash = keccak256(messageBytes)
  console.log('Message Hash:', messageHash)

  const circleBaseUrl = 'https://iris-api.circle.com/v1/attestations/'
  const circleUrl = `${circleBaseUrl}${messageHash}`

  const response = await fetch(circleUrl, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
  const json = await response.json()
  console.log(JSON.stringify(json, null, 2))
  console.log(json)
}
