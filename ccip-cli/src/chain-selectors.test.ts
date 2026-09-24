import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import {
  CCIPArgumentInvalidError,
  CCIPChainNotFoundError,
  ChainFamily,
  NetworkType,
  SELECTORS,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'

import {
  coerceChainSelectors,
  parseChainSelectorsArg,
  registerChainSelectors,
} from './chain-selectors.ts'

const DST_SELECTOR = 12922642891491394802n
const SEPOLIA_SELECTOR = 16015286601757825753n
const FORK_CHAIN_ID = 735711155111
const GENESIS = 'GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC'

function tmpFile(name: string, content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'ccip-selectors-')), name)
  writeFileSync(path, content)
  return path
}

// registration writes into the SDK's shared table: restore it after each test
const bundled = { ...SELECTORS }
function restoreSelectors() {
  for (const id of Object.keys(SELECTORS)) if (!Object.hasOwn(bundled, id)) delete SELECTORS[id]
  Object.assign(SELECTORS, bundled)
}

const register = (...args: string[]) => registerChainSelectors(coerceChainSelectors(args))

/** assert.throws validator: an argument error whose message says why */
const rejects = (reason: string) => (err: unknown) => {
  assert.ok(err instanceof CCIPArgumentInvalidError, String(err))
  assert.ok(err.message.includes(reason), `"${err.message}" should include "${reason}"`)
  return true
}

describe('parseChainSelectorsArg', () => {
  it('parses <chainId>=<selector> and <chainId>=<chain name> pairs', () => {
    assert.deepEqual(parseChainSelectorsArg('2337=12922642891491394802'), [
      { chainId: '2337', selector: DST_SELECTOR },
    ])
    assert.deepEqual(parseChainSelectorsArg('73571=ethereum-testnet-sepolia'), [
      { chainId: '73571', forkOf: 'ethereum-testnet-sepolia' },
    ])
  })

  it('splits a comma/whitespace-separated list, as one env var holds it', () => {
    assert.deepEqual(parseChainSelectorsArg(' 2337=1, 2338=2\n73571=ethereum-testnet-sepolia '), [
      { chainId: '2337', selector: 1n },
      { chainId: '2338', selector: 2n },
      { chainId: '73571', forkOf: 'ethereum-testnet-sepolia' },
    ])
    assert.deepEqual(parseChainSelectorsArg(''), [])
  })

  it('parses inline JSON, array or map form, keeping selector precision', () => {
    // JSON.parse would round 12922642891491394802 to ...4804
    assert.deepEqual(
      parseChainSelectorsArg(
        '[{"chainId": 2337, "chainSelector": 12922642891491394802, "name": "local-dst", "family": "evm"}]',
      ),
      [{ chainId: '2337', selector: DST_SELECTOR, name: 'local-dst', family: 'evm' }],
    )
    assert.deepEqual(
      parseChainSelectorsArg(
        '{"2337": {"selector": "12922642891491394802", "network_type": "testnet"}, "73571": {"forkOf": "ethereum-testnet-sepolia"}}',
      ),
      [
        { chainId: '2337', selector: DST_SELECTOR, networkType: 'testnet' },
        { chainId: '73571', forkOf: 'ethereum-testnet-sepolia' },
      ],
    )
  })

  it('reads a chain-selectors YAML document, selectors:-wrapped, also from a list', () => {
    const path = tmpFile(
      'test_selectors.yml',
      'selectors:\n  2337:\n    selector: 12922642891491394802\n    name: local-anvil-dst\n    network_type: testnet\n',
    )
    const expected = [
      { chainId: '2337', selector: DST_SELECTOR, name: 'local-anvil-dst', networkType: 'testnet' },
    ]
    assert.deepEqual(parseChainSelectorsArg(path), expected)
    assert.deepEqual(parseChainSelectorsArg(`${path},73571=ethereum-testnet-sepolia`), [
      ...expected,
      { chainId: '73571', forkOf: 'ethereum-testnet-sepolia' },
    ])
  })

  it('reads a file whose path has spaces or commas', () => {
    const path = tmpFile('my selectors,v2.json', '[{"chainId": 2337, "selector": 1}]')
    assert.deepEqual(parseChainSelectorsArg(path), [{ chainId: '2337', selector: 1n }])
  })

  it('reports malformed values as argument errors', () => {
    for (const value of [
      '/no/such/file.json',
      '2337:12922642891491394802',
      tmpFile('bad.json', '{{{not json'),
      tmpFile('scalar.json', '42'),
      '[{"chainId": 2337}]', // neither selector nor forkOf
      '[{"chainId": 2337, "selector": 1, "forkOf": "ethereum-testnet-sepolia"}]', // both
      '[{"chainId": 2337, "selector": "0x1234"}]',
      '[{"selector": 1}]', // no chainId
    ])
      assert.throws(() => parseChainSelectorsArg(value), CCIPArgumentInvalidError, value)
  })
})

