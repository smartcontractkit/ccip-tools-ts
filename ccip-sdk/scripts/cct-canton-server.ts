/**
 * Minimal HTTP wrapper over the Canton CCT SDK — lets a consumer (e.g. DA's
 * Registry backend) call any Canton CCT operation as a REST endpoint and get
 * back the unsigned tx, without embedding the TS SDK.
 *
 * Composition lives here (server holds the participant JWT); signing stays
 * with the caller: either take the returned unsignedTx and submit it through
 * your own Wallet Gateway (CIP-103 prepareExecute), or POST it back to
 * /submit with your gateway URL + session token.
 *
 * ─── Run ─────────────────────────────────────────────────────────────────
 *   CANTON_LEDGER_URL=https://testnet.cv1.bcy-v.metalhosts.com/api/json \
 *   CANTON_JWT=… CANTON_PARTY='u_xxx::1220…' CCIP_PARTY='ccipOwner::1220…' \
 *   PORT=8570 \
 *     node --experimental-strip-types ccip-sdk/scripts/cct-canton-server.ts
 *
 * ─── Endpoints ───────────────────────────────────────────────────────────
 *   GET  /health
 *   POST /cct/canton/:operation   body = the op's params (JSON)
 *        → { unsignedTx }  (write ops) or the read result (read ops)
 *   POST /cct/canton/submit       body = { unsignedTx, gatewayUrl, accessToken }
 *        → { approveUrl, response }  (approve at the gateway → sign + execute)
 *
 * Operations: registerAdmin, acceptAdmin, transferAdmin, setPool,
 * deployTokenPool, deployRateLimiter, applyChainUpdates, setRateLimitConfig,
 * setDynamicConfig, getTokenAdminRegistry, getSupportedTokens,
 * getTokenPoolState, getRequiredCCVs.
 *
 * JSON can't carry bigints — pass selector/capacity/rate fields as strings
 * (e.g. "16015286601757825753"); the server converts per op.
 *
 * @packageDocumentation
 */

