import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  getVerificationArtifact,
  listDeployableContracts,
  verifyDeployedContract,
} from './index.ts'
import { CCIPUnknownVerificationContractError } from '../errors/index.ts'

/** Records the form fields POSTed to `verifysourcecode` so tests can assert on them. */
interface SubmittedForm {
  codeformat?: string
  compilerversion?: string
  contractname?: string
  sourceCode?: string
}

/**
 * Builds a fully-offline Etherscan-style `fetch` mock that drives one contract through
 * the submit, pending, then verified sequence, capturing the submitted verify form.
 */
function makeFetchMock(captured: SubmittedForm): typeof fetch {
  let statusChecks = 0

  const envelope = (status: string, message: string, result: string): Response =>
    new Response(JSON.stringify({ status, message, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })

  const impl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const action = new URL(url).searchParams.get('action')

    if (action === 'getsourcecode') {
      // Not-yet-verified array so the already-verified short-circuit does NOT trigger.
      return Promise.resolve(envelope('1', 'OK', '[{"SourceCode":""}]'))
    }
    if (action === 'verifysourcecode') {
      const body = typeof init?.body === 'string' ? init.body : ''
      const form = new URLSearchParams(body)
      captured.codeformat = form.get('codeformat') ?? undefined
      captured.compilerversion = form.get('compilerversion') ?? undefined
      captured.contractname = form.get('contractname') ?? undefined
      captured.sourceCode = form.get('sourceCode') ?? undefined
      return Promise.resolve(envelope('1', 'OK', 'guid-12345'))
    }
    if (action === 'checkverifystatus') {
      statusChecks += 1
      // First poll: pending; subsequent polls: verified.
      return statusChecks === 1
        ? Promise.resolve(envelope('1', 'OK', 'Pending in queue'))
        : Promise.resolve(envelope('1', 'OK', 'Pass - Verified'))
    }
    throw new Error(`unexpected action: ${action ?? 'null'}`)
  }

  return impl
}

void describe('verifyDeployedContract', () => {
  void it('drives the submit, pending, then verified sequence with the expected form', async () => {
    const captured: SubmittedForm = {}
    const fetchImpl = makeFetchMock(captured)

    const result = await verifyDeployedContract(
      {
        contract: 'CrossChainToken',
        chainId: 11155111,
        contractAddress: '0x0000000000000000000000000000000000000001',
        apiKey: 'x',
        constructorArgs: { kind: 'none' },
      },
      { fetchImpl, sleep: () => Promise.resolve() },
    )

    assert.equal(result.status, 'verified')
    assert.equal(captured.codeformat, 'solidity-standard-json-input')
    assert.equal(captured.compilerversion, 'v0.8.26+commit.8a97fa7a')
    assert.equal(captured.contractname, 'contracts/tokens/CrossChainToken.sol:CrossChainToken')
    assert.ok(captured.sourceCode && captured.sourceCode.length > 0)
  })
})

void describe('listDeployableContracts', () => {
  void it('returns the 6 bundled contract keys', () => {
    const keys = listDeployableContracts()
    assert.deepEqual([...keys].sort(), [
      'AdvancedPoolHooks',
      'BurnMintTokenPool',
      'CrossChainPoolToken',
      'CrossChainToken',
      'ERC20LockBox',
      'LockReleaseTokenPool',
    ])
  })
})

void describe('getVerificationArtifact', () => {
  void it('loads a non-empty standard-json input for a known contract', () => {
    const art = getVerificationArtifact('BurnMintTokenPool')
    assert.equal(art.contractName, 'contracts/pools/BurnMintTokenPool.sol:BurnMintTokenPool')
    assert.ok(Object.keys(art.standardJsonInput.sources).length > 0)
  })

  void it('throws CCIPUnknownVerificationContractError for an unknown contract', () => {
    assert.throws(() => getVerificationArtifact('Nope'), CCIPUnknownVerificationContractError)
  })
})