describe('registerChainSelectors', () => {
  afterEach(restoreSelectors)

  it('adds a new chain, resolvable by id, selector and name, with defaults', () => {
    assert.throws(() => networkInfo(2337), CCIPChainNotFoundError)
    const [info] = register('2337=12922642891491394802')
    assert.deepEqual(info, {
      chainId: 2337,
      chainSelector: DST_SELECTOR,
      name: 'custom-2337',
      family: ChainFamily.EVM,
      networkType: NetworkType.Testnet,
    })
    assert.equal(networkInfo(DST_SELECTOR).chainId, 2337)
    assert.equal(networkInfo('custom-2337').chainId, 2337)
  })

  it('takes name, family and networkType from a document, case-insensitively', () => {
    const [info] = register(
      '[{"chainId": 2337, "selector": 12922642891491394802, "name": "localdst", "networkType": "mainnet"}]',
    )
    assert.equal(info!.name, 'localdst')
    assert.equal(info!.networkType, NetworkType.Mainnet)
    assert.equal(networkInfo('localdst').chainId, 2337)
  })

  it('infers the family from the chain id format', () => {
    const infos = register(
      '4242=4242424242424242421',
      'aptos:99=4242424242424242422',
      'sui:99=4242424242424242423',
      '-5=4242424242424242424',
      'canton:Local2=4242424242424242425',
      `${GENESIS}=4242424242424242426`,
    )
    assert.deepEqual(
      infos.map(({ chainId, family }) => [chainId, family]),
      [
        [4242, ChainFamily.EVM],
        ['aptos:99', ChainFamily.Aptos],
        ['sui:99', ChainFamily.Sui],
        [-5, ChainFamily.TON],
        ['canton:Local2', ChainFamily.Canton],
        [GENESIS, ChainFamily.Solana],
      ],
    )
  })

  it("prefixes bare ids with an explicit family, as chain-selectors' per-family files use them", () => {
    const [aptos, solana] = register(
      '{"99": {"selector": 4242424242424242422, "family": "aptos"}}',
      `[{"chainId": "${GENESIS}", "selector": 4242424242424242426, "family": "solana"}]`,
    )
    assert.equal(aptos!.chainId, 'aptos:99')
    assert.equal(solana!.family, ChainFamily.Solana)
  })

  it('accepts a hex chain id, as eth_chainId reports it', () => {
    assert.equal(register('0x921=12922642891491394802')[0]!.chainId, 2337)
  })

  it('rejects a family that does not match the chain id, or is unknown', () => {
    for (const [doc, reason] of [
      ['[{"chainId": "aptos:99", "selector": 4242, "family": "EVM"}]', 'not a valid EVM chain id'],
      ['[{"chainId": 2337, "selector": 4242, "family": "SVM"}]', 'not a valid SVM chain id'],
      ['[{"chainId": 2337, "selector": 4242, "family": "BITCOIN"}]', 'unknown family'],
      ['[{"chainId": 2337, "selector": 4242, "networkType": "STAGING"}]', 'unknown networkType'],
      ['not-a-chain-id!=4242', 'cannot infer the family'],
    ] as const)
      assert.throws(() => register(doc), rejects(reason), doc)
  })

  describe('forks', () => {
    it('re-keys the forked chain, named by its name or its selector', () => {
      for (const target of ['ethereum-testnet-sepolia', String(SEPOLIA_SELECTOR)]) {
        const [fork] = register(`${FORK_CHAIN_ID}=${target}`)
        assert.deepEqual(fork, {
          chainId: FORK_CHAIN_ID,
          chainSelector: SEPOLIA_SELECTOR,
          name: 'ethereum-testnet-sepolia',
          family: ChainFamily.EVM,
          networkType: NetworkType.Testnet,
        })
        // a message decoded on the fork carries Sepolia's selector: it must resolve to the fork
        assert.equal(networkInfo(SEPOLIA_SELECTOR).chainId, FORK_CHAIN_ID)
        assert.throws(() => networkInfo(11155111), CCIPChainNotFoundError)
        restoreSelectors()
      }
    })

    it('takes an optional name, and forkOf in documents', () => {
      const [fork] = register(
        `[{"chainId": ${FORK_CHAIN_ID}, "forkOf": "ethereum-testnet-sepolia", "name": "tenderly-sepolia"}]`,
      )
      assert.equal(fork!.name, 'tenderly-sepolia')
      assert.equal(networkInfo('tenderly-sepolia').chainSelector, SEPOLIA_SELECTOR)
      assert.throws(() => networkInfo('ethereum-testnet-sepolia'), CCIPChainNotFoundError)
    })

    it("keeps the forked chain's family, prefixing its chain id format", () => {
      const [fork] = register('7=aptos-testnet')
      assert.equal(fork!.chainId, 'aptos:7')
      assert.equal(fork!.family, ChainFamily.Aptos)
      assert.throws(
        () =>
          register(`[{"chainId": 7357, "forkOf": "ethereum-testnet-sepolia", "family": "SVM"}]`),
        rejects('conflicts with ethereum-testnet-sepolia'),
      )
    })

    it('takes over a bundled local chain id (hardhat node --fork keeps 31337)', () => {
      assert.equal(networkInfo(31337).name, 'anvil-devnet')
      register('31337=ethereum-testnet-sepolia')
      assert.equal(networkInfo(31337).chainSelector, SEPOLIA_SELECTOR)
      assert.equal(networkInfo(SEPOLIA_SELECTOR).chainId, 31337)
    })

    it('rejects an unknown forked chain', () => {
      assert.throws(() => register('7357=no-such-chain'), rejects('unknown chain "no-such-chain"'))
      assert.throws(
        () => register('[{"chainId": 7357, "forkOf": 4242}]'),
        rejects('no known chain has selector 4242'),
      )
    })
  })

  it('rejects a known chain id where a selector belongs, naming the fix', () => {
    assert.throws(() => register('2337=11155111'), rejects('2337=ethereum-testnet-sepolia'))
    assert.throws(() => networkInfo(2337), CCIPChainNotFoundError)
  })

  it('refuses to replace a mainnet chain id, with a new chain or a fork', () => {
    assert.throws(() => register('1=4242'), rejects('refusing to replace'))
    assert.throws(() => register('1=ethereum-testnet-sepolia'), rejects('refusing to replace'))
    assert.equal(networkInfo(1).name, 'ethereum-mainnet')
    assert.equal(networkInfo(11155111).name, 'ethereum-testnet-sepolia')
  })

  it('replaces a bundled testnet chain id with a new selector', () => {
    const [info] = register('1337=12922642891491394802')
    assert.equal(info!.chainSelector, DST_SELECTOR)
    assert.equal(info!.name, 'custom-1337')
  })

  it('rejects a name another chain uses, or one that reads as a chain id', () => {
    for (const [name, reason] of [
      ['ethereum-testnet-sepolia', 'already used by chain 11155111'],
      ['12345', 'would resolve as a chain id'],
      ['aptos:1', 'would resolve as a chain id'],
    ] as const)
      assert.throws(
        () => register(`[{"chainId": 2337, "selector": 12922642891491394802, "name": "${name}"}]`),
        rejects(reason),
        name,
      )
  })

  it('rejects an out-of-range selector', () => {
    assert.throws(() => register('2337=0'), rejects('uint64'))
    assert.throws(() => register('2337=18446744073709551616'), rejects('uint64'))
  })

  it('is idempotent, and keeps a registered name on a repeat', () => {
    register('[{"chainId": 2337, "selector": 12922642891491394802, "name": "local-dst"}]')
    const [again] = register('2337=12922642891491394802')
    assert.equal(again!.name, 'local-dst')
    assert.equal(networkInfo(DST_SELECTOR).chainId, 2337)
  })
})
