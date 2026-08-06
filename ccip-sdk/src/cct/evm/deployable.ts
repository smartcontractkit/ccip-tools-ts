/**
 * The set of EVM contracts this SDK can deploy, and therefore the exact set it ships
 * verification fixtures for.
 *
 * Deliberately a **dependency-free leaf**: it is the only thing `cct/evm` and
 * `cct/evm/verify` share, so `operation.ts` can narrow to it with `import type` without
 * creating any edge — value or declaration — into `verify/`. An eslint boundary rule
 * (`import-x/no-restricted-paths`) enforces that absolutely, and it has no `allowTypeImports`
 * escape, which is why this type cannot live in `verify/`.
 *
 * @packageDocumentation
 */

/**
 * A contract with vendored v2.0.0 creation bytecode, deployable by {@link EVMTokenManager}.
 *
 * Narrowing `DeployArtifact.contract` to this union is a forcing function: the three artifact
 * getters return literals, so vendoring a new contract's bytecode without extending this union
 * is a compile error at the assignment site — exactly where a reviewer must notice that the
 * verification fixture is missing too. The generated fixture manifest closes over the same union
 * with `satisfies`, so the two sets cannot drift apart silently.
 */
export type DeployableContract =
  | 'CrossChainToken'
  | 'ERC20LockBox'
  | 'BurnMintTokenPool'
  | 'BurnFromMintTokenPool'
  | 'BurnWithFromMintTokenPool'
  | 'LockReleaseTokenPool'
