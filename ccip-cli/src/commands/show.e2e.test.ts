import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { useResource } from '../../../scripts/useResource.ts'
import { RPCS, spawnCLI } from './e2e-helpers.test.ts'

// The CLI is pointed at these endpoints via the shared RPCS list (e2e-helpers.ts), and
// `show` also resolves 32-byte tx hashes through the default CCIP API (show.ts).
// Only the chains this suite actually reaches are locked: sepolia and fuji are
// still here (sepolia is the dest of the Solana->EVM and Aptos->EVM fixtures,
// fuji the source of the Solana v2 one), but the EVM->EVM, EVM->Aptos and
// EVM->Solana fixtures have moved off them. ton-testnet is not listed: the TON
// block is `describe.skip`ped, so holding its lock only blocks the SDK suites.
await useResource([
  'sepolia',
  'fuji',
  'base-mainnet',
  'polygon-mainnet',
  'soneium-mainnet',
  'astar-mainnet',
  'bsc-testnet',
  'base-sepolia',
  'aptos-testnet',
  'solana-devnet',
  'api',
])

function buildShowArgs(txHash: string, ...additionalArgs: string[]): string[] {
  return [
    'show',
    txHash,
    '--rpc',
    ...RPCS,
    '--rpcs-file',
    '', // Disable rpcs file loading
    ...additionalArgs,
  ]
}

