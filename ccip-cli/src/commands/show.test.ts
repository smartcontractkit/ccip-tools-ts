import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { RPCS, spawnCLI } from './e2e-helpers.test.ts'

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
  // Test transaction hash
  const TX_HASH = '0x25e63fa89abb77acd353edc24ed3ab5880a8d206c8229e6f61dc00d399f447b3'
  const MESSAGE_ID = '0xdfb374fef50749b0bc86784e097ecc9547c5145ddfb8f9d96f1da3024abfcd04'
  const SENDER = '0x9728099d6D7b66b6314d388e57027a8E43d70262'
  const RECEIVER = '0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38'
  const ONRAMP = '0x12492154714fBD28F28219f6fc4315d19de1025B'

  describe('pretty format (default)', () => {
    it(
      'should show complete CCIP transaction details EVM to EVM',
      { timeout: 120000 },
      async () => {
        const args = buildShowArgs(TX_HASH)
        const result = await spawnCLI(args, 120000)

        assert.equal(result.exitCode, 0)
        const output = result.stdout

        // Lane information
        assert.match(output, /name.*ethereum-testnet-sepolia.*avalanche-testnet-fuji/i)
        assert.match(output, /chainId.*11155111.*43113/)
        assert.match(output, /chainSelector.*16015286601757825753n?.*14767482510784806043n?/)
        assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*1\\.5\\.0`, 'i'))

        // Request information
        assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
        assert.match(output, new RegExp(`origin.*${SENDER}`, 'i'))
        assert.match(output, new RegExp(`sender.*${SENDER}`, 'i'))
        assert.match(output, new RegExp(`receiver.*${RECEIVER}`, 'i'))
        assert.match(output, /sequenceNumber.*20710n?/)
        assert.match(output, /nonce.*1n?/)
        assert.match(output, /gasLimit.*0n?/)
        assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
        assert.match(output, /logIndex.*143/)
        assert.match(output, /blockNumber.*9558246/)
        assert.match(output, /timestamp/)
        assert.match(output, /finalized.*true/)
        assert.match(output, /fee.*0\.00007143791528662\s+WETH/)
        assert.match(output, /tokens.*1\.0\s+SMTAT/)
        assert.match(output, /data.*0x/)

        // Commit information
        assert.match(output, /Commit.*dest/i)
        assert.match(output, new RegExp(`merkleRoot.*${MESSAGE_ID}`, 'i'))
        assert.match(output, /min.*20710/)
        assert.match(output, /max.*20710/)
        assert.match(output, /origin.*0x95C2F4b6dd6A61492BEf67A1af2aD1b14c6b690a/i)
        assert.match(output, /contract.*0x4EC313c1Eb620432f42FB5f4Df27f8A566523c1C/i)
        assert.match(
          output,
          /transactionHash.*0xa95b107fcd8612fba0215a4d7d77807019ce6658e461162cd85b9914fd05587e/i,
        )
        assert.match(output, /blockNumber.*47435605/)
        assert.match(output, /timestamp.*after request/)

        // Receipts information
        assert.match(output, /Receipts.*dest/i)

        // First receipt - failed with TokenHandlingError
        assert.match(output, /state.*failed/i)
        assert.match(output, /TokenHandlingError/)
        assert.match(output, /err.*0x/i)
        assert.match(output, /contract.*0x01e3D835b4C4697D7F81B9d7Abc89A6E478E4a2f/i)
        assert.match(
          output,
          /transactionHash.*0x6a5846b444753943086251c66bc9ad396c8f3297b5d69f05e7d64cc1159b443f/i,
        )
        assert.match(output, /logIndex.*0/)
        assert.match(output, /blockNumber.*47435626/)

        // Second receipt - successful
        assert.match(output, /state.*success/i)
        assert.match(output, new RegExp(`origin.*${SENDER}`, 'i'))
        assert.match(output, /contract.*0x01e3D835b4C4697D7F81B9d7Abc89A6E478E4a2f/i)
        assert.match(
          output,
          /transactionHash.*0x3f04805d89d26666cb22fef28c1c206bfa399e3bbe7b91eeadcd8e0376a60cab/i,
        )
        assert.match(output, /logIndex.*4/)
        assert.match(output, /blockNumber.*47435778/)

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
        const args = buildShowArgs(TX_HASH, '--format', 'json')
        const result = await spawnCLI(args, 120000)

        assert.equal(result.exitCode, 0)

        // Should be a single parseable JSON envelope
        const envelope = JSON.parse(result.stdout)

        // Request
        assert.ok(envelope.request, 'envelope should contain request')
        assert.ok(envelope.request.message, 'request should have message')
        assert.match(envelope.request.message.messageId, new RegExp(MESSAGE_ID, 'i'))
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
      const args = buildShowArgs(TX_HASH, '--format', 'log')
      const result = await spawnCLI(args, 120000)

      assert.equal(result.exitCode, 0)

      // Log format should contain assignment operators
      assert.match(result.stdout, /message.*=/)
      assert.match(result.stdout, /commit.*=/)
      assert.match(result.stdout, /receipt.*=/)

      // Should contain expected data
      assert.match(result.stdout, new RegExp(MESSAGE_ID, 'i'))
      assert.match(result.stdout, new RegExp(SENDER, 'i'))
      assert.match(result.stdout, new RegExp(RECEIVER, 'i'))
    })
  })

  describe('verbose flag', () => {
    it('should work with verbose flag enabled', { timeout: 120000 }, async () => {
      const args = buildShowArgs(TX_HASH, '--verbose')
      const result = await spawnCLI(args, 120000)

      assert.equal(result.exitCode, 0)
      assert.ok(result.stdout.length > 0)

      // Should still contain main output
      assert.match(result.stdout, /Lane/)
      assert.match(result.stdout, /Request/)
      assert.match(result.stdout, new RegExp(MESSAGE_ID, 'i'))
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
    { timeout: 120000 },
    async () => {
      // Test transaction hash
      const TX_HASH = '0x69997bedbfbc352343f8a56cb49f2f22a3bc5e176f493c924f44ffca658c8257'
      const MESSAGE_ID = '0xbb6d843891bf8e578265ee77781718a51749753deb9fb9c694904dc41b54f1ac'
      const SENDER = '0x9d087fC03ae39b088326b67fA3C788236645b717'
      const RECEIVER = '0x9d5f576e963f593c8be9a22baad798fe2bb4a4103f2d719181362a75fa162eaf'
      const ONRAMP = '0x23a5084Fa78104F3DF11C63Ae59fcac4f6AD9DeE'
      const OFFRAMP = '0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45'

      const args = buildShowArgs(TX_HASH)
      const result = await spawnCLI(args, 120000)

      assert.equal(result.exitCode, 0)
      const output = result.stdout

      // Lane information
      assert.match(output, /name.*ethereum-testnet-sepolia.*aptos-testnet/i)
      assert.match(output, /chainId.*11155111.*aptos:2/)
      assert.match(output, /chainSelector.*16015286601757825753n?.*743186221051783445n?/)
      assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*1\\.6\\.0`, 'i'))

      // Request information
      assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
      assert.match(output, new RegExp(`origin.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`sender.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`receiver.*${RECEIVER}`, 'i'))
      assert.match(output, /sequenceNumber.*118n?/)
      assert.match(output, /nonce.*0n?.*allow out-of-order/)
      assert.match(output, /gasLimit.*0n?/)
      assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
      assert.match(output, /data.*0x'?/)
      assert.match(output, /allowOutOfOrderExecution.*true\b/)

      // Commit information
      assert.match(output, /Commit.*dest/i)
      assert.match(
        output,
        /merkleRoot.*0xcadbc221e627d31a51be0faecc6e44928d9b25d8fdaf5ccb9293cba57040a4ec/i,
      )
      assert.match(output, /min.*118/)
      assert.match(output, /max.*118/)
      assert.match(
        output,
        /origin.*0xf8db7fbae11c9ec9393ffeb0e8726489ee9d8181b5253d807d55fb7f5b5dce65/i,
      )
      assert.match(output, new RegExp(`contract.*${OFFRAMP}::offramp`, 'i'))
      assert.match(
        output,
        /transactionHash.*0xe6629dbc9c09e73a514f6e31181235459219f0bf0fc47a79154496ccba8c899a/i,
      )

      // Receipts information
      assert.match(output, /Receipts.*dest/i)
      assert.match(output, /state.*success/i)
      assert.match(
        output,
        /transactionHash.*0xc9d0414122d03cea72439647a7d3d9b6890baba4920305ad4eee693ce949487a/i,
      )
    },
  )

  it(
    'should show complete CCIP transaction details EVM to Solana',
    { timeout: 120000 },
    async () => {
      // Test transaction hash (refreshed periodically; devnet prunes old history)
      const TX_HASH = '0xe46dfcaddb6305cc416120bd188293f5693348ae8f94079dcde932163a2b039e'
      const MESSAGE_ID = '0xea49c8cc2b802612e91f30e045baff610ec23d98bd66b7f2070f137a777ffc65'
      const SENDER = '0x90656946eb4065D9FC2a0c0B9aF7Ff37c02F52a2'
      const RECEIVER = '11111111111111111111111111111111'
      const TOKEN_RECEIVER = 'HNgbNNzP7YLXLhEkaFcD3PhtBWtaBfxSCNRTCsnGyPNx'
      const ONRAMP = '0x23a5084Fa78104F3DF11C63Ae59fcac4f6AD9DeE'
      const OFFRAMP = 'offqSMQWgQud6WJz694LRzkeN5kMYpCHTpXQr3Rkcjm'

      const args = buildShowArgs(TX_HASH)
      const result = await spawnCLI(args, 120000)

      assert.equal(result.exitCode, 0, result.stdout + result.stderr)
      const output = result.stdout

      // Lane information
      assert.match(output, /name.*ethereum-testnet-sepolia.*solana-devnet/i)
      assert.match(output, /chainId.*11155111.*EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG/)
      assert.match(output, /chainSelector.*16015286601757825753n?.*16423721717087811551n?/)
      assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*1\\.6\\.0`, 'i'))

      // Request information
      assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
      assert.match(output, new RegExp(`origin.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`sender.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`receiver.*${RECEIVER}`, 'i'))
      assert.match(output, /sequenceNumber.*10726n?/)
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
        /merkleRoot.*0x67fab9e3b47f247924f4cec9671a99685e4abc07909d8bcf676bb5d990cc437f/i,
      )
      assert.match(output, /min.*10726/)
      assert.match(output, /max.*10726/)
      assert.match(output, /origin.*4BSJuForbUiKb5Y2unK6vrrdjQN9a6Fz5epnPrrU6Je6/i)
      assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
      assert.match(
        output,
        /transactionHash.*5uVS6SjKKrvP6khfA9hiRk68pwuNVjZXCJQNxwwp1MXs9cozT3q8dkfAhPPKcGheiBqbKnfZaf8yznxJ7pvrLgMM/i,
      )

      // Receipts information
      assert.match(output, /Receipts.*dest/i)
      assert.match(output, /state.*success/i)
      assert.match(
        output,
        /transactionHash.*32kjERFwLcmaJskvJUjWQncyrhdoLxnzPgKTT33nKmhKaLeguELxXQ4BKL3hHo8wnvz4vu5UzQztEi7u5G43cgiD/i,
      )
    },
  )

  it(
    'should show EVM to Solana v2 OffRamp execution without verifications',
    { timeout: 30000 },
    async () => {
      const TX_HASH = '0x94721bc1e04f7c5f6bfad4e479092aaf71efefccaa0babade4c4e7b5b3b24a41'
      const MESSAGE_ID = '0x6aada2cd53b51bd5b4f12cbd01b1e43a092d692e3211dd8a8cb062f28c28144f'
      const ONRAMP = '0x99F6Faf45CcfA166781DED7d9A4D9C548F2aA344'
      const OFFRAMP = 'offzdKY3MVHcs8c639Atwqr7KGbZrxmNDC27s2DJeEr'

      const result = await spawnCLI(buildShowArgs(TX_HASH), 30000)

      assert.equal(result.exitCode, 0, result.stdout + result.stderr)
      const output = result.stdout
      assert.match(output, /name.*ethereum-testnet-sepolia.*solana-devnet/i)
      assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*2\\.0\\.0`, 'i'))
      assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
      assert.match(output, /sequenceNumber.*526/)
      assert.match(output, /data.*0x\b/)
      assert.match(output, new RegExp(`offRampAddress.*${OFFRAMP}`, 'i'))
      assert.match(result.stderr + output, /Verifications unavailable/i)
      assert.match(output, /Receipts.*dest/i)
      assert.match(output, /state.*success/i)
      assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
      assert.match(
        output,
        /transactionHash.*4qeWX8ELjDt57JLDuDsSW3jYzP915R7wyXLWMshPZJkiDVxt1HAv2DTqmNow64Nxns8PSgrX1vLTYHWTabjFztDM/i,
      )
    },
  )
})

