/**
 * Live checks against the real CreateX deployment on Base Sepolia, driven through
 * {@link DeployTokenPool} — the only op that routes via CreateX.
 *
 * @remarks The address predictions here are cross-checked by `eth_call`-ing the factory rather than
 * by broadcasting: CreateX's deploy functions return the address they would create, so a simulated
 * call is exact ground truth for the salt-guarding logic and costs nothing. `deployCreate2AndInit`
 * additionally reverts `FailedContractInitialisation` if the atomic init call fails, so a
 * successful simulation also proves the deploy-plus-transferOwnership sequence holds together.
 *
 * Broadcasting the same calls needs a funded account and is covered in the evaluation memo.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { JsonRpcProvider } from 'ethers'

import { RPC_ENV, rpcEndpoint } from '../../../../../scripts/test-endpoints.ts'
import { useResource } from '../../../../../scripts/useResource.ts'
import type { EVMChain } from '../../../evm/index.ts'
import { getTokenPoolArtifact } from '../token-pool/contracts.ts'
import {
  type DeployTokenPoolParams,
  DeployTokenPool,
} from '../token-pool/operations/deploy-token-pool.ts'
import { CREATEX_ADDRESS, CREATEX_INTERFACE } from './contracts.ts'
import { deployViaCreateX } from './deploy.ts'
import { buildPermissionedSalt, predictCreateXAddress } from './salt.ts'
import { verifyCreateXDeployment } from './verify.ts'

await useResource(['base-sepolia'])

const BASE_SEPOLIA = 84532n
const DEPLOYER = '0x1111111111111111111111111111111111111111'
// A real 18-decimal token: the pool constructor staticcalls `token.decimals()` and reverts if it
// does not match `localTokenDecimals`, so a placeholder address fails inside CREATE2 with
// `FailedContractCreation` before any of the salt logic is exercised.
const TOKEN = '0xa7f29d90f2ad98d6C2972FC72c4B613270C3eF4D'
// Read from the live chain, not hardcoded lore: `router.typeAndVersion()` is "Router 1.2.0" and
// the proxy is `router.getArmProxy()` → "ARMProxy 1.0.0".
const ROUTER = '0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93'
const RMN_PROXY = '0x99360767a4705f68CcCb9533195B761648d6d807'

const provider = new JsonRpcProvider(rpcEndpoint(RPC_ENV.BASE_SEPOLIA))
const chain = { provider } as unknown as EVMChain

const POOL_PARAMS = {
  type: 'BurnMintTokenPool',
  token: TOKEN,
  localTokenDecimals: 18,
  rmnProxy: RMN_PROXY,
  router: ROUTER,
} satisfies DeployTokenPoolParams

/** The exact init code the op builds, reassembled from the same artifact and encoder it uses. */
function poolInitCode(): string {
  const artifact = getTokenPoolArtifact('BurnMintTokenPool')
  return (
    artifact.bytecode +
    artifact.iface
      .encodeDeploy([
        POOL_PARAMS.token,
        POOL_PARAMS.localTokenDecimals,
        '0x0000000000000000000000000000000000000000',
        POOL_PARAMS.rmnProxy,
        POOL_PARAMS.router,
      ])
      .slice(2)
  )
}

/** Asks the live factory what address it would deploy to, without broadcasting. */
async function simulate(fn: string, args: unknown[]): Promise<string> {
  const ret = await provider.call({
    to: CREATEX_ADDRESS,
    from: DEPLOYER,
    data: CREATEX_INTERFACE.encodeFunctionData(fn, args),
  })
  return CREATEX_INTERFACE.decodeFunctionResult(fn, ret)[0] as string
}

describe('CreateX — live Base Sepolia', { skip: !!process.env.SKIP_INTEGRATION_TESTS }, () => {
  it('is the reviewed contract at the canonical address', async () => {
    const result = await verifyCreateXDeployment(chain)
    assert.equal(result.status, 'verified')
  })

  it('predicts the deployCreate2 address the factory itself reports', async () => {
    const salt = buildPermissionedSalt('test', DEPLOYER, '0x' + '11'.repeat(11))
    const predicted = predictCreateXAddress('test', {
      salt,
      initCode: poolInitCode(),
      deployer: DEPLOYER,
      chainId: BASE_SEPOLIA,
    })
    assert.equal(await simulate('deployCreate2', [salt, poolInitCode()]), predicted)
  })

  it('guards every salt mode the same way the contract does', async () => {
    const initCode = poolInitCode()
    const modes: [string, string][] = [
      ['permissioned', buildPermissionedSalt('test', DEPLOYER, '0x' + '11'.repeat(11))],
      ['permissionedChainScoped', DEPLOYER + '01' + '22'.repeat(11)],
      ['chainScoped', '0x' + '00'.repeat(20) + '01' + '33'.repeat(11)],
      ['random', '0x' + 'ab'.repeat(20) + '00' + '44'.repeat(11)],
    ]
    for (const [mode, salt] of modes) {
      const predicted = predictCreateXAddress('test', {
        salt,
        initCode,
        deployer: DEPLOYER,
        chainId: BASE_SEPOLIA,
      })
      assert.equal(await simulate('deployCreate2', [salt, initCode]), predicted, mode)
    }
  })

  it('deploys and transfers ownership atomically, landing at the predicted address', async () => {
    // The whole public surface, end to end: build the pool deploy exactly as a caller would, pass
    // it through the transform, then simulate the resulting calldata against the live factory.
    //
    // Succeeding at all is the assertion about atomicity — CreateX reverts the whole call if the
    // init step fails, so this cannot pass with a broken transferOwnership. And the address the
    // factory reports must equal the one `viaCreateX` returned before anything was signed.
    const plain = await new DeployTokenPool().generate(chain, {
      ...POOL_PARAMS,
      sender: DEPLOYER,
    })
    const deploy = await deployViaCreateX(chain, plain, {
      sender: DEPLOYER,
      iface: getTokenPoolArtifact('BurnMintTokenPool').iface,
      init: { transferOwnership: DEPLOYER },
    })

    const tx = deploy.transaction.transactions[0]!
    assert.equal(tx.to, CREATEX_ADDRESS)
    const ret = await provider.call({ to: tx.to, from: DEPLOYER, data: tx.data! })
    const [actual] = CREATEX_INTERFACE.decodeFunctionResult('deployCreate2AndInit', ret)
    assert.equal(actual, deploy.address)
  })

  it('reverts the entire deployment when the atomic init call fails', async () => {
    // `acceptOwnership` with no transfer pending reverts, so this exercises CreateX's
    // FailedContractInitialisation path: a failed init undoes the deployment too.
    const salt = buildPermissionedSalt('test', DEPLOYER, '0x' + '22'.repeat(11))
    const { iface } = getTokenPoolArtifact('BurnMintTokenPool')
    await assert.rejects(() =>
      simulate('deployCreate2AndInit', [
        salt,
        poolInitCode(),
        iface.encodeFunctionData('acceptOwnership', []),
        [0n, 0n],
        DEPLOYER,
      ]),
    )
  })
})
