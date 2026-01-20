import { spawn } from 'child_process'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_PATH = path.join(__dirname, '..', 'index.ts')

// Public RPCs for testing
const RPCS = [
  process.env['RPC_SEPOLIA'] || 'https://ethereum-sepolia-rpc.publicnode.com',
  process.env['RPC_AVAX'] || 'https://avalanche-fuji-c-chain-rpc.publicnode.com',
  process.env['RPC_APTOS'] || 'testnet',
  process.env['RPC_SOLANA'] || 'https://api.devnet.solana.com',
  process.env['RPC_TON'] || 'https://testnet.toncenter.com/api/v2',
]

/**
 * Spawns the CLI as a subprocess and returns stdout/stderr/exitCode
 *
 * Sets NODE_V8_COVERAGE to collect coverage from the subprocess.
 * This coverage is automatically merged with Jest's coverage by c8.
 */
async function spawnCLI(
  args: string[],
  timeout = 60000,
): Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
}> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_PATH, ...args], {
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`CLI command timed out after ${timeout / 1e3}s`))
    }, timeout)

    child.on('close', (code) => {
      clearTimeout(timeoutId)
      resolve({
        stdout,
        stderr,
        exitCode: code,
      })
    })

    child.on('error', (err) => {
      clearTimeout(timeoutId)
      reject(err)
    })
  })
}

/**
 * Helper to build common CLI arguments for show command with --tx option
 */
function buildShowArgs(txHash: string, ...additionalArgs: string[]): string[] {
  return [
    'show',
    '--tx',
    txHash,
    '-r',
    ...RPCS,
    '--rpcs-file',
    'package.json', // Disable rpcs file loading
    ...additionalArgs,
  ]
}

/**
 * Helper to build CLI arguments for show command with --id option
 */