import { createServer } from 'node:http'
import { CantonTokenManager } from '../src/cct/canton/index.ts'
import { deployCCIPFactory } from '../src/cct/canton/deploy-factory.ts'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`)
  return v.trim()
}

/** Fields that must be bigint at the SDK boundary (JSON arrives as strings). */
const BIGINT_FIELDS: Record<string, string[]> = {
  deployRateLimiter: ['remoteChainSelector', 'capacity', 'rate'],
  applyChainUpdates: ['remoteChainSelector'], // chainsToAdd handled below
  setRateLimitConfig: ['remoteChainSelector'],
}

function coerceBigints(op: string, params: Record<string, unknown>): Record<string, unknown> {
  const out = { ...params }
  for (const field of BIGINT_FIELDS[op] ?? []) {
    if (typeof out[field] === 'string') out[field] = BigInt(out[field] as string)
  }
  if (op === 'applyChainUpdates') {
    if (Array.isArray(out['remoteChainSelectorsToRemove'])) {
      out['remoteChainSelectorsToRemove'] = (out['remoteChainSelectorsToRemove'] as string[]).map(BigInt)
    }
    if (Array.isArray(out['chainsToAdd'])) {
      out['chainsToAdd'] = (out['chainsToAdd'] as Array<Record<string, unknown>>).map((c) => ({
        ...c,
        remoteChainSelector: BigInt(c['remoteChainSelector'] as string),
      }))
    }
  }
  if (op === 'setRateLimitConfig') {
    for (const dir of ['inbound', 'outbound'] as const) {
      const cfg = out[dir] as Record<string, unknown> | undefined
      if (cfg) {
        out[dir] = {
          ...cfg,
          capacity: BigInt(cfg['capacity'] as string),
          rate: BigInt(cfg['rate'] as string),
        }
      }
    }
  }
  return out
}

type OpFn = (manager: CantonTokenManager, params: never) => Promise<unknown>

/** Write ops: params in → unsignedTx out. */
const WRITE_OPS: Record<string, OpFn> = {
  registerAdmin: (m, p) => m.generateUnsignedRegisterAdmin(p),
  acceptAdmin: (m, p) => m.generateUnsignedAcceptAdmin(p),
  transferAdmin: (m, p) => m.generateUnsignedTransferAdmin(p),
  setPool: (m, p) => m.generateUnsignedSetPool(p),
  deployTokenPool: (m, p) => m.generateUnsignedDeployTokenPool(p),
  deployRateLimiter: (m, p) => m.generateUnsignedDeployRateLimiter(p),
  applyChainUpdates: (m, p) => m.generateUnsignedApplyChainUpdates(p),
  setRateLimitConfig: (m, p) => m.generateUnsignedSetRateLimitConfig(p),
  setDynamicConfig: (m, p) => m.generateUnsignedSetDynamicConfig(p),
}

/** Read ops: params in → result out (no wallet, no unsigned tx). */
const READ_OPS: Record<string, OpFn> = {
  getTokenAdminRegistry: (m, p) => m.getTokenAdminRegistry(p),
  getSupportedTokens: (m, p) => m.getSupportedTokens(p),
  getTokenPoolState: (m, p) => m.getTokenPoolState(p),
  getRequiredCCVs: (m, p) => m.getRequiredCCVs(p),
}

/** Fully-offline ops: no chain, no ACS reads — pure local tx construction. */
const OFFLINE_OPS: Record<string, (params: Record<string, unknown>) => unknown> = {
  deployFactory: (p) =>
    deployCCIPFactory({
      instanceId: p['instanceId'] as string,
      owner: p['sender'] as string,
      mcmsParty: (p['mcmsParty'] as string | undefined) ?? (p['sender'] as string),
    }),
}

async function main(): Promise<void> {
  const ledgerUrl = requireEnv('CANTON_LEDGER_URL')
  const jwt = requireEnv('CANTON_JWT')
  const party = requireEnv('CANTON_PARTY')
  const ccipParty = requireEnv('CCIP_PARTY')
  const port = Number(process.env['PORT']?.trim() || '8570')

  const { CantonChain } = await import('../src/canton/index.ts')
  const chain = await CantonChain.fromUrl(ledgerUrl, {
    logger: {
      debug: () => {},
      info: (...a: unknown[]) => console.error('[info]', ...a),
      warn: (...a: unknown[]) => console.error('[warn]', ...a),
      error: (...a: unknown[]) => console.error('[error]', ...a),
    },
    cantonConfig: {
      party,
      ccipParty,
      jwt,
      edsUrl: 'http://unused-here.local',
      transferInstructionUrl: 'http://unused-here.local',
    },
  })
  const manager = CantonTokenManager.fromChain(chain)
  console.error(`CCT Canton server on :${port} (party=${party.slice(0, 32)}…, ccipParty=${ccipParty.slice(0, 24)}…)`)

  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body, null, 2))
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(200, { ok: true, party, ccipParty, ops: [...Object.keys(WRITE_OPS), ...Object.keys(READ_OPS)] })
      }
      if (req.method !== 'POST') return send(405, { error: 'POST only' })

      const body = JSON.parse(await readBody(req)) as Record<string, unknown>

      if (url.pathname === '/cct/canton/submit') {
        const { submitViaGateway } = await import('../src/cct/canton/gateway-submitter.ts')
        const result = await submitViaGateway({
          gatewayUrl: requireEnv0(body, 'gatewayUrl'),
          accessToken: requireEnv0(body, 'accessToken'),
          unsigned: body['unsignedTx'] as never,
        })
        return send(200, result)
      }

      const match = url.pathname.match(/^\/cct\/canton\/(\w+)$/)
      const op = match?.[1]
      if (!op) return send(404, { error: `unknown path ${url.pathname}` })

      // Server-side identity: the caller acts as the configured party unless
      // they explicitly pass sender (must still be a party the JWT covers).
      const params = coerceBigints(op, { sender: party, ...body })

      if (OFFLINE_OPS[op]) {
        return send(200, { unsignedTx: OFFLINE_OPS[op](params) })
      }
      if (WRITE_OPS[op]) {
        const unsignedTx = await WRITE_OPS[op](manager, params as never)
        return send(200, { unsignedTx })
      }
      if (READ_OPS[op]) {
        const result = await READ_OPS[op](manager, params as never)
        return send(200, { result })
      }
      return send(404, {
        error: `unknown operation "${op}"`,
        ops: [...Object.keys(OFFLINE_OPS), ...Object.keys(WRITE_OPS), ...Object.keys(READ_OPS)],
      })
    } catch (err) {
      const e = err as { code?: string; context?: unknown; message?: string }
      const isParams = e.code === 'CCT_PARAMS_INVALID'
      send(isParams ? 400 : 500, {
        error: e.message ?? String(err),
        ...(e.code && { code: e.code }),
        ...(e.context !== undefined && { context: e.context }),
      })
    }
  })

  server.listen(port)
}

function requireEnv0(body: Record<string, unknown>, key: string): string {
  const v = body[key]
  if (typeof v !== 'string' || !v.trim()) throw new Error(`missing "${key}" in request body`)
  return v.trim()
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
