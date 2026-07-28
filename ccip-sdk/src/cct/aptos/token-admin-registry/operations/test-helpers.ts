import {
  type Client,
  type ClientRequest,
  type ClientResponse,
  Aptos,
  AptosConfig,
  Network,
} from '@aptos-labs/ts-sdk'

import type { AptosChain } from '../../../../aptos/index.ts'

/** A test sender address (32-byte hex). */
export const SENDER = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

/** A test router module address. */
export const ROUTER = '0x00000000000000000000000000000000000000000000000000000000000000ab'

/** A test token object address. */
export const TOKEN = '0x0000000000000000000000000000000000000000000000000000000089fd6b14'

/** A test pool resource address. */
export const POOL = '0x00000000000000000000000000000000000000000000000000000000deadbeef'

/** A test administrator address. */
export const ADMIN = '0x0000000000000000000000000000000000000000000000000000abcdef123456'

/**
 * Fake Aptos client returning canned responses for the fullnode reads that
 * `buildTransaction` performs (ledger info, account sequence number, gas price).
 * Keeps `buildUnsigned` fully offline.
 */
function fakeClient(): Client {
  return {
    async provider<Req, Res>(req: ClientRequest<Req>): Promise<ClientResponse<Res>> {
      const path = new URL(req.url).pathname
      const ok = (data: unknown): ClientResponse<Res> => ({
        status: 200,
        statusText: 'OK',
        data: data as Res,
        headers: {},
        config: req,
        request: null,
        response: null,
      })

      if (path.includes('estimate_gas_price')) {
        return ok({
          deprioritized_gas_estimate: 100,
          gas_estimate: 100,
          prioritized_gas_estimate: 100,
        })
      }
      if (path.includes('/accounts/')) {
        return ok({
          sequence_number: '0',
          authentication_key: SENDER,
        })
      }
      // Ledger info (used for chain id).
      return ok({
        chain_id: 1,
        epoch: '1',
        ledger_version: '1',
        oldest_ledger_version: '0',
        ledger_timestamp: '0',
        node_role: 'full_node',
        oldest_block_height: '0',
        block_height: '1',
        git_hash: '',
      })
    },
  }
}

/** Builds a minimal AptosChain stub sufficient for `buildUnsigned`. */
export function stubChain(): AptosChain {
  const config = new AptosConfig({
    network: Network.CUSTOM,
    fullnode: 'http://localhost/v1',
    client: fakeClient(),
  })
  return {
    provider: new Aptos(config),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  } as unknown as AptosChain
}