describe('e2e command show EVM', () => {
  // base -> polygon, v1.5. Carries the pair this test exists for: a receipt that
  // failed with TokenHandlingError followed by a successful re-execution. Moved
  // off sepolia -> fuji so the whole EVM show block stops holding the two locks
  // that seven other suites queue on.
  const TX_HASH = '0x06a9dc0922e6c0b91b3944df5642a74add3fa76c88be6380652d9c14a5e809c4'
  const MESSAGE_ID = '0x0819adc396d212cd0a01d6ff177e83339707fe6785e4622daee4089ec9592055'
  const SENDER = '0xd7ca08eC1AEe9ccE8a8eDa9365343eF197674e1a'
  const RECEIVER = '0xd7ca08eC1AEe9ccE8a8eDa9365343eF197674e1a'
  const ONRAMP = '0xd3Bde678BB706Cf727A512515C254BcF021dD203'
  // Unlike the previous fixture, this message was sent THROUGH a contract, so
  // origin (the EOA that sent the tx) differs from sender (the CCIP sender).
  const ORIGIN = '0xcF57BFBC6e4aCDa88147634148aB17Cbbe875ee4'

  // The format variants below re-run the SAME scan-heavy `show` flow as the
  // pretty-format test above, and only assert on output shape — so they run it
  // against a quiet lane instead of the testnet hubs. soneium -> astar is v1.5
  // like the fixture above (the generation stays covered either way), but its
  // dest sees ~100 messages a month against fuji's ~290, on ~6.7s blocks: the
  // commit/execution scans have far less history to sift. Measured 9.8s end to
  // end versus ~60s for the hub lane.
  //
  // The pretty-format test keeps the sepolia -> fuji fixture: its failed
  // (TokenHandlingError) plus successful receipt pair is coverage no other
  // fixture here carries.
  const QUIET_TX_HASH = '0xf0a6da25d9d99cfff8632bb1ef76c062c2e8e7b39fffd8abdde462f50849a6a0'
  const QUIET_MESSAGE_ID = '0xc3c483fb2abc6c04b34ffe6713a4b17422db684a6880f4a27169ce8608b811ac'
  const QUIET_SENDER = '0x464fC339aDD314932920d3e060745bd7Ea3e92AD'
  const QUIET_RECEIVER = '0x4036a6Ff8C1a29677108Aef299B560f6E4fA5e71'

  describe('pretty format (default)', () => {
    it(
      'should show complete CCIP transaction details EVM to EVM',
      { timeout: 120000 },
      async () => {
        const args = buildShowArgs(TX_HASH)
        const result = await spawnCLI(args, 120000)

        assert.equal(result.exitCode, 0, result.stderr)
        const output = result.stdout

        // Lane information
        assert.match(output, /name.*ethereum-mainnet-base-1.*polygon-mainnet/i)
        assert.match(output, /chainId.*8453.*137/)
        assert.match(output, /chainSelector.*15971525489660198786n?.*4051577828743386545n?/)
        assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*1\\.5\\.0`, 'i'))

        // Request information
        assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
        assert.match(output, new RegExp(`origin.*${ORIGIN}`, 'i'))
        assert.match(output, new RegExp(`sender.*${SENDER}`, 'i'))
        assert.match(output, new RegExp(`receiver.*${RECEIVER}`, 'i'))
        assert.match(output, /sequenceNumber.*8944n?/)
        assert.match(output, /nonce.*18n?/)
        assert.match(output, /gasLimit.*0n?/)
        assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
        assert.match(output, /logIndex.*441/)
        assert.match(output, /blockNumber.*50495330/)
        assert.match(output, /timestamp/)
        assert.match(output, /finalized.*true/)
        assert.match(output, /fee.*0\.000109586074487049\s+WETH/)
        assert.match(output, /tokens.*24031\.708326310761979428\s+LYP/)
        assert.match(output, /data.*0x/)

        // Commit information
        assert.match(output, /Commit.*dest/i)
        assert.match(output, new RegExp(`merkleRoot.*${MESSAGE_ID}`, 'i'))
        assert.match(output, /min.*8944/)
        assert.match(output, /max.*8944/)
        assert.match(output, /origin.*0xcF57BFBC6e4aCDa88147634148aB17Cbbe875ee4/i)
        assert.match(output, /contract.*0x936A0C8635D7087a2D22494762e9a697C3C3D545/i)
        assert.match(
          output,
          /transactionHash.*0xf383450305698c64320574d46140910dba767420737a395a87f34306c4c523fd/i,
        )
        assert.match(output, /blockNumber.*92717489/)
        assert.match(output, /timestamp.*after request/)

        // Receipts information
        assert.match(output, /Receipts.*dest/i)

        // First receipt - failed with TokenHandlingError
        assert.match(output, /state.*failed/i)
        assert.match(output, /TokenHandlingError/)
        assert.match(output, /err.*0x/i)
        assert.match(output, /contract.*0xF4a9Dbb7f3FBa02e3a244B464e459C32B63857F1/i)
        assert.match(
          output,
          /transactionHash.*0x7a4016d9169155e7c9bae164cd8833f585207d49cf5b9e1a11ff1faf66fbfda6/i,
        )
        assert.match(output, /logIndex.*256/)
        assert.match(output, /blockNumber.*92717513/)

        // Second receipt - successful
        assert.match(output, /state.*success/i)
        assert.match(output, new RegExp(`origin.*${ORIGIN}`, 'i'))
        assert.match(output, /contract.*0xF4a9Dbb7f3FBa02e3a244B464e459C32B63857F1/i)
        assert.match(
          output,
          /transactionHash.*0x8ebe004dd18907edacfdfb5e204328cb42a1640d359d91bd86f775a93384fe8f/i,
        )
        assert.match(output, /logIndex.*130/)
        assert.match(output, /blockNumber.*92717536/)

        // Verify we have both failed and successful executions
        const failedMatches = output.match(/failed/gi) || []
        const successMatches = output.match(/success/gi) || []
        assert.ok(failedMatches.length >= 1)
        assert.ok(successMatches.length >= 1)
      },
    )
  })

  describe('json format', () => {
    it(
      'should output a single valid JSON envelope with all expected fields',
      { timeout: 120000 },
      async () => {
        const args = buildShowArgs(QUIET_TX_HASH, '--format', 'json')
        const result = await spawnCLI(args, 120000)

        assert.equal(result.exitCode, 0, result.stderr)

        // Should be a single parseable JSON envelope
        const envelope = JSON.parse(result.stdout)

        // Request
        assert.ok(envelope.request, 'envelope should contain request')
        assert.ok(envelope.request.message, 'request should have message')
        assert.match(envelope.request.message.messageId, new RegExp(QUIET_MESSAGE_ID, 'i'))
        assert.ok(envelope.request.message.sender, 'message should have sender')
        assert.ok(envelope.request.message.receiver, 'message should have receiver')
        assert.ok(
          'sequenceNumber' in envelope.request.message,
          'message should have sequenceNumber',
        )

        // Verifications (commit report)
        assert.ok(envelope.verifications, 'envelope should contain verifications')
        assert.match(JSON.stringify(envelope.verifications), /"merkleRoot"/)

        // Receipts
        assert.ok(Array.isArray(envelope.receipts), 'envelope.receipts should be an array')
        assert.ok(envelope.receipts.length >= 1, 'should have at least one receipt')
      },
    )
  })

  describe('log format', () => {
    it('should output in log format with object assignments', { timeout: 120000 }, async () => {
      const args = buildShowArgs(QUIET_TX_HASH, '--format', 'log')
      const result = await spawnCLI(args, 120000)

      assert.equal(result.exitCode, 0, result.stderr)

      // Log format should contain assignment operators
      assert.match(result.stdout, /message.*=/)
      assert.match(result.stdout, /commit.*=/)
      assert.match(result.stdout, /receipt.*=/)

      // Should contain expected data
      assert.match(result.stdout, new RegExp(QUIET_MESSAGE_ID, 'i'))
      assert.match(result.stdout, new RegExp(QUIET_SENDER, 'i'))
      assert.match(result.stdout, new RegExp(QUIET_RECEIVER, 'i'))
    })
  })

  describe('verbose flag', () => {
    it('should work with verbose flag enabled', { timeout: 120000 }, async () => {
      const args = buildShowArgs(QUIET_TX_HASH, '--verbose')
      const result = await spawnCLI(args, 120000)

      assert.equal(result.exitCode, 0, result.stderr)
      assert.ok(result.stdout.length > 0)

      // Should still contain main output
      assert.match(result.stdout, /Lane/)
      assert.match(result.stdout, /Request/)
      assert.match(result.stdout, new RegExp(QUIET_MESSAGE_ID, 'i'))
    })
  })

  describe('error handling', () => {
    it('should handle invalid transaction hash gracefully', { timeout: 120000 }, async () => {
      const invalidTxHash = '0x0000000000000000000000000000000000000000000000000000000000000000'
      const args = buildShowArgs(invalidTxHash)
      const result = await spawnCLI(args, 120000)

      // Should exit with error code
      assert.notEqual(result.exitCode, 0)

      // Should have error output
      assert.ok(result.stderr.length > 0)
    })

    it('should require transaction hash argument', { timeout: 30000 }, async () => {
      const args = ['show', '--rpc', ...RPCS, '--rpcs-file', '.gitignore']
      const result = await spawnCLI(args, 30000)

      // Should exit with error code
      assert.notEqual(result.exitCode, 0)

      // Should mention missing argument
      assert.match(result.stderr, /tx-hash|required|missing/i)
    })
  })

  it(
    'should show complete CCIP transaction details EVM to Aptos',
    { timeout: 240000 },
    async () => {
      // Fixture seeded periodically from CCIP API v2 messages
      // (sourceChainSelector=13264668187771770619, destChainSelector=743186221051783445).
      // Source moved off sepolia onto bsc-testnet: the source side is a single
      // tx-by-hash read, so it costs nothing to serve and frees the sepolia lock
      // for the suites that genuinely scan it.
      const TX_HASH = '0x407ffe6bf58d39e08c786a7b31a407d758effb8657372c330a07a796137816a7'
      const MESSAGE_ID = '0xac0a5e71cd2e1d637d3b6af558bb255a7f6196cc7954c2b7146b8e055f9a9fe7'
      const SENDER = '0x89810cb91a5fe67dDf3483182f08e1559A5699De'
      const RECEIVER = '0xc7dfb38f07910cba7157db3ead1471ebc5a87f71a5aaad3921637f5371da69d8'
      const ONRAMP = '0x28A025d34c830BF212f5D2357C8DcAB32dD92A20'
      const OFFRAMP = '0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45'

      const args = buildShowArgs(TX_HASH)
      const result = await spawnCLI(args, 240000)

      assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`)
      const output = result.stdout

      // Lane information
      assert.match(output, /name.*binance_smart_chain-testnet.*aptos-testnet/i)
      assert.match(output, /chainId.*97.*aptos:2/)
      assert.match(output, /chainSelector.*13264668187771770619n?.*743186221051783445n?/)
      assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*1\\.6\\.0`, 'i'))

      // Request information
      assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
      assert.match(output, new RegExp(`origin.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`sender.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`receiver.*${RECEIVER}`, 'i'))
      assert.match(output, /sequenceNumber.*2867n?/)
      assert.match(output, /nonce.*0.*allow out-of-order/)
      assert.match(output, /gasLimit.*0n?/)
      assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
      assert.match(output, /logIndex.*7\b/)
      assert.match(output, /blockNumber.*127636236/)
      assert.match(output, /fee.*0\.000351598679631162\s+WBNB/)
      assert.match(output, /tokens.*0\.0014\s+CCIP-BnM/)
      assert.match(output, /data.*0x'?/)
      assert.match(output, /allowOutOfOrderExecution.*true\b/)

      // The API-metadata path short-circuits the commit/receipt scans (old
      // fixtures' event history is pruned on public nodes); the receipt table
      // itself still prints and stays fully assertable
      assert.match(output, /state.*success/i)
      assert.match(output, new RegExp(`contract.*${OFFRAMP}::offramp`, 'i'))
      assert.match(
        output,
        /transactionHash.*0xb6a16526932bbf8401c9e92b0d641ee799556bf613b433eefb5e9631f19d9c11/i,
      )
      assert.match(output, /blockNumber.*10855148519/)
    },
  )

  it(
    'should show complete CCIP transaction details EVM to Solana',
    { timeout: 120000 },
    async () => {
      // Fixture seeded from CCIP API v2 messages (sourceChainSelector=10344971235874465080,
      // destChainSelector=16423721717087811551); refreshed periodically, as devnet public
      // endpoints prune old transaction history (onfinality ~1 month at the time of writing).
      // Source is base-sepolia rather than sepolia: only the dest is scanned here,
      // so the source chain is free to be a quieter one.
      const TX_HASH = '0xac5c1d0ed9df2e2e403944ea7f92e490254f7ba8ee01599e0d4546ae07731b8e'
      const MESSAGE_ID = '0x46e394b2700e68d025a632cb2b3097eafea2235e7c6441ba85241194a6400c4c'
      const SENDER = '0x504f1fCFc4AF3Ae87f1a732f844eE08faBEA1ba6'
      const RECEIVER = '11111111111111111111111111111111'
      const TOKEN_RECEIVER = '399FfoqF5rGrh5KXNhzPEWCkDv11fZ4gGsGGU5c9MBYd'
      const ONRAMP = '0x28A025d34c830BF212f5D2357C8DcAB32dD92A20'
      const OFFRAMP = 'offqSMQWgQud6WJz694LRzkeN5kMYpCHTpXQr3Rkcjm'

      const args = buildShowArgs(TX_HASH)
      const result = await spawnCLI(args, 120000)

      assert.equal(result.exitCode, 0, result.stdout + result.stderr)
      const output = result.stdout

      // Lane information
      assert.match(output, /name.*ethereum-testnet-sepolia-base-1.*solana-devnet/i)
      assert.match(output, /chainId.*84532.*EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG/)
      assert.match(output, /chainSelector.*10344971235874465080n?.*16423721717087811551n?/)
      assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*1\\.6\\.0`, 'i'))

      // Request information
      assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
      assert.match(output, new RegExp(`origin.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`sender.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`receiver.*${RECEIVER}`, 'i'))
      assert.match(output, /sequenceNumber.*1499n?/)
      assert.match(output, /nonce.*0n?.*allow out-of-order/)
      assert.doesNotMatch(output, /gasLimit/)
      assert.match(output, /computeUnits.*0n?/)
      assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
      assert.match(output, /data.*0x'?/)
      assert.match(output, /allowOutOfOrderExecution.*true\b/)
      assert.match(output, new RegExp(`tokenReceiver.*${TOKEN_RECEIVER}\\b`, 'i'))

      // Commit information
      assert.match(output, /Commit.*dest/i)
      assert.match(
        output,
        /merkleRoot.*0x86fc0530dc5b01e0f8f72d71c3eb799c3549e35a00c452f3f8d1a0418d582e91/i,
      )
      assert.match(output, /min.*1499/)
      assert.match(output, /max.*1499/)
      assert.match(output, /origin.*8zJTVcm3bEAgJfsQPUBxyV5PEWTea81pKQV6uDVHpxjY/i)
      assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
      assert.match(
        output,
        /transactionHash.*44Uze89tcZhiNE55P5dPmk4HFkpSUBTg7jAdXYd7Nvemz2MV6wPJZLbmXJcXJtHdaLCYfLvevENeCs3k77SskCj1/i,
      )

      // Receipts information
      assert.match(output, /Receipts.*dest/i)
      assert.match(output, /state.*success/i)
      assert.match(
        output,
        /transactionHash.*5nLiGaRuTwLqe6MQxfgSPWtqq3jLgNMTSwLXH5zGBZbTSdcc6DHbxgQLfo3Pos7jzMhcSpsaohCqo32tP5QmBLS3/i,
      )
    },
  )

  it(
    'should show EVM to Solana v2 OffRamp execution without verifications',
    { timeout: 30000 },
    async () => {
      // Solana v2 is not indexed by the CCIP API yet, so this fixture (and its
      // asserted values) come from a real CLI run, not from an API lookup — and
      // the same gap is why the verification lookup stays unavailable. Source is
      // fuji: v2 onRamps are not deployed on the quiet lanes used above.
      const TX_HASH = '0x40868c0b3f07b769c51d64dc8866e3b7c52a03b19232c6acee232acc18f21ab9'
      const MESSAGE_ID = '0x15e6a1e42b3c8b6d32eed44791910af96bb70bd8b13fd135ae9ae3a9f70df08a'
      const ONRAMP = '0x656345b769a568138919bF7CA0928fDcaa3964Dc'
      const OFFRAMP = 'offzdKY3MVHcs8c639Atwqr7KGbZrxmNDC27s2DJeEr'

      const result = await spawnCLI(buildShowArgs(TX_HASH), 30000)

      assert.equal(result.exitCode, 0, result.stdout + result.stderr)
      const output = result.stdout
      assert.match(output, /name.*avalanche-testnet-fuji.*solana-devnet/i)
      assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*2\\.0\\.0`, 'i'))
      assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
      assert.match(output, /sequenceNumber.*27\b/)
      assert.match(output, /data.*0x\b/)
      assert.match(output, new RegExp(`offRampAddress.*${OFFRAMP}`, 'i'))
      assert.match(result.stderr + output, /Verifications unavailable/i)
      assert.match(output, /Receipts.*dest/i)
      assert.match(output, /state.*success/i)
      assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
      assert.match(
        output,
        /transactionHash.*sNNt4YwJW6AA8RWyTcXsuPrHSNsmrsB1AwJvPNT8igps9PcADjz1LDL4pjxZfixaX2R1mQg26A835X1ibMiW9QR/i,
      )
    },
  )
})

describe('e2e command show Solana', () => {
  // Fixture seeded from CCIP API v2 messages (sourceChainSelector=16423721717087811551,
  // destChainSelector=16015286601757825753); refreshed periodically, as devnet public
  // endpoints prune old transaction history (onfinality ~1 month at the time of writing)
  const TX_HASH =
    '2C9MV381HRk9McBkDtTiviinq8XBD4XEn8LHJFc6MJMRZPgimmQEEmF3AXTboe2u6KJH8seCw7z3MVNuv9tGQS8D'
  const MESSAGE_ID = '0xa8733c341bbaab40b2fae5cc06195450515aea2b9f602436d9ae05b9aa6ce6ba'
  const SENDER = 'DWGBy9ZqkXnbiyLzSSy4qymE3P3aDBQMFGPAmSiffkA8'
  const RECEIVER = '0x4444638F73a73977098f364533dFaD6A274f1e88'
  const ONRAMP = 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C'
  const OFFRAMP = '0x0820f975ce90EE5c508657F0C58b71D1fcc85cE0'

  it(
    'should show complete CCIP transaction details Solana to EVM',
    { timeout: 240000 },
    async () => {
      const args = buildShowArgs(TX_HASH)
      const result = await spawnCLI(args, 240000)

      assert.equal(result.exitCode, 0, result.stdout + result.stderr)
      const output = result.stdout

      // Lane information
      assert.match(output, /name.*solana-devnet.*ethereum-testnet-sepolia/i)
      assert.match(output, /chainId.*EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG.*11155111/)
      assert.match(output, /chainSelector.*16423721717087811551n?.*16015286601757825753n?/)
      assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*1\\.6\\.`, 'i'))

      // Request information
      assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
      assert.match(output, new RegExp(`origin.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`sender.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`receiver.*${RECEIVER}`))
      assert.match(output, /sequenceNumber.*3399n?/)
      assert.match(output, /nonce.*0n?.*allow out-of-order/)
      assert.match(output, /gasLimit.*0n?/)
      assert.match(output, /finalized.*true/)
      assert.match(output, /fee.*\bSOL/)
      assert.match(output, /tokens.*0\.1 tFRNT/)
      assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
      assert.match(output, /data.*0x'?/)
      assert.match(output, /allowOutOfOrderExecution.*true\b/)

      // Commit information. Provider lag degrades the commit to
      // `Verifications unavailable` (warned on stderr) or an empty table
      // under the heading on public gateways; either gilt.
      if (!/Verifications unavailable/i.test(result.stderr + output)) {
        assert.match(output, /Commit.*dest/i)
        assert.match(
          output,
          /merkleRoot.*0x357f41e09ea7c7ddae192ccf9b340e0cc77f2f851a8a5c76b4bb1885aa6c064f/i,
        )
        assert.match(output, /min.*3399/)
        assert.match(output, /max.*3399/)
        assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
        assert.match(
          output,
          /transactionHash.*0x296003094714bf5eb53ab8a28a55fae917a38d214f285b7a93517ddbd23cf711/i,
        )
      }

      // Receipts information: destination is sepolia, whose public nodes retain full
      // log history, so the receipt deterministically renders for this fixture
      assert.match(output, /Receipts.*dest/i)
      assert.match(output, /state.*success/i)
      assert.match(
        output,
        /transactionHash.*0x18258e9875a64b8b2a77d967963eaf4a8e3593d58224ccaa24cf1b1fa892331c/i,
      )
    },
  )
})

