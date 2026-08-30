import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  type NewChainRegistration,
  CCIPArgumentInvalidError,
} from '@chainlink/ccip-sdk/src/index.ts'

import { parseChainSelectorsArg } from './chain-selectors.ts'

const DST_SELECTOR = 12922642891491394802n

function tmpFile(name: string, content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'ccip-selectors-')), name)
  writeFileSync(path, content)
  return path
}

describe('parseChainSelectorsArg', () => {
  it('parses the <chainId>=<selector> shorthand', () => {
    assert.deepEqual(parseChainSelectorsArg('2337=12922642891491394802'), [
      { chainId: '2337', chainSelector: DST_SELECTOR },
    ])
  })

  it('parses inline JSON, array or map form', () => {
    // types are preserved as written; registerChains does the coercion and validation
    assert.deepEqual(
      parseChainSelectorsArg(
        '[{"chainId": 2337, "chainSelector": "12922642891491394802", "name": "local-dst", "family": "evm"}]',
      ),
      [
        {
          // ints are parsed as bigints (precision), then normalized to a string chainId key
          chainId: '2337',
          chainSelector: '12922642891491394802',
          name: 'local-dst',
          family: 'EVM',
        },
      ],
    )
    assert.deepEqual(
      parseChainSelectorsArg(
        '{"2337": {"selector": "12922642891491394802", "name": "local-dst", "family": "evm"}}',
      ),
      [
        {
          chainId: '2337',
          chainSelector: '12922642891491394802',
          name: 'local-dst',
          family: 'EVM',
        },
      ],
    )
  })

  it('keeps selector precision for bare (unquoted) integers', () => {
    // JSON.parse would round 12922642891491394802 to ...4804
    const [entry] = parseChainSelectorsArg(
      '[{"chainId": 2337, "chainSelector": 12922642891491394802}]',
    ) as NewChainRegistration[]
    assert.equal(BigInt(entry!.chainSelector as bigint), DST_SELECTOR)
  })

  it('parses the <chainId>=fork:<chain> shorthand', () => {
    assert.deepEqual(parseChainSelectorsArg('73571=fork:11155111'), [
      { chainId: '73571', forkOf: '11155111' },
    ])
    assert.deepEqual(parseChainSelectorsArg('73571=fork:ethereum-testnet-sepolia'), [
      { chainId: '73571', forkOf: 'ethereum-testnet-sepolia' },
    ])
    assert.deepEqual(
      parseChainSelectorsArg('[{"chainId": 73571, "forkOf": "ethereum-testnet-sepolia"}]'),
      [{ chainId: '73571', forkOf: 'ethereum-testnet-sepolia' }],
    )
  })

  it('reads a chain-selectors YAML document, selectors:-wrapped', () => {
    const path = tmpFile(
      'test_selectors.yml',
      'selectors:\n  2337:\n    selector: 12922642891491394802\n    name: local-anvil-dst\n    network_type: testnet\n',
    )
    assert.deepEqual(parseChainSelectorsArg(path), [
      {
        chainId: '2337',
        chainSelector: DST_SELECTOR,
        name: 'local-anvil-dst',
        networkType: 'TESTNET',
      },
    ])
  })

  it('reports a missing file and invalid content as argument errors', () => {
    assert.throws(() => parseChainSelectorsArg('/no/such/file.json'), CCIPArgumentInvalidError)
    assert.throws(
      () => parseChainSelectorsArg(tmpFile('bad.json', '{{{not json')),
      CCIPArgumentInvalidError,
    )
    assert.throws(
      () => parseChainSelectorsArg(tmpFile('scalar.json', '42')),
      CCIPArgumentInvalidError,
    )
  })
})