describe('e2e command show Solana', () => {
  // Test transaction hash (refreshed periodically; devnet prunes old history)
  const TX_HASH =
    '4FXDDtNsz2X9QNYiUAm1KnYSYPSrRWjderx4PpPaMtuTVpdGAJBWWD2d6NxAYCGmefRhr63QwMnRoVdm6rLdfSfV'
  const MESSAGE_ID = '0x2192fb7b3728623ce2b6830859b8cbc3146f70d3529469a7ecd21a37dd9a5f68'
  const SENDER = '6XS768SMgF7iEt7ZX8iJBgu7mXHewc95aqAz6XAj1hu3'
  const RECEIVER = '0x2840D88F9c3E018544aaD8f9275DCCf12cB35160'
  const ONRAMP = 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C'
  const OFFRAMP = '0x0820f975ce90EE5c508657F0C58b71D1fcc85cE0'

  it(
    'should show complete CCIP transaction details Solana to EVM',
    { timeout: 120000 },
    async () => {
      const args = buildShowArgs(TX_HASH)
      const result = await spawnCLI(args, 120000)

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
      assert.match(output, /sequenceNumber.*3229/)
      assert.match(output, /nonce.*0n?.*allow out-of-order/)
      assert.match(output, /gasLimit.*200000n?/)
      assert.match(output, /finalized.*true/)
      assert.match(output, /fee.*\bSOL/)
      assert.match(output, /tokens.*0\.0001 MNT/)
      assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
      assert.match(output, /data.*0x'?/)
      assert.match(output, /allowOutOfOrderExecution.*true\b/)

      // Commit information
      assert.match(output, /Commit.*dest/i)
      assert.match(
        output,
        /merkleRoot.*0x8081a0af0284d8925b4f6ee63e6e21c10477e48f301a2c3d6c8064664b9bbe47/i,
      )
      assert.match(output, /min.*3226/)
      assert.match(output, /max.*3229/)
      assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
      assert.match(
        output,
        /transactionHash.*0xb9cf0464382371b41b00a5aea0d6f7e1357cc5a9aad4a8c17fa0904df2dea383/i,
      )

      // Receipts information: this message had a failed execution attempt before succeeding
      assert.match(output, /Receipts.*dest/i)
      const failedMatches = output.match(/failed/gi) || []
      const successMatches = output.match(/success/gi) || []
      assert.ok(failedMatches.length >= 1)
      assert.ok(successMatches.length >= 1)
      assert.match(
        output,
        /transactionHash.*0x3c352c2b5ac5f11b31e876ccb6b97b819a8946a4227f2fef9f62677dbfd2240a/i,
      )
    },
  )
})

describe('e2e command show Aptos', () => {
  // Test transaction hash
  const TX_HASH = '0xfe068c795491d52c548a50f4e6a378a4c837d6cbfcf322e1acfe121f2fe735b4'
  const MESSAGE_ID = '0x36ac5c4c91a322b8294d6a32250fe87342d7de19460d6849e7b04b864ab8333d'
  const SENDER = '0xc7dfb38f07910cba7157db3ead1471ebc5a87f71a5aaad3921637f5371da69d8'
  const RECEIVER = '0x89810cb91a5fe67dDf3483182f08e1559A5699De'
  const ONRAMP = '0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45'
  const OFFRAMP = '0x0820f975ce90EE5c508657F0C58b71D1fcc85cE0'

  it(
    'should show complete CCIP transaction details Aptos to EVM',
    { timeout: 120000 },
    async () => {
      const args = buildShowArgs(TX_HASH)
      const result = await spawnCLI(args, 120000)

      assert.equal(result.exitCode, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`)
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
      assert.match(output, /sequenceNumber.*81n?/)
      assert.match(output, /nonce.*0n?.*allow out-of-order/)
      assert.match(output, /gasLimit.*0n?/)
      assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
      // assert.match(output, /finalized.*true/)
      assert.match(output, /fee.*\bAPT/)
      assert.match(output, /tokens.*0\.0013 CCIP-BnM/)
      assert.match(output, /data.*hello from ccip-tools-ts\b/)
      assert.match(output, /allowOutOfOrderExecution.*true\b/)

      // Commit information
      assert.match(output, /Commit.*dest/i)
      assert.match(
        output,
        /merkleRoot.*0x3384a0346bb91a2300fcd58391181950fa15e44c56752757d473204ff759e629/i,
      )
      assert.match(output, /min.*81/)
      assert.match(output, /max.*81/)
      assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
      assert.match(
        output,
        /transactionHash.*0x68996294653de4757c1cd9a68f948e05304821ac3f1a887944b01c9e0a493f1d/i,
      )

      // Receipts information
      assert.match(output, /Receipts.*dest/i)
      assert.match(output, /state.*success/i)
      assert.match(output, /gasUsed.*79399/i)
      assert.match(
        output,
        /transactionHash.*0x55e31c81a43af256ced95fbcbaabde3ea6ea0f287cb20af1ad61e0e845a211a3/i,
      )
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
