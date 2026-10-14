/**
 * Unit tests for Canton service HTTP protocol selection (`httpVersion`).
 *
 * Verifies that:
 * - `'auto'` mode: a forced HTTP/2 attempt against an HTTP/1.1-only server
 *   falls back to HTTP/1.1 for the SAME request and succeeds.
 * - The working protocol is memoized per origin: the second request to the
 *   same origin does not re-probe HTTP/2.
 * - Pinned `2` mode does NOT fall back (preserves the hosted-validator
 *   behavior where HTTP/2 is required).
 * - Pinned `1` mode speaks HTTP/1.1 directly.
 *
 * Uses real loopback HTTP/1.1-only servers (cleartext and TLS) so the exact
 * protocol-level error codes (`ERR_HTTP2_ERROR`, `ERR_HTTP2_STREAM_CANCEL`)
 * are exercised end-to-end through axios.
 */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import { describe, it } from 'node:test'

import { get, post } from './client.ts'

const HEADERS: Record<string, string> = { 'Content-Type': 'application/json' }

/** Start an HTTP/1.1-only cleartext loopback server; returns its base URL. */
async function startHttp1Server(): Promise<{ baseUrl: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, method: req.method, url: req.url, body }))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return { baseUrl, close: () => server.close() }
}

describe('canton/client — httpVersion protocol selection', () => {
  it("'auto' falls back to HTTP/1.1 when the server is HTTP/1.1-only (cleartext)", async () => {
    const { baseUrl, close } = await startHttp1Server()
    try {
      const resp = await post<{ ok: boolean }>(
        baseUrl,
        '/ccip/v1/global/disclosure/batch',
        HEADERS,
        5_000,
        { addresses: ['test-address'] },
        undefined,
        1, // no retry-loop retries: the fallback must happen within one attempt
        undefined,
        'auto',
      )
      assert.equal(resp.ok, true)
    } finally {
      close()
    }
  })

  it("'auto' memoizes the working protocol per origin (no re-probe on 2nd request)", async () => {
    const { baseUrl, close } = await startHttp1Server()
    try {
      const first = await get<{ ok: boolean }>(
        baseUrl,
        '/ccip/v1/global/TokenAdminRegistry/token/abc',
        HEADERS,
        5_000,
        undefined,
        1,
        undefined,
        'auto',
      )
      assert.equal(first.ok, true)
      // Second request: if the origin were re-probed over h2, this would
      // fail with ERR_HTTP2_ERROR before the memoized h1 transport is used.
      const second = await get<{ ok: boolean }>(
        baseUrl,
        '/ccip/v1/global/TokenAdminRegistry/token/def',
        HEADERS,
        5_000,
        undefined,
        1,
        undefined,
        'auto',
      )
      assert.equal(second.ok, true)
    } finally {
      close()
    }
  })

  it('pinned 2 does NOT fall back against an HTTP/1.1-only server', async () => {
    const { baseUrl, close } = await startHttp1Server()
    try {
      await assert.rejects(
        post(
          baseUrl,
          '/ccip/v1/global/disclosure/batch',
          HEADERS,
          2_000,
          { addresses: ['test-address'] },
          undefined,
          1,
          undefined,
          2,
        ),
        (err: unknown) => {
          // Must fail with the protocol-level error, NOT succeed via fallback.
          const code = (err as { context?: { cantonCode?: string } }).context?.cantonCode
          assert.ok(
            code === 'ERR_HTTP2_ERROR' || code === 'ERR_HTTP2_STREAM_CANCEL',
            `expected protocol-level h2 error, got: ${code ?? String(err)}`,
          )
          return true
        },
      )
    } finally {
      close()
    }
  })

  it('pinned 1 speaks HTTP/1.1 directly against an HTTP/1.1-only server', async () => {
    const { baseUrl, close } = await startHttp1Server()
    try {
      const resp = await get<{ ok: boolean }>(
        baseUrl,
        '/livez',
        HEADERS,
        5_000,
        undefined,
        1,
        undefined,
        1,
      )
      assert.equal(resp.ok, true)
    } finally {
      close()
    }
  })

  it("'auto' works against an HTTP/1.1-only TLS server (no h2 ALPN)", async () => {
    // Self-signed TLS server that only speaks HTTP/1.1 (Node's https server
    // does not offer h2 via ALPN). The h2 attempt fails with
    // ERR_HTTP2_STREAM_CANCEL (no_application_protocol) and 'auto' falls back
    // to HTTP/1.1 for the same request.
    //
    // The probe runs in a CHILD process with NODE_EXTRA_CA_CERTS set at its
    // startup so the self-signed loopback cert is properly trusted. (The env
    // var is only read at process startup, so setting it in-process would be
    // a no-op; disabling NODE_TLS_REJECT_UNAUTHORIZED instead would trip
    // code-scanning alerts for disabled certificate validation.)
    const { execFileSync } = await import('node:child_process')
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'canton-h1-tls-'))
    const keyPath = join(dir, 'key.pem')
    const certPath = join(dir, 'cert.pem')
    const probePath = join(dir, 'probe.mjs')
    try {
      execFileSync('openssl', [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-nodes',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
      ])
      // The child starts the 1.1-only TLS server, then calls the SDK's
      // get() in 'auto' mode against it and prints the result. NODE_EXTRA_
      // CA_CERTS (set below at the child's startup) makes axios trust the
      // self-signed cert, so the h2 attempt reaches ALPN and fails with the
      // protocol-level error, exercising the real fallback path.
      writeFileSync(
        probePath,
        [
          "import assert from 'node:assert/strict'",
          "import https from 'node:https'",
          "import { once } from 'node:events'",
          "import { readFileSync } from 'node:fs'",
          'import { get } from ' + JSON.stringify(new URL('./client.ts', import.meta.url).href),
          'const server = https.createServer(',
          '  { key: readFileSync(' +
            JSON.stringify(keyPath) +
            '), cert: readFileSync(' +
            JSON.stringify(certPath) +
            ') },',
          '  (req, res) => {',
          "    res.writeHead(200, { 'content-type': 'application/json' })",
          '    res.end(JSON.stringify({ ok: true }))',
          '  },',
          ')',
          "server.listen(0, '127.0.0.1')",
          "await once(server, 'listening')",
          'const port = server.address().port',
          'const resp = await get(',
          '  `https://127.0.0.1:${port}`,',
          "  '/livez',",
          '  { ' +
            JSON.stringify('Content-Type') +
            ': ' +
            JSON.stringify('application/json') +
            ' },',
          '  5_000,',
          '  undefined,',
          '  1,',
          '  undefined,',
          "  'auto',",
          ')',
          'assert.equal(resp.ok, true)',
          'server.close()',
        ].join('\n'),
      )
      // Run the probe with the self-signed cert trusted at startup. The child
      // inherits the repo's TypeScript support via the same loader flags the
      // test runner uses (--experimental-strip-types on Node < 22.6).
      const nodeArgs = ['--experimental-strip-types']
      execFileSync(process.execPath, [...nodeArgs, probePath], {
        env: { ...process.env, NODE_EXTRA_CA_CERTS: certPath },
        stdio: 'pipe',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
