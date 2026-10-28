import assert from 'node:assert/strict'
import { it } from 'node:test'

import { ZeroAddress } from 'ethers'

import { networkInfo } from '../networks.ts'
import { EVMChain } from './index.ts'

const SENDER = '0x1111111111111111111111111111111111111111'
const ROUTER = '0x2222222222222222222222222222222222222222'

// Hedera quotes tinybars, but native transaction values use weibar (10^10 per tinybar).
for (const [source, scale] of [
  ['hedera-testnet', 10n ** 10n],
  ['hedera-mainnet', 10n ** 10n],
  [84532, 1n],
] as const) {
  for (const feeToken of [undefined, ZeroAddress]) {
    it(`${source}: native fee scaling with ${feeToken ?? 'default feeToken'}`, async () => {
      const chain = Object.assign(Object.create(EVMChain.prototype) as EVMChain, {
        network: networkInfo(source),
        getFee: async () => {
          throw new Error('an explicit fee must not trigger an RPC quote')
        },
      })
      const message = { receiver: SENDER, data: '0x', fee: 123n, feeToken }
      const { transactions } = await chain.generateUnsignedSendMessage({
        sender: SENDER,
        router: ROUTER,
        destChainSelector: networkInfo(11155111).chainSelector,
        message,
      })
      assert.equal(transactions.length, 1)
      assert.equal(transactions[0]?.to, ROUTER)
      assert.equal(transactions[0].from, SENDER)
      assert.equal(transactions[0].value, 123n * scale)
      assert.equal(message.fee, 123n)
    })
  }
}
