import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { EVMChain } from '../evm/index.ts'
import { ChainFamily } from '../networks.ts'
import { buildMessageForDest } from '../requests.ts'
import { DEFAULT_CANTON_NO_EXECUTION_EXECUTOR, applyCantonDestExecutorDefault } from './defaults.ts'
import { CantonChain } from './index.ts'

// Ensure Canton is registered in supportedChains for buildMessageForDest(..., ChainFamily.Canton).
void CantonChain

describe('applyCantonDestExecutorDefault', () => {
  it('sets NoExecutionTag executor for V3 when executor is unset', () => {
    const built = buildMessageForDest(
      {
        receiver: '0x' + 'ab'.repeat(32),
        extraArgs: { finality: 'finalized', gasLimit: 0n },
      },
      ChainFamily.Canton,
    )
    const result = applyCantonDestExecutorDefault(built)
    assert.equal('ccvs' in result.extraArgs, true)
    assert.equal(
      'executor' in result.extraArgs && result.extraArgs.executor,
      DEFAULT_CANTON_NO_EXECUTION_EXECUTOR,
    )
  })

  it('uses canton-config noExecutionExecutor when provided', () => {
    const custom = '0x' + '11'.repeat(20)
    const built = buildMessageForDest(
      {
        receiver: '0x' + 'ab'.repeat(32),
        extraArgs: { finality: 1, gasLimit: 0n },
      },
      ChainFamily.Canton,
    )
    const result = applyCantonDestExecutorDefault(built, { noExecutionExecutor: custom })
    assert.equal('executor' in result.extraArgs && result.extraArgs.executor, custom)
  })

  it('preserves an explicit executor on V3 Canton-dest messages', () => {
    const explicit = '0x' + 'cd'.repeat(20)
    const built = buildMessageForDest(
      {
        receiver: '0x' + 'ab'.repeat(32),
        extraArgs: { finality: 1, gasLimit: 0n, executor: explicit },
      },
      ChainFamily.Canton,
    )
    const result = applyCantonDestExecutorDefault(built)
    assert.equal('executor' in result.extraArgs && result.extraArgs.executor, explicit)
  })

  it('does not modify V2 extraArgs on non-Canton destinations', () => {
    const built = buildMessageForDest(
      {
        receiver: '0x' + '11'.repeat(20),
        data: '0x',
      },
      ChainFamily.EVM,
    )
    const result = applyCantonDestExecutorDefault(built)
    assert.equal('allowOutOfOrderExecution' in result.extraArgs, true)
    assert.equal('ccvs' in result.extraArgs, false)
  })
})

describe('CantonChain.buildMessageForDest', () => {
  it('defaults finality to finalized so gasLimit-only extraArgs use V3', () => {
    const result = buildMessageForDest(
      {
        receiver: '0x' + 'ab'.repeat(32),
        extraArgs: { gasLimit: 100_000n },
      },
      ChainFamily.Canton,
    )
    assert.equal('ccvs' in result.extraArgs, true)
    assert.equal('finality' in result.extraArgs && result.extraArgs.finality, 'finalized')
    assert.ok('gasLimit' in result.extraArgs)
    assert.equal(result.extraArgs.gasLimit, 100_000n)
  })

  it('defaults finality to finalized when extraArgs omitted', () => {
    const result = buildMessageForDest(
      {
        receiver: '0x' + 'ab'.repeat(32),
        data: '0x',
      },
      ChainFamily.Canton,
    )
    assert.equal('ccvs' in result.extraArgs, true)
    assert.equal('finality' in result.extraArgs && result.extraArgs.finality, 'finalized')
  })

  it('preserves explicit finality overrides', () => {
    const result = buildMessageForDest(
      {
        receiver: '0x' + 'ab'.repeat(32),
        extraArgs: { gasLimit: 50_000n, finality: 1 },
      },
      ChainFamily.Canton,
    )
    assert.equal('finality' in result.extraArgs && result.extraArgs.finality, 1)
  })
})

describe('EVMChain.buildMessageForDest (EVM dest unchanged)', () => {
  it('leaves V3 executor empty for EVM destinations', () => {
    const result = EVMChain.buildMessageForDest({
      receiver: '0x' + '11'.repeat(20),
      extraArgs: { finality: 'finalized', gasLimit: 200_000n },
    })
    assert.equal('executor' in result.extraArgs && result.extraArgs.executor, '')
  })
})
