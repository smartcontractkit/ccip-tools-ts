import { relative } from 'node:path'

/** Events use monotonic durations: node:test can buffer output until a file finishes. */
export function logTestTiming(event: string, startedAt: number): void {
  if (process.env.NETWORK_TEST_TIMINGS !== '1') return
  const file = process.argv[1] ? relative(process.cwd(), process.argv[1]) : 'node'
  const duration = Math.round(performance.now() - startedAt)
  console.error(`[test-timing] ${file} pid=${process.pid} ${event} duration_ms=${duration}`)
}