function buildShowIdArgs(messageId: string, ...additionalArgs: string[]): string[] {
  return [
    'show',
    '--id',
    messageId,
    '-r',
    ...RPCS,
    '--rpcs-file',
    'package.json', // Disable rpcs file loading
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
        // Use --noapi and --wait to ensure RPC path and full output with commits/receipts
        const args = buildShowArgs(TX_HASH, '--no-api', '--wait')
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

        // Receipts information (--wait shows first receipt found)
        assert.match(output, /execution.*destination/i)

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
      },
    )
  })

  describe('json format', () => {
    it('should output valid JSON with all expected fields', { timeout: 120000 }, async () => {
      // Use --noapi and --wait to ensure RPC path and full output with commits/receipts
      const args = buildShowArgs(TX_HASH, '--format', 'json', '--no-api', '--wait')
      const result = await spawnCLI(args, 120000)

      assert.equal(result.exitCode, 0)

      // Should contain valid JSON objects (multiple objects for request, commit, receipts)
      const jsonObjects: any[] = []
      let currentJson = ''

      // Accumulate lines to form complete JSON objects
      const lines = result.stdout.trim().split('\n')
      for (const line of lines) {
        if (line.trim()) {
          currentJson += line + '\n'
          try {
            const parsed = JSON.parse(currentJson)
            jsonObjects.push(parsed)
            currentJson = ''
          } catch (_) {
            // Not yet a complete JSON object, continue accumulating
          }
        }
      }

      // Should have parsed at least one JSON object
      assert.ok(jsonObjects.length > 0, result.stdout + result.stderr)

      // Verify messageId is in the output
      assert.match(result.stdout, /"messageId"/)
      assert.match(result.stdout, new RegExp(MESSAGE_ID, 'i'))

      // Verify key fields are in JSON format
      assert.match(result.stdout, /"sender"/)
      assert.match(result.stdout, /"receiver"/)
      assert.match(result.stdout, /"sequenceNumber"/)
      assert.match(result.stdout, /"merkleRoot"/)
    })
  })

  describe('log format', () => {
    it('should output in log format with object assignments', { timeout: 120000 }, async () => {
      // Use --noapi and --wait to ensure RPC path and full output with commits/receipts
      const args = buildShowArgs(TX_HASH, '--format', 'log', '--no-api', '--wait')
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
      // Use --noapi to ensure RPC path is used for full pretty output
      const args = buildShowArgs(TX_HASH, '--verbose', '--no-api')
      const result = await spawnCLI(args, 120000)

      assert.equal(result.exitCode, 0)
      assert.ok(result.stdout.length > 0)

      // Should still contain main output
      assert.match(result.stdout, /Lane/)
      assert.match(result.stdout, /Request/)
      assert.match(result.stdout, new RegExp(MESSAGE_ID, 'i'))
    })
  })

  describe('--id option', () => {
    it('should query by message ID with --id option', { timeout: 120000 }, async () => {
      // Use --id to query by message ID instead of tx hash
      const args = buildShowIdArgs(MESSAGE_ID, '--no-api', '--source', 'ethereum-testnet-sepolia')
      const result = await spawnCLI(args, 120000)

      assert.equal(result.exitCode, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`)

      // Should contain the message information
      assert.match(result.stdout, new RegExp(MESSAGE_ID, 'i'))
      assert.match(result.stdout, new RegExp(SENDER, 'i'))
      assert.match(result.stdout, new RegExp(RECEIVER, 'i'))
    })

    it('should query by message ID with --onramp option', { timeout: 120000 }, async () => {
      // Use --id with --source and --onramp to narrow the query
      const args = buildShowIdArgs(
        MESSAGE_ID,
        '--no-api',
        '--source',
        'ethereum-testnet-sepolia',
        '--onramp',
        ONRAMP,
      )
      const result = await spawnCLI(args, 120000)

      assert.equal(result.exitCode, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`)

      // Should contain the message information
      assert.match(result.stdout, new RegExp(MESSAGE_ID, 'i'))
      assert.match(result.stdout, new RegExp(SENDER, 'i'))
      assert.match(result.stdout, new RegExp(RECEIVER, 'i'))
      assert.match(result.stdout, new RegExp(ONRAMP, 'i'))
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

    it('should error when neither --tx nor --id is provided', { timeout: 30000 }, async () => {
      const args = ['show', '-r', ...RPCS, '--rpcs-file', '.gitignore']
      const result = await spawnCLI(args, 30000)

      // Should exit with error code
      assert.notEqual(result.exitCode, 0)

      // Should mention needing --tx or --id
      assert.match(result.stderr, /--tx.*--id|Must provide/i)
    })

    it('should error when both --tx and --id are provided', { timeout: 30000 }, async () => {
      const args = [
        'show',
        '--tx',
        '0x25e63fa89abb77acd353edc24ed3ab5880a8d206c8229e6f61dc00d399f447b3',
        '--id',
        '0xdfb374fef50749b0bc86784e097ecc9547c5145ddfb8f9d96f1da3024abfcd04',
        '-r',
        ...RPCS,
        '--rpcs-file',
        '.gitignore',
      ]
      const result = await spawnCLI(args, 30000)

      // Should exit with error code
      assert.notEqual(result.exitCode, 0)

      // Should mention mutually exclusive arguments
      assert.match(result.stderr, /mutually exclusive/i)
    })

    it('should error with invalid message ID format', { timeout: 30000 }, async () => {
      const args = ['show', '--id', 'invalid-id', '-r', ...RPCS, '--rpcs-file', '.gitignore']
      const result = await spawnCLI(args, 30000)

      // Should exit with error code
      assert.notEqual(result.exitCode, 0)

      // Should mention invalid format
      assert.match(result.stderr, /Invalid message ID format/i)
    })
  })

  it(
    'should show complete CCIP transaction details EVM to Aptos',
    { timeout: 120000 },
    async () => {
      // Test transaction hash
      const TX_HASH = '0xe65111f4abeaf4acef6c71279358d2fe8f6e828fd3bc043103083895cf1e847f'
      const MESSAGE_ID = '0x3cad04936caf2af67449ae09c74a969ac0fcd8abbc4fb28460431533969a2a04'
      const SENDER = '0x90392A1E8A941098a3C75E0BDB172cFdE7E4f1f4'
      const RECEIVER = '0x86a9391c0f8dfbada39cc017ea66a0533d445ae6ee8a85082ee5afe38bca1f49'
      const ONRAMP = '0x23a5084Fa78104F3DF11C63Ae59fcac4f6AD9DeE'
      const OFFRAMP = '0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45'

      // Use --noapi and --wait to ensure RPC path and full output with commits/receipts
      const args = buildShowArgs(TX_HASH, '--no-api', '--wait')
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
      assert.match(output, /sequenceNumber.*97n?/)
      assert.match(output, /nonce.*0n?.*allow out-of-order/)
      assert.match(output, /gasLimit.*50n?/)
      assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
      assert.match(output, /data.*0x01\b/)
      assert.match(output, /allowOutOfOrderExecution.*true\b/)

      // Commit information
      assert.match(output, /Commit.*dest/i)
      assert.match(
        output,
        /merkleRoot.*0x1f93bd26f4de9793e95135b9135d08faf5a78326a3c9914a863fb827a2f1ab29/i,
      )
      assert.match(output, /min.*97/)
      assert.match(output, /max.*97/)
      assert.match(
        output,
        /origin.*0x1b90035727683942129394d59d85196f341afab6375f25de7e900ebe67b7f5e6/i,
      )
      assert.match(output, new RegExp(`contract.*${OFFRAMP}::offramp`, 'i'))
      assert.match(
        output,
        /transactionHash.*0xfcfb828b869a9af57fff19dd81f7136e22ff877a033477275cc56103e3de3edd/i,
      )

      // Receipts information
      assert.match(output, /execution.*destination/i)
      assert.match(output, /state.*success/i)
      assert.match(
        output,
        /transactionHash.*0x90bdb7006825eaccc08cf480115cae8ea3a8c83ae988c729b61ac910d0d360e1/i,
      )
    },
  )

  it(
    'should show complete CCIP transaction details EVM to Solana',
    { timeout: 120000 },
    async () => {
      // Test transaction hash
      const TX_HASH = '0xb75ffc2bd00b9a9bf5f7942cad201fa6a832fa58ffd7b773ece39531e6513670'
      const MESSAGE_ID = '0x0be9c1da6942964676b995697e2d1f1ce3a497f1b00bcbe6a3a3b2ea9c8fd67c'
      const SENDER = '0x90656946eb4065D9FC2a0c0B9aF7Ff37c02F52a2'
      const RECEIVER = 'BqmcnLFSbKwyMEgi7VhVeJCis1wW26VySztF34CJrKFq'
      const ONRAMP = '0x23a5084Fa78104F3DF11C63Ae59fcac4f6AD9DeE'
      const OFFRAMP = 'offqSMQWgQud6WJz694LRzkeN5kMYpCHTpXQr3Rkcjm'

      // Use --noapi and --wait to ensure RPC path and full output with commits/receipts
      const args = buildShowArgs(TX_HASH, '--no-api', '--wait')
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
      assert.match(output, /sequenceNumber.*3923n?/)
      assert.match(output, /nonce.*0n?.*allow out-of-order/)
      assert.doesNotMatch(output, /gasLimit/)
      assert.match(output, /computeUnits.*200000n?/)
      assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
      assert.match(output, /data.*e2e test\b/)
      assert.match(output, /allowOutOfOrderExecution.*true\b/)
      assert.match(output, /tokenReceiver.*11111111111111111111111111111111\b/)

      // Commit information
      assert.match(output, /Commit.*dest/i)
      assert.match(
        output,
        /merkleRoot.*0x68da9013b63f098dbb85b2b4d53933a029c8b4f06b0b2fe15ad001da10375eb4/i,
      )
      assert.match(output, /min.*3919/)
      assert.match(output, /max.*3924/)
      assert.match(output, /origin.*Cc7sVief2raXko3WqgjeGYDSC7fWAPwqyAWweScSoikM/i)
      assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
      assert.match(
        output,
        /transactionHash.*3iwF1ENtLZEoVMABrFBiWzZ6pMKMngDqvgaRnKtW6NLEjd2SXZsPStwBJQGzaUFawN18CPjHP5HCPkN4mRto9k5L/i,
      )

      // Receipts information
      assert.match(output, /execution.*destination/i)
      assert.match(output, /state.*success/i)
      assert.match(
        output,
        /transactionHash.*u2ExFxWm7wnYEEkp89mkxtW2d9EbSap9q8im3vLg4g4NJ3PSpKTv8szhxCKaYTzSZNoJ8JLdZCVxekCFv4faa4E/i,
      )
    },
  )
})