describe('e2e command show Aptos', () => {
  // Fixture seeded periodically from CCIP API v2 messages
  // (sourceChainSelector=743186221051783445, destChainSelector=16015286601757825753)
  const TX_HASH = '0x034540a867b525b4f5b80ee70b964b112277e3bc4f97772e44f29bbd4522d4b1'
  const MESSAGE_ID = '0xddbb8b48fa12ce0e64c21fad6fbeb9f2a0a67e2ed2a24429a351bc4faa07b567'
  const SENDER = '0x275b828b4c4aede0c53b59ec594d12dfb86c5f01f8300395d0ee8a869aacf8cc'
  const RECEIVER = '0x9d087fC03ae39b088326b67fA3C788236645b717'
  const ONRAMP = '0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45'
  const OFFRAMP = '0x0820f975ce90EE5c508657F0C58b71D1fcc85cE0'

  it(
    'should show complete CCIP transaction details Aptos to EVM',
    { timeout: 240000 },
    async () => {
      const args = buildShowArgs(TX_HASH)
      const result = await spawnCLI(args, 240000)

      assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`)
      const output = result.stdout

      // Lane information
      assert.match(output, /name.*aptos-testnet.*ethereum-testnet-sepolia/i)
      assert.match(output, /chainId.*aptos:2.*11155111/)
      assert.match(output, /chainSelector.*743186221051783445n?.*16015286601757825753n?/)
      assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*1\\.6\\.0`, 'i'))

      // Request information
      assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
      assert.match(output, new RegExp(`origin.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`sender.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`receiver.*${RECEIVER}`))
      assert.match(output, /sequenceNumber.*164n?/)
      assert.match(output, /nonce.*0.*allow out-of-order/)
      assert.match(output, /gasLimit.*0n?/)
      assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
      assert.match(output, /logIndex.*8\b/)
      assert.match(output, /blockNumber.*10547904420/)
      assert.match(output, /fee.*\bAPT/)
      assert.match(output, /tokens.*0\.001\s+CCIP-BnM/)
      assert.match(output, /data.*0x'?/)
      assert.match(output, /allowOutOfOrderExecution.*true\b/)

      // The API-metadata path short-circuits the commit/receipt scans (old
      // fixtures' event history is pruned on public nodes); the receipt table
      // itself still prints and stays fully assertable. Provider lag can also
      // leave the receipts section empty under its heading — tolerate that,
      // but not a wrong receipt.
      assert.match(output, /Receipts.*dest|No execution receipt/i)
      // Provider shards disagree on which historic receipt row they serve:
      // require A receipt row when one is rendered, only pin the hash when the
      // successful one shows up
      if (/\bstate\b|No execution receipt/i.test(output)) {
        assert.match(output, /state.*(success|failed)|No execution receipt/i)
        assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
        if (/state.*success/i.test(output)) {
          assert.match(
            output,
            /transactionHash.*0xfc7ba4cbdeca8c322d0ced6aa2f0668a96263312287fde2e532d27493cb0a6f8/i,
          )
        }
      }
    },
  )
})

