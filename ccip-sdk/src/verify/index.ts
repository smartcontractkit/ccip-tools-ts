/**
 * The set of CCIP contracts the SDK ships pre-built verification artifacts for.
 * Used as the `contract` discriminator in {@link verifyDeployedContract} and the
 * `name` argument to {@link getVerificationArtifact}.
 */
export type DeployableContract =
  | 'CrossChainToken'
  | 'ERC20LockBox'
  | 'LockReleaseTokenPool'
  | 'BurnMintTokenPool'
  | 'CrossChainPoolToken'
  | 'AdvancedPoolHooks'

export { verifyContract } from './verify.ts'
export { ETHERSCAN_V2_API_URL, EtherscanV2Client } from './etherscan.ts'
export { SOURCIFY_API_URL, SourcifyClient } from './sourcify.ts'
export { encodeConstructorArgs, encodeConstructorArgsFromTypes } from './constructor-args.ts'
export { resolveLongCompilerVersion } from './solc-version.ts'
export {
  getVerificationArtifact,
  listDeployableContracts,
  resolveVerifier,
  verifyDeployedContract,
} from './registry.ts'
export type {
  ManifestEntry,
  VerificationArtifact,
  VerifierEntry,
  VerifierProvider,
} from './registry.ts'
export type {
  ConstructorArgs,
  StandardJsonInput,
  VerifyContractInput,
  VerifyResult,
} from './types.ts'