describe('e2e command show Solana', () => {
  // Test transaction hash
  const TX_HASH =
    '5kNwdda31bfY2rA8pt2xGpdptTWzDqSxkHae2FqE1RQKbA2Wi3ikC8SZDZdjxwmjpHLNQHWYAKkr6gp2mz2HJ9iS'
  const MESSAGE_ID = '0x941411a3d6b5e4d7350a2113207976614e6327c3e56a479e266ec57fef61961b'
  const SENDER = 'DWBXvezhcEadofmf9obkgsMeZnGoDiSBE5Vpc1CPs8fu'
  const RECEIVER = '0xAB4f961939BFE6A93567cC57C59eEd7084CE2131'
  const ONRAMP = 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C'
  const OFFRAMP = '0x0820f975ce90EE5c508657F0C58b71D1fcc85cE0'

  it(
    'should show complete CCIP transaction details Solana to EVM',
    { timeout: 120000 },
    async () => {
      // Use --noapi to ensure RPC path is used for full pretty output with commits/receipts
      const args = buildShowArgs(TX_HASH, '--no-api', '--wait')
      const result = await spawnCLI(args, 120000)

      assert.equal(result.exitCode, 0, result.stdout + result.stderr)
      const output = result.stdout

      // Lane information
      assert.match(output, /name.*solana-devnet.*ethereum-testnet-sepolia/i)
      assert.match(output, /chainId.*EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG.*11155111/)
      assert.match(output, /chainSelector.*16423721717087811551n?.*16015286601757825753n?/)
      assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*1\\.6\\.0`, 'i'))

      // Request information
      assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
      assert.match(output, new RegExp(`origin.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`sender.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`receiver.*${RECEIVER}`))
      assert.match(output, /sequenceNumber.*1975n?/)
      assert.match(output, /nonce.*0n?.*allow out-of-order/)
      assert.match(output, /gasLimit.*0n?/)
      assert.match(output, /finalized.*true/)
      assert.match(output, /fee.*\bSOL/)
      assert.match(output, /tokens.*0\.017 USDC/)
      assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
      assert.match(output, /data.*hello from ccip-tools-ts\b/)
      assert.match(output, /allowOutOfOrderExecution.*true\b/)

      // USDC attestation
      assert.match(output, /Attestations:/i)
      assert.match(output, /type.*\busdc\b/i)

      // Commit information
      assert.match(output, /Commit.*dest/i)
      assert.match(
        output,
        /merkleRoot.*0xc14e80512b09a884f491fd2c258d75861e9b0ed8c375b7c306470aad38397613/i,
      )
      assert.match(output, /min.*1975/)
      assert.match(output, /max.*1975/)
      assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
      assert.match(
        output,
        /transactionHash.*0xb51f2c20a273438fb3e08765b8cc95eb1c3f6f84d5b0257a212c47039300dcd4/i,
      )

      // Receipts information
      assert.match(output, /execution.*destination/i)
      assert.match(output, /state.*success/i)
      assert.match(
        output,
        /transactionHash.*0x35f262d6c6de2466ab99b7c6e710bb92c546568c4f660aa9d8b65820cec2840b/i,
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
      // Use --noapi to ensure RPC path is used for full pretty output with commits/receipts
      const args = buildShowArgs(TX_HASH, '--no-api', '--wait')
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
      assert.match(output, /finalized.*true/)
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
      assert.match(output, /execution.*destination/i)
      assert.match(output, /state.*success/i)
      assert.match(output, /gasUsed.*79399/i)
      assert.match(
        output,
        /transactionHash.*0x55e31c81a43af256ced95fbcbaabde3ea6ea0f287cb20af1ad61e0e845a211a3/i,
      )
    },
  )
})

describe('e2e command show TON', () => {
  it('should show complete CCIP transaction details TON to EVM', { timeout: 120000 }, async () => {
    // Test transaction hash (raw 64-char hex, resolved via TonCenter)
    const TX_HASH = '160f4da4b46fa0370ac7f4fcdac03f3a85919bce900be0bacf539df61fca2525'
    const MESSAGE_ID = '0x48f80b0f66b929ef4196d3b3947051a7d9c6b892db38f98b8df07294808c3e7e'
    const SENDER = 'EQAFbU7ATpBTe2vPiTpThvehgNiynnD4llSA8IaJThJFpvP7'
    const RECEIVER = '0x40d7c009d073e0d740ed2c50ca0a48c84a3f8b47'
    const ONRAMP = 'EQDTIBzONmN64tMmLymf0-jtc_AAWfDlXiZcr7ja5ri7ak53'
    const OFFRAMP = '0x93Bb167Ebd91987f9Dff6B954b9Eead469d2b849'

    // Use --noapi to ensure RPC path is used for full pretty output with commits/receipts
    const args = buildShowArgs(TX_HASH, '--no-api', '--wait')
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
    assert.match(output, /execution.*destination/i)
    assert.match(output, /state.*success/i)
    assert.match(output, /gasUsed.*41293/)
    assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
  })

  it.skip(
    'should show complete CCIP transaction details EVM to TON',
    { timeout: 120000 },
    async () => {
      const TX_HASH = '0x1f20d3f106a31dd6b1eec5dbb7ee0e8ba81cd2cef8718534518977645e14e5f5'
      const MESSAGE_ID = '0x40bf2c2df2112fc58937f7edad8bf0edda3f6f08c35708970a21c0bc544eb970'
      const SENDER = '0x65fdC0441C7a29B28A7b0fbBCbC28a134Ef376a0'
      const RECEIVER = 'EQBuYCiBYoDqZro_v7z242bKtooAWUV-L73ifE-R6_GVKuRF'
      const ONRAMP = '0xFB34b9969Dd201cc9A04E604a6D40AF917b6C1E8'
      const OFFRAMP = 'EQCfLpla6865euCU2-TPlzy8vKQKT8rFKHoAvorKBC1RudIO'

      // Use --noapi to ensure RPC path is used for full pretty output with commits/receipts
      const args = buildShowArgs(TX_HASH, '--no-api', '--wait')
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
      assert.match(output, /sequenceNumber.*1114/)
      assert.match(output, /nonce.*0.*allow out-of-order/)
      assert.match(output, /gasLimit.*100000000n?/)
      assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
      assert.match(output, /data.*CCIP staging test 14:56/)
      assert.match(output, /allowOutOfOrderExecution.*true/)

      // Commit information (dest is TON - friendly format)
      assert.match(output, /Commit.*dest/i)
      assert.match(
        output,
        /merkleRoot.*0x66359185e781ceee83d5f15b110581adf06c5ddc6e895ff9b8e670f2730d026d/i,
      )
      assert.match(output, /min.*1114/)
      assert.match(output, /max.*1114/)
      assert.match(output, new RegExp(`origin.*${OFFRAMP}`, 'i'))
      assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
      // Transaction hash should be in friendly format (64-char hex, not composite)
      assert.match(
        output,
        /transactionHash.*9048d65a2ecf5194fa9dfb5cc0ac59a55ffd75b9b6de5d7f09e53ef87ad5e6a8/i,
      )

      // Execution receipt
      assert.match(output, /execution.*destination/i)
      assert.match(output, /state.*success/i)
      assert.match(output, new RegExp(`origin.*${OFFRAMP}`, 'i'))
      assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
      assert.match(
        output,
        /transactionHash.*354d53820392622a113685e6c34517cd240e97aaa2ebf2082db7f4637b19f07e/i,
      )
      assert.match(output, /logIndex.*1/)
      assert.match(output, /blockNumber.*42539944000005/)

      // TON shows execution history including failed attempts and final success after manualExec
      // First receipt final state: failed
      assert.match(output, /state.*failed/i)
      assert.match(
        output,
        /transactionHash.*531c2fbc8db214d194aef894bfbb7163b3ad9f8c36f89d18b459c9f52d4faa14/i,
      )

      // Second receipt final state: successful
      assert.match(output, /state.*success/i)
      assert.match(
        output,
        /transactionHash.*354d53820392622a113685e6c34517cd240e97aaa2ebf2082db7f4637b19f07e/i,
      )

      // Verify we have both failed and successful executions
      const receiptsSection = output.split(/execution.*destination/i)[1] || ''
      const failedMatches = receiptsSection.match(/failed/gi) || []
      const successMatches = receiptsSection.match(/success/gi) || []
      assert.ok(failedMatches.length >= 1, 'Should have at least one failed execution')
      assert.ok(successMatches.length >= 1, 'Should have at least one successful execution')
    },
  )
})