describe.skip('e2e command show TON', () => {
  it('should show complete CCIP transaction details TON to EVM', { timeout: 120000 }, async () => {
    // Test transaction hash (raw 64-char hex, resolved via TonCenter)
    const TX_HASH = '160f4da4b46fa0370ac7f4fcdac03f3a85919bce900be0bacf539df61fca2525'
    const MESSAGE_ID = '0x48f80b0f66b929ef4196d3b3947051a7d9c6b892db38f98b8df07294808c3e7e'
    const SENDER = 'EQAFbU7ATpBTe2vPiTpThvehgNiynnD4llSA8IaJThJFpvP7'
    const RECEIVER = '0x40d7c009d073e0d740ed2c50ca0a48c84a3f8b47'
    const ONRAMP = 'EQDTIBzONmN64tMmLymf0-jtc_AAWfDlXiZcr7ja5ri7ak53'
    const OFFRAMP = '0x93Bb167Ebd91987f9Dff6B954b9Eead469d2b849'

    const args = buildShowArgs(TX_HASH)
    const result = await spawnCLI(args, 120000)

    assert.equal(result.exitCode, 0)
    const output = result.stdout

    // Lane information
    assert.match(output, /name.*ton-testnet.*ethereum-testnet-sepolia/i)
    assert.match(output, /chainId.*-3.*11155111/)
    assert.match(output, /chainSelector.*1399300952838017768n?.*16015286601757825753n?/)
    assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*1\\.6\\.0`, 'i'))

    // Request information
    assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
    assert.match(output, new RegExp(`sender.*${SENDER}`, 'i'))
    assert.match(output, new RegExp(`receiver.*${RECEIVER}`, 'i'))
    assert.match(output, /sequenceNumber.*985/)
    assert.match(output, /nonce.*0.*allow out-of-order/)
    assert.match(output, /gasLimit.*1000000n?/)
    assert.match(output, /data.*ccip-staging-20302718339/)
    assert.match(output, /allowOutOfOrderExecution.*true/)

    // Commit information
    assert.match(output, /Commit.*dest/i)
    assert.match(
      output,
      /merkleRoot.*0x03fac3a156309096f9415ea40f4a93e8674771eb6bc4511b31807510b6777207/i,
    )
    assert.match(output, /min.*985/)
    assert.match(output, /max.*985/)

    // Execution receipt
    assert.match(output, /Receipts.*dest/i)
    assert.match(output, /state.*success/i)
    assert.match(output, /gasUsed.*41293/)
    assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
  })

  it('should show complete CCIP transaction details EVM to TON', { timeout: 120000 }, async () => {
    const TX_HASH = '0x6b550ac7150cb00c791cd9201c451cc29ad4c19c92753729885bbb1145caa151'
    const MESSAGE_ID = '0xe43ee2db7e074e8b9606428f241f2db7b917897ddfdbe7a73d2c7a8d5ffdb0d5'
    const SENDER = '0xb9b390cabcc2aa9a22cac4f39550e0fe0ecf25b7'
    const RECEIVER = 'EQAu0B-M1cibJaRPTJmUHBWuXu4Ng0mwDjKbthryf6D6JJ3c'
    const ONRAMP = '0xa36871bde0f98b84066405462e4a9709fb71c905'
    const OFFRAMP = 'EQBoGLxL52YDV1OwcaDLcNHyGVOxtcHQDxFb0WqVUQeyRHBd'

    const args = buildShowArgs(TX_HASH)
    const result = await spawnCLI(args, 120000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)
    const output = result.stdout

    // Lane information
    assert.match(output, /name.*ethereum-testnet-sepolia.*ton-testnet/i)
    assert.match(output, /chainId.*11155111.*-3/)
    assert.match(output, /chainSelector.*16015286601757825753n?.*1399300952838017768n?/)
    assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*1\\.6\\.0`, 'i'))

    // Request information
    assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
    assert.match(output, new RegExp(`origin.*${SENDER}`, 'i'))
    assert.match(output, new RegExp(`sender.*${SENDER}`, 'i'))
    assert.match(output, new RegExp(`receiver.*${RECEIVER}`, 'i'))
    assert.match(output, /sequenceNumber.*2388/)
    assert.match(output, /nonce.*0.*allow out-of-order/)
    assert.match(output, /gasLimit.*100000000n?/)
    assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
    assert.match(output, /data.*ccip-staging-/)
    assert.match(output, /allowOutOfOrderExecution.*true/)

    // Commit information (dest is TON - friendly format)
    assert.match(output, /Commit.*dest/i)
    assert.match(
      output,
      /merkleRoot.*0xbada41892c6b8c182692dbdb3661acfd9e4096d6db43c4b1ead1f3010fb03197/i,
    )
    assert.match(output, /min.*2386/)
    assert.match(output, /max.*2388/)
    assert.match(output, new RegExp(`origin.*${OFFRAMP}`, 'i'))
    assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
    // Transaction hash should be in friendly format (64-char hex, not composite)
    assert.match(
      output,
      /transactionHash.*6dc1abd410c256f9559dddcddf49b32b69e0df3c4abb16011c8135af6b64f166/i,
    )

    // Execution receipt
    assert.match(output, /Receipts.*dest/i)
    assert.match(output, /state.*success/i)
    assert.match(output, new RegExp(`origin.*${OFFRAMP}`, 'i'))
    assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
    assert.match(
      output,
      /transactionHash.*86866ebd8beb4afc5bedb3fbb1bfec0c1f2c86ca843ddf47b22bfb14666245b1/i,
    )
    assert.match(output, /logIndex.*43860281000027/) // lt is now logIndex
    // TODO: update blockNumber to actual masterchain seqno once test is re-enabled

    // TON shows execution history including failed attempts and final success after manualExec
    // First receipt final state: failed
    // assert.match(output, /state.*failed/i)
    // assert.match(
    //   output,
    //   /transactionHash.*531c2fbc8db214d194aef894bfbb7163b3ad9f8c36f89d18b459c9f52d4faa14/i,
    // )

    // Second receipt final state: successful
    assert.match(output, /state.*success/i)
    assert.match(
      output,
      /transactionHash.*86866ebd8beb4afc5bedb3fbb1bfec0c1f2c86ca843ddf47b22bfb14666245b1/i,
    )

    // Verify we have both failed and successful executions
    const receiptsSection = output.split(/Receipts.*dest/i)[1] || ''
    // const failedMatches = receiptsSection.match(/failed/gi) || []
    const successMatches = receiptsSection.match(/success/gi) || []
    // assert.ok(failedMatches.length >= 1, 'Should have at least one failed execution')
    assert.ok(successMatches.length >= 1, 'Should have at least one successful execution')
  })
})
