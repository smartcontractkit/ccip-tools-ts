import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getCtx } from './utils.ts'

/**
 * Temporarily intercepts process.stdout.write and process.stderr.write
 * to capture what is written to each stream during a callback.
 */
function captureStreams(fn: () => void): { stdout: string; stderr: string } {
  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const origStdoutWrite = process.stdout.write
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const origStderrWrite = process.stderr.write

  process.stdout.write = (chunk: unknown) => {
    stdoutChunks.push(String(chunk))
    return true
  }
  process.stderr.write = (chunk: unknown) => {
    stderrChunks.push(String(chunk))
    return true
  }

  try {
    fn()
  } finally {
    process.stdout.write = origStdoutWrite
    process.stderr.write = origStderrWrite
  }

  return { stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
}

describe('getCtx', () => {
  describe('output — always stdout', () => {
    it('output.write goes to stdout', () => {
      const [ctx] = getCtx({})
      const { stdout, stderr } = captureStreams(() => {
        ctx.output.write('data output')
      })
      assert.ok(stdout.includes('data output'), 'output.write should write to stdout')
      assert.ok(!stderr.includes('data output'), 'output.write should NOT write to stderr')
    })

    it('output.table goes to stdout', () => {
      const [ctx] = getCtx({})
      const { stdout, stderr } = captureStreams(() => {
        ctx.output.table({ key: 'value' })
      })
      assert.ok(stdout.includes('key'), 'output.table should write to stdout')
      assert.ok(!stderr.includes('key'), 'output.table should NOT write to stderr')
    })
  })

  describe('logger — always stderr', () => {
    it('logger.info goes to stderr', () => {
      const [ctx] = getCtx({})
      const { stdout, stderr } = captureStreams(() => {
        ctx.logger.info('status message')
      })
      assert.ok(stderr.includes('status message'), 'logger.info should write to stderr')
      assert.ok(!stdout.includes('status message'), 'logger.info should NOT write to stdout')
    })

    it('logger.warn goes to stderr', () => {
      const [ctx] = getCtx({})
      const { stdout, stderr } = captureStreams(() => {
        ctx.logger.warn('warning msg')
      })
      assert.ok(stderr.includes('warning msg'), 'logger.warn should write to stderr')
      assert.ok(!stdout.includes('warning msg'), 'logger.warn should NOT write to stdout')
    })

    it('logger.error goes to stderr', () => {
      const [ctx] = getCtx({})
      const { stdout, stderr } = captureStreams(() => {
        ctx.logger.error('error msg')
      })
      assert.ok(stderr.includes('error msg'), 'logger.error should write to stderr')
      assert.ok(!stdout.includes('error msg'), 'logger.error should NOT write to stdout')
    })
  })

  describe('verbose mode', () => {
    it('logger.debug is a no-op when verbose is false', () => {
      const [ctx] = getCtx({ verbose: false })
      const { stdout, stderr } = captureStreams(() => {
        ctx.logger.debug('should not appear')
      })
      assert.ok(!stdout.includes('should not appear'), 'debug should not write to stdout')
      assert.ok(!stderr.includes('should not appear'), 'debug should not write to stderr')
    })

    it('logger.debug goes to stderr when verbose is true', () => {
      const [ctx] = getCtx({ verbose: true })
      const { stdout, stderr } = captureStreams(() => {
        ctx.logger.debug('debug info')
      })
      assert.ok(stderr.includes('debug info'), 'debug should write to stderr when verbose')
      assert.ok(!stdout.includes('debug info'), 'debug should NOT write to stdout')
    })
  })

  describe('destroy signal', () => {
    it('returns a working destroy function', async () => {
      const [ctx, destroy] = getCtx({})
      let resolved = false
      ctx.destroy$.then(() => {
        resolved = true
      })
      destroy()
      await new Promise((r) => setTimeout(r, 0))
      assert.equal(resolved, true)
    })

    it('calling destroy twice does not throw', () => {
      const [, destroy] = getCtx({})
      destroy()
      assert.doesNotThrow(() => destroy())
    })
  })
})
