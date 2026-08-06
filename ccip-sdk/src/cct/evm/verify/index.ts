/**
 * Block-explorer source verification for EVM CCT deployments.
 *
 * An opt-in subpath: the `.` and `cct/evm` entry points have no import edge into it, so a
 * consumer that never verifies pulls none of it — including the ~335 KB of vendored Solidity
 * sources, which are reached only through a lazy `import()` inside {@link verifyDeployedContract}.
 *
 * @remarks Until CCT is un-gated in the published package this module is reachable via
 * `npm run build:dev -w ccip-sdk` plus `npm link`, importing
 * `@chainlink/ccip-sdk/dist/cct/evm/verify/index.js`.
 *
 * @example
 * ```typescript
 * import { EVMTokenManager } from '@chainlink/ccip-sdk/cct/evm'
 *
 * const deploy = await cct.deployTokenPool({ type: 'BurnMintTokenPool', ...params, wallet })
 * const { verifyDeployedContract } = await import('@chainlink/ccip-sdk/cct/evm/verify')
 *
 * const result = await verifyDeployedContract(deploy, { chainId: 84532, apiKey })
 * if (result.status === 'failed') throw new Error(result.reason)
 * console.log(result.explorerUrl)
 * ```
 *
 * @packageDocumentation
 */

export { verifyDeployedContract } from './verify.ts'
export type { VerifyOptions, VerifyResult, VerifyTarget } from './verify.ts'
export type { ExplorerRoute, VerifierName } from './routes.ts'
export type { DeployableContract } from '../deployable.ts'
